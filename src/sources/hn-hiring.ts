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

  // Find first http(s) link
  const linkMatch = decoded.match(/href=["'](https?:\/\/[^"']+)["']/i)
    ?? decoded.match(/(https?:\/\/[^\s<>"]+)/i);
  if (!linkMatch) return null;
  const rawUrl = linkMatch[1];
  if (!isCompanyHomepage(rawUrl)) return null;

  // Company name = first non-empty line, trimmed of common HN prefixes
  const firstLine = text
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 0) ?? '';

  // Strip leading location/role tags some posters add (e.g. "[REMOTE] Acme Inc")
  const cleaned = firstLine
    .replace(/^\s*\[[^\]]+\]\s*/g, '')
    .replace(/^\s*-\s*/g, '')
    .trim();

  const name = (cleaned.split(/[|–—:•]/)[0] ?? cleaned).trim().slice(0, 80);
  if (!name) return null;

  // One-sentence summary for the discoverySignal text
  const summary = text.replace(/\n+/g, ' ').slice(0, 240);

  return { name, url: rawUrl, summary };
}
