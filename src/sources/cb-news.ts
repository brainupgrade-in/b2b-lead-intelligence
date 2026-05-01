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

    // CRITICAL: pickCompanyHomepageFromHtml previously returned the FIRST
    // non-aggregator URL in the body — which surfaced cited publications
    // (e.g. cnbc.com) as fake leads. Now the URL must plausibly belong to
    // the title-extracted subject company, else we drop the item.
    const homepageUrl = pickCompanyHomepageFromHtml(
      item.contentEncoded || item.description,
      companyName,
    );
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

/**
 * Action verbs commonly used in funding/launch/acquisition headlines.
 * The subject company name is the capitalised token sequence immediately
 * BEFORE the verb, with descriptor words ("Swedish", "Tech", "Startup") peeled.
 */
const ACTION_VERBS_RE = /\b(raises|raised|lands|landed|closes|closed|secures|secured|announces|announced|acquires|acquired|launches|launched|wraps|wrapped|nabs|nabbed|grabs|grabbed|debuts|debuted|expands|expanded|hires|hired|appoints|appointed|names|named|introduces|introduced|unveils|unveiled|files|filed|completes|completed|reveals|revealed|gets|gains|gained|reaches|reached|brings)\b/i;

const DESCRIPTOR_WORDS_RE = /^(swedish|german|french|chinese|us|uk|european|asian|israeli|indian|japanese|korean|nordic|legal|tech|saas|paas|iaas|startup|company|firm|fintech|edtech|insurtech|biotech|healthtech|cleantech|deeptech|enterprise|crypto|web3|ai|ml|the|a|an|new|leading|top|global|local|inc|llc|corp|ltd|gmbh|sàrl|co)$/i;

export function extractCompanyName(title: string): string | null {
  if (!title) return null;
  const cleanTitle = title.replace(/<[^>]+>/g, '').trim();

  // Strategy: scan for the first action verb and take the capitalised tokens
  // immediately before it. Falls back to leading cap-words if no verb found.
  const verbMatch = cleanTitle.match(ACTION_VERBS_RE);
  const before =
    verbMatch && verbMatch.index !== undefined
      ? cleanTitle.slice(0, verbMatch.index).trim()
      : cleanTitle;

  // Collect every capitalised token in `before` (in order).
  const capRe = /([A-Z][A-Za-z0-9.&'’-]+)/g;
  const tokens: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = capRe.exec(before)) !== null) tokens.push(m[1]);
  if (tokens.length === 0) return null;

  // Peel descriptor prefixes ("Swedish Legal Tech Startup Legora" → "Legora").
  while (tokens.length > 1 && DESCRIPTOR_WORDS_RE.test(tokens[0])) {
    tokens.shift();
  }

  // Take up to 3 remaining tokens — most company names are 1–3 words.
  return tokens.slice(0, 3).join(' ').replace(/[,.]+$/, '').trim() || null;
}

/**
 * Subject-aware URL picker. Scans `<a>` tags in the article body and only
 * returns a URL whose anchor text or hostname plausibly maps to the
 * title-extracted company name. Returns null when no confident match exists
 * — better to drop a lead than fabricate one (this was the CNBC bug:
 * the parser previously returned the first cited publisher's URL).
 */
export function pickCompanyHomepageFromHtml(
  html: string,
  companyName?: string | null,
): string | null {
  const nameTokens = companyName
    ? companyName
        .toLowerCase()
        .split(/\s+/)
        .filter((t) => t.length >= 3)
    : [];

  const linkRe = /<a[^>]+href=["'](https?:\/\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  // Backward-compat: when no company name supplied, fall back to first acceptable.
  let firstAcceptable: string | null = null;

  while ((m = linkRe.exec(html)) !== null) {
    const url = m[1];
    if (!isCompanyHomepage(url)) continue;

    if (nameTokens.length === 0) {
      // No subject context — caller wants legacy behaviour.
      return url;
    }

    const anchorText = m[2].toLowerCase().replace(/<[^>]+>/g, '');
    let host = '';
    try {
      host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    } catch {
      continue;
    }
    const firstLabel = host.split('.')[0];

    const matchesAnchor = nameTokens.some((t) => anchorText.includes(t));
    const matchesHost = nameTokens.some(
      (t) => firstLabel.includes(t) || t.includes(firstLabel),
    );
    if (matchesAnchor || matchesHost) return url;

    if (!firstAcceptable) firstAcceptable = url;
  }

  // If a subject name was supplied and no confident match, refuse rather than
  // emit a wrong lead. (firstAcceptable left unused on purpose.)
  return null;
}
