import { SourcedLead } from '../types.js';
import { canonicalDomain, canonicalHomepage, isCompanyHomepage } from '../utils/canonical-domain.js';

/**
 * Crunchbase News RSS — the journalism site (news.crunchbase.com), NOT the
 * Crunchbase database. Public RSS feed, no login.
 *
 * Each item is an article about a startup event (funding, M&A, launch). We
 * scan article titles and content for funding signals and pull the first
 * outbound link that points to the subject company's homepage.
 */

const FEED_URL = 'https://news.crunchbase.com/feed/';

export interface CbNewsCriteria {
  keywords?: string[];
  recencyDays?: number;
  maxResults?: number;
}

export async function findCbNewsLeads(criteria: CbNewsCriteria): Promise<SourcedLead[]> {
  const xml = await fetchFeed();
  if (!xml) return [];
  const items = parseRssItems(xml);

  const cutoffMs = criteria.recencyDays
    ? Date.now() - criteria.recencyDays * 86_400_000
    : 0;

  const out: SourcedLead[] = [];
  const seen = new Set<string>();

  for (const item of items) {
    if (cutoffMs && item.pubDateMs && item.pubDateMs < cutoffMs) continue;

    const fundingMatch = matchFunding(item.title + ' ' + item.description);
    const companyName = extractCompanyName(item.title);
    if (!companyName) continue;

    if (criteria.keywords?.length) {
      const blob = (item.title + ' ' + item.description).toLowerCase();
      const hit = criteria.keywords.some((k) => blob.includes(k.toLowerCase()));
      if (!hit) continue;
    }

    const homepageUrl = pickCompanyHomepageFromHtml(item.contentEncoded || item.description);
    if (!homepageUrl) continue;

    const domainKey = canonicalDomain(homepageUrl);
    if (!domainKey || seen.has(domainKey)) continue;
    seen.add(domainKey);

    out.push({
      companyName,
      companyUrl: canonicalHomepage(homepageUrl),
      discoverySources: ['cb-news'],
      discoverySignals: [
        {
          type: fundingMatch ? 'funding' : 'launch',
          text: fundingMatch ? `${item.title} — ${fundingMatch}` : item.title,
          sourceUrl: item.link,
          seenAt: item.pubDateMs ? new Date(item.pubDateMs).toISOString() : new Date().toISOString(),
        },
      ],
      firstSeenAt: item.pubDateMs ? new Date(item.pubDateMs).toISOString() : new Date().toISOString(),
      relevanceScore: 0,
    });

    if (criteria.maxResults && out.length >= criteria.maxResults) break;
  }

  return out;
}

async function fetchFeed(): Promise<string | null> {
  try {
    const res = await fetch(FEED_URL, { headers: { 'User-Agent': 'lead-enrichment-tool/1.0 (Apify Actor)' } });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

export interface RssItem {
  title: string;
  link: string;
  description: string;
  contentEncoded: string;
  pubDateMs: number | null;
}

export function parseRssItems(xml: string): RssItem[] {
  const items: RssItem[] = [];
  const itemRe = /<item\b[^>]*>([\s\S]*?)<\/item>/gi;
  let m: RegExpExecArray | null;
  while ((m = itemRe.exec(xml)) !== null) {
    const block = m[1];
    items.push({
      title: stripCdata(extractTag(block, 'title')),
      link: stripCdata(extractTag(block, 'link')).trim(),
      description: stripCdata(extractTag(block, 'description')),
      contentEncoded: stripCdata(extractTag(block, 'content:encoded')),
      pubDateMs: parseDate(stripCdata(extractTag(block, 'pubDate'))),
    });
  }
  return items;
}

function extractTag(block: string, tag: string): string {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
  return block.match(re)?.[1] ?? '';
}

function stripCdata(s: string): string {
  return s.replace(/^<!\[CDATA\[/, '').replace(/\]\]>$/, '').trim();
}

function parseDate(s: string): number | null {
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}

const FUNDING_RE = /\b(\$[\d.,]+\s?(?:m|mm|million|b|bn|billion))\b|\b(series\s+[a-h])\b|\b(seed|pre-seed)\b/i;

export function matchFunding(text: string): string | null {
  const m = text.match(FUNDING_RE);
  return m ? (m[0] || '').trim() : null;
}

export function extractCompanyName(title: string): string | null {
  // CB News headlines often follow patterns like:
  //   "Acme Raises $20M Series B"  ->  "Acme"
  //   "Acme, A Sales Tool, Lands $5M"
  //   "Acme Acquires BetaCo"        ->  "Acme"
  if (!title) return null;
  const cleanTitle = title.replace(/<[^>]+>/g, '').trim();
  const capWords = /^([A-Z][A-Za-z0-9.&'’-]+(?:\s+[A-Z][A-Za-z0-9.&'’-]+){0,4})/;
  const m = cleanTitle.match(capWords);
  if (!m) return null;
  return m[1].replace(/[,.]+$/, '').trim();
}

export function pickCompanyHomepageFromHtml(html: string): string | null {
  const re = /<a[^>]+href=["'](https?:\/\/[^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const url = m[1];
    if (isCompanyHomepage(url)) return url;
  }
  return null;
}
