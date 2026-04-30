import { KeyPerson, PersonCategory } from '../types.js';
import { BUSINESS_PAGE_PATTERNS, ROLE_KEYWORDS } from '../utils/patterns.js';

interface PageInput {
  url: string;
  html: string;
}

/**
 * Extract decision-makers from team / leadership / about pages.
 *
 * Uses two complementary strategies:
 *   1. JSON-LD Person schema (most reliable when present)
 *   2. Personal LinkedIn URL (linkedin.com/in/<slug>) as anchor — for each match,
 *      extract a candidate name and title from the surrounding context.
 *
 * Returns a deduplicated list of KeyPerson, prioritising those with linkedinUrl.
 */
export function extractKeyPeople(pages: PageInput[]): KeyPerson[] {
  const candidates: KeyPerson[] = [];

  for (const page of pages) {
    if (!isPeoplePage(page.url)) continue;

    candidates.push(...extractFromJsonLd(page.html, page.url));
    // Heuristic extractors must not see JSON-LD or inline JSON state — those
    // contain LinkedIn URLs whose surrounding text isn't real page content
    // (titles like "Chief Technology Officer" get mis-parsed as names).
    const visibleHtml = stripScriptsAndStyles(page.html);
    candidates.push(...extractFromLinkedInAnchors(visibleHtml, page.url));
    candidates.push(...extractFromCardBlocks(visibleHtml, page.url));
  }

  return dedupe(candidates);
}

function isPeoplePage(url: string): boolean {
  return BUSINESS_PAGE_PATTERNS.people.some((p) => p.test(url));
}

/**
 * Parse <script type="application/ld+json"> blocks for Person schemas.
 */
function extractFromJsonLd(html: string, sourceUrl: string): KeyPerson[] {
  const out: KeyPerson[] = [];
  const blockRegex = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;

  while ((m = blockRegex.exec(html)) !== null) {
    let data: unknown;
    try {
      data = JSON.parse(m[1].trim());
    } catch {
      continue;
    }
    walkLdJson(data, sourceUrl, out);
  }
  return out;
}

function walkLdJson(node: unknown, sourceUrl: string, out: KeyPerson[]): void {
  if (!node) return;
  if (Array.isArray(node)) {
    for (const child of node) walkLdJson(child, sourceUrl, out);
    return;
  }
  if (typeof node !== 'object') return;
  const obj = node as Record<string, unknown>;
  const type = obj['@type'];
  const isPerson =
    type === 'Person' ||
    (Array.isArray(type) && type.includes('Person'));

  if (isPerson && typeof obj.name === 'string') {
    const title = (obj.jobTitle as string) || '';
    const linkedinUrl = pickLinkedIn(obj.sameAs);
    out.push({
      name: cleanName(obj.name),
      title: title.trim(),
      category: categorizeRole(title),
      linkedinUrl,
      profileImageUrl: typeof obj.image === 'string' ? obj.image : null,
      sourceUrl,
    });
  }

  // Recurse into nested objects (some sites wrap Person under @graph)
  for (const v of Object.values(obj)) {
    if (typeof v === 'object' && v !== null) walkLdJson(v, sourceUrl, out);
  }
}

function pickLinkedIn(sameAs: unknown): string | null {
  const items = Array.isArray(sameAs) ? sameAs : sameAs ? [sameAs] : [];
  for (const item of items) {
    if (typeof item === 'string' && /linkedin\.com\/in\//i.test(item)) {
      return item.replace(/\/+$/, '');
    }
  }
  return null;
}

/**
 * For each personal LinkedIn URL on the page, take a window of surrounding
 * text and try to extract a name + title.
 */
function extractFromLinkedInAnchors(html: string, sourceUrl: string): KeyPerson[] {
  const out: KeyPerson[] = [];
  const re = /https?:\/\/(?:www\.)?linkedin\.com\/in\/[a-zA-Z0-9_-]+/gi;
  let m: RegExpExecArray | null;

  while ((m = re.exec(html)) !== null) {
    const linkedinUrl = m[0].replace(/\/+$/, '');
    const start = Math.max(0, m.index - 800);
    const end = Math.min(html.length, m.index + 200);
    const window = html.slice(start, end);
    const text = stripTags(window);

    const name = findNameNearLinkedIn(window, text);
    if (!name) continue;

    const title = findTitleNear(text, name);

    out.push({
      name,
      title,
      category: categorizeRole(title),
      linkedinUrl,
      profileImageUrl: findImageNear(window),
      sourceUrl,
    });
  }
  return out;
}

/**
 * Many team pages render people as cards: <h2/h3>Name</h2/h3> followed by a
 * title in a <p> / <span> / <div>. Pull these out even when no LinkedIn
 * link is present (still useful for the BD exec).
 */
