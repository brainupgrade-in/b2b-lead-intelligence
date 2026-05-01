import { SourcedLead } from '../types.js';
import { canonicalDomain, canonicalHomepage, isCompanyHomepage } from '../utils/canonical-domain.js';

/**
 * Hacker News "Ask HN: Who is hiring?" — surfaces actively-hiring tech companies.
 *
 * Uses the public Algolia HN API (no auth, no login):
 *   - https://hn.algolia.com/api/v1/search?query=...&tags=story
 *   - https://hn.algolia.com/api/v1/items/<id>     (full comment tree for a story)
 *
 * Strategy:
 *   1. Find the most recent "Ask HN: Who is hiring?" story posted by user
 *      `whoishiring` (the canonical author for the monthly thread).
 *   2. Fetch its comment tree.
 *   3. Each top-level comment is a hiring post. Parse company name + URL +
 *      role hints, filtering by ICP keywords and recencyDays.
 */

const ALGOLIA_BASE = 'https://hn.algolia.com/api/v1';

interface HnSearchHit {
  objectID: string;
  title: string;
  author: string;
  created_at_i: number;
}

interface HnItem {
  id: number;
  text?: string;
  created_at_i?: number;
  author?: string;
  children?: HnItem[];
}

export interface HnHiringCriteria {
  keywords?: string[];
  recencyDays?: number;
  maxResults?: number;
}

export async function findHnHiringLeads(criteria: HnHiringCriteria): Promise<SourcedLead[]> {
  const story = await findLatestHiringStory();
  if (!story) return [];

  const item = await fetchItem(story.objectID);
  if (!item?.children?.length) return [];

  const cutoff = criteria.recencyDays
    ? Math.floor(Date.now() / 1000) - criteria.recencyDays * 86400
    : 0;
  const monthLabel = story.title.match(/\(([^)]+)\)/)?.[1]?.trim() ?? story.title;
  const sourceUrl = `https://news.ycombinator.com/item?id=${story.objectID}`;

  const out: SourcedLead[] = [];
  const seen = new Set<string>();

  for (const comment of item.children) {
    if (!comment.text) continue;
    if (cutoff && (comment.created_at_i ?? 0) < cutoff) continue;

    const parsed = parseHiringComment(comment.text);
    if (!parsed) continue;

    if (criteria.keywords?.length) {
      const blob = (comment.text + ' ' + parsed.name).toLowerCase();
      const hit = criteria.keywords.some((k) => blob.includes(k.toLowerCase()));
      if (!hit) continue;
    }

    const domainKey = canonicalDomain(parsed.url);
    if (!domainKey || seen.has(domainKey)) continue;
    seen.add(domainKey);

    out.push({
      companyName: parsed.name,
      companyUrl: canonicalHomepage(parsed.url),
      discoverySources: [`hn-hiring:${monthLabel}`],
      discoverySignals: [
        {
          type: 'hiring',
          text: parsed.summary || `Posted in HN "${monthLabel}" hiring thread`,
          sourceUrl,
          seenAt: new Date((comment.created_at_i ?? story.created_at_i) * 1000).toISOString(),
        },
      ],
      firstSeenAt: new Date((comment.created_at_i ?? story.created_at_i) * 1000).toISOString(),
      relevanceScore: 0,
    });

    if (criteria.maxResults && out.length >= criteria.maxResults) break;
  }

  return out;
}

async function findLatestHiringStory(): Promise<HnSearchHit | null> {
  // search_by_date returns hits sorted by created_at desc, which is what we want
  // for "find the most recent hiring thread". Filter to titles that start with
  // "Ask HN: Who is hiring" so we exclude the parallel "Who wants to be hired"
  // monthly thread from the same author.
  const url = `${ALGOLIA_BASE}/search_by_date?tags=story,author_whoishiring&hitsPerPage=10`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = (await res.json()) as { hits: HnSearchHit[] };
  const hiringRe = /^ask hn:\s*who is hiring/i;
  return (data.hits ?? []).find((h) => hiringRe.test(h.title ?? '')) ?? null;
}

async function fetchItem(id: string): Promise<HnItem | null> {
  const res = await fetch(`${ALGOLIA_BASE}/items/${id}`);
  if (!res.ok) return null;
  return (await res.json()) as HnItem;
}

export interface ParsedHiringComment {
  name: string;
  url: string;
  summary: string;
}

export function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9A-Fa-f]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

/**
 * Parse a HN "who is hiring" comment. Format is loose, but conventions:
 *   - First line typically holds the company name (often bold/emphasised)
 *   - First http link is usually the company website
 *   - Remote / on-site / role hints scattered through the rest
 *
 * Note: HN Algolia returns HTML-entity-encoded forward slashes (`&#x2F;`) inside
 * href attributes, so we must decode entities BEFORE running URL regexes.
 */
export function parseHiringComment(htmlText: string): ParsedHiringComment | null {
  const decoded = decodeEntities(htmlText);

  // Strip HTML to get plain text we can scan
  const text = decoded
    .replace(/<p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .trim();

  // Pick the best company URL. Some HN posters embed only the careers/ATS
  // URL; prefer a homepage-shaped one when present.
  const rawUrl = pickBestCompanyUrl(decoded, text);
  if (!rawUrl) return null;

  // Company name = first non-empty line, with several layers of cleanup:
  //   - strip embedded URLs (their colon would otherwise split mid-URL)
  //   - strip leading [TAG] / [REMOTE] / dash prefixes
  //   - split on common delimiters (pipe, en/em-dash, colon, bullet)
  //   - strip trailing parentheticals like "(Series B)" or "(Remote US)"
  const firstLine = text
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 0) ?? '';

  const cleaned = firstLine
    .replace(/https?:\/\/[^\s)|]+/gi, '')      // 1. strip embedded URLs FIRST
    .replace(/^\s*\[[^\]]+\]\s*/g, '')          // 2. strip leading [TAG]
    .replace(/^\s*-\s*/g, '')                   // 3. strip leading dash
    .trim();

  const name = (cleaned.split(/[|–—:•]/)[0] ?? cleaned)
    .trim()
    .replace(/\s*\([^)]*\)\s*$/g, '')           // 4. strip trailing parenthetical
    .trim()
    .slice(0, 80);
  if (!name) return null;

  // One-sentence summary for the discoverySignal text
  const summary = text.replace(/\n+/g, ' ').slice(0, 240);

  return { name, url: rawUrl, summary };
}

/**
 * Hosts that look like ATS / careers-only domains (the company hires *through*
 * them but the company's own homepage is elsewhere). Prefer real homepages.
 */
function looksLikeCareersHost(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host.endsWith('.jobs')) return true; // .jobs TLD is reserved for employment
    if (host.startsWith('jobs.') || host.startsWith('careers.')) return true;
    if (host.includes('.careers')) return true;
    return false;
  } catch {
    return false;
  }
}

function pickBestCompanyUrl(decodedHtml: string, plainText: string): string | null {
  // Collect every http(s) URL present, in order, from both <a href> and bare links.
  const urls: string[] = [];
  for (const m of decodedHtml.matchAll(/href=["'](https?:\/\/[^"']+)["']/gi)) {
    urls.push(m[1]);
  }
  for (const m of plainText.matchAll(/(https?:\/\/[^\s<>")]+)/gi)) {
    urls.push(m[1]);
  }

  // Filter to plausible company homepages (drops aggregator hosts via NON_COMPANY_HOSTS)
  const candidates = urls.filter((u) => isCompanyHomepage(u));
  if (candidates.length === 0) return null;

  // Prefer a non-careers/ATS host when available. If only careers/ATS URLs
  // are present, fall back to the first — better than dropping the lead.
  const homepageish = candidates.find((u) => !looksLikeCareersHost(u));
  return homepageish ?? candidates[0];
}