function extractFromCardBlocks(html: string, sourceUrl: string): KeyPerson[] {
  const out: KeyPerson[] = [];
  const re = /<h[2-4][^>]*>([^<]{3,60})<\/h[2-4]>\s*(?:<[^>]+>\s*){0,4}([^<]{3,120})/gi;
  let m: RegExpExecArray | null;

  while ((m = re.exec(html)) !== null) {
    const headingText = decode(m[1]).trim();
    const followText = decode(m[2]).trim();
    if (!looksLikeName(headingText)) continue;
    if (!looksLikeTitle(followText)) continue;

    out.push({
      name: cleanName(headingText),
      title: followText,
      category: categorizeRole(followText),
      linkedinUrl: null,
      profileImageUrl: null,
      sourceUrl,
    });
  }
  return out;
}

function findNameNearLinkedIn(htmlWindow: string, plainText: string): string | null {
  // Prefer headings inside the window
  const headingRe = /<h[1-5][^>]*>([^<]{3,60})<\/h[1-5]>/gi;
  let h: RegExpExecArray | null;
  let lastHeading: string | null = null;
  while ((h = headingRe.exec(htmlWindow)) !== null) {
    const t = decode(h[1]).trim();
    if (looksLikeName(t)) lastHeading = t;
  }
  if (lastHeading) return cleanName(lastHeading);

  // Fall back to capitalised name pattern in plain text near the end
  const trail = plainText.slice(-400);
  const nameRe = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z'’.-]+){1,2})\b/g;
  const candidates: string[] = [];
  let n: RegExpExecArray | null;
  while ((n = nameRe.exec(trail)) !== null) candidates.push(n[1]);
  for (let i = candidates.length - 1; i >= 0; i--) {
    if (looksLikeName(candidates[i])) return cleanName(candidates[i]);
  }
  return null;
}

function findTitleNear(plainText: string, name: string): string {
  const idx = plainText.indexOf(name);
  if (idx < 0) return '';
  const after = plainText.slice(idx + name.length, idx + name.length + 200);
  // First line/sentence after the name
  const candidate = after.split(/[\n.|·•—–]/)[0]?.trim() || '';
  if (looksLikeTitle(candidate)) return candidate.slice(0, 120);
  return '';
}

function findImageNear(htmlWindow: string): string | null {
  const imgRe = /<img[^>]+src=["']([^"']+)["']/i;
  const m = imgRe.exec(htmlWindow);
  return m ? m[1] : null;
}

function looksLikeName(s: string): boolean {
  if (!s) return false;
  if (s.length < 3 || s.length > 60) return false;
  if (/[<>{}]/.test(s)) return false;
  if (/\d/.test(s)) return false;
  // Two-or-more capitalised words, allowing apostrophes / hyphens
  return /^[A-Z][a-zA-Z'’.-]+(?:\s+[A-Z][a-zA-Z'’.-]+){1,3}$/.test(s.trim());
}

function looksLikeTitle(s: string): boolean {
  if (!s) return false;
  if (s.length < 3 || s.length > 120) return false;
  if (/[<>]/.test(s)) return false;
  // Must contain at least one role-ish keyword to count as a title
  return /\b(ceo|cto|cfo|coo|cmo|cro|cpo|cio|chief|founder|co-founder|president|director|head|vp|vice president|manager|lead|engineer|officer|partner)\b/i.test(s);
}

function categorizeRole(title: string): PersonCategory {
  if (!title) return 'other';
  for (const { category, patterns } of ROLE_KEYWORDS) {
    if (patterns.some((p) => p.test(title))) return category as PersonCategory;
  }
  return 'other';
}

function stripScriptsAndStyles(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ');
}

function stripTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function decode(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

function cleanName(name: string): string {
  return name.replace(/\s+/g, ' ').trim();
}

/**
 * Dedupe by (lowercased name + linkedinUrl). Prefer the candidate that has
 * a linkedinUrl, then the one with a non-empty title, then the longer title.
 */
function dedupe(people: KeyPerson[]): KeyPerson[] {
  const byKey = new Map<string, KeyPerson>();
  for (const p of people) {
    const key = p.linkedinUrl
      ? `li:${p.linkedinUrl.toLowerCase()}`
      : `n:${p.name.toLowerCase()}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, p);
      continue;
    }
    byKey.set(key, mergePerson(existing, p));
  }
  // Drop entries where category is 'other' AND title is empty — likely false positives
  return Array.from(byKey.values()).filter((p) => p.category !== 'other' || p.title.length > 0);
}

function mergePerson(a: KeyPerson, b: KeyPerson): KeyPerson {
  return {
    name: a.name.length >= b.name.length ? a.name : b.name,
    title: chooseTitle(a.title, b.title),
    category: a.category !== 'other' ? a.category : b.category,
    linkedinUrl: a.linkedinUrl || b.linkedinUrl,
    profileImageUrl: a.profileImageUrl || b.profileImageUrl,
    sourceUrl: a.sourceUrl,
  };
}

function chooseTitle(a: string, b: string): string {
  if (!a) return b;
  if (!b) return a;
  return a.length >= b.length ? a : b;
}
