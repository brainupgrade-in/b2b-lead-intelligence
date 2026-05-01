import { SourcedLead } from '../types.js';
import { canonicalDomain, canonicalHomepage } from '../utils/canonical-domain.js';
import {
  parseRssItems,
  extractCompanyName,
  matchFunding,
  pickCompanyHomepageFromHtml,
} from './cb-news.js';

/**
 * PRNewswire RSS — corporate press releases. Heavy B2B coverage:
 * funding announcements, leadership appointments, product launches, M&A.
 *
 * The structure is a standard RSS feed with `<item>` elements containing
 * `<title>`, `<link>`, `<description>`, `<content:encoded>`, `<pubDate>`.
 * Reuses the subject-aware parsing primitives from cb-news.ts.
 */

const FEED_URL = 'https://www.prnewswire.com/rss/news-releases-list.rss';

export interface PrNewswireCriteria {
  keywords?: string[];
  recencyDays?: number;
  maxResults?: number;
}

export async function findPrNewswireLeads(criteria: PrNewswireCriteria): Promise<SourcedLead[]> {
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

    const companyName = extractCompanyName(item.title);
    if (!companyName) continue;

    if (criteria.keywords?.length) {
      const blob = (item.title + ' ' + item.description).toLowerCase();
      const hit = criteria.keywords.some((k) => blob.includes(k.toLowerCase()));
      if (!hit) continue;
    }

    const homepageUrl = pickCompanyHomepageFromHtml(
      item.contentEncoded || item.description,
      companyName,
    );
    if (!homepageUrl) continue;

    const domainKey = canonicalDomain(homepageUrl);
    if (!domainKey || seen.has(domainKey)) continue;
    seen.add(domainKey);

    const fundingMatch = matchFunding(item.title + ' ' + item.description);
    const signalType = fundingMatch ? 'funding' : inferSignalType(item.title);
    const seenAt = item.pubDateMs ? new Date(item.pubDateMs).toISOString() : new Date().toISOString();

    out.push({
      companyName,
      companyUrl: canonicalHomepage(homepageUrl),
      discoverySources: ['prnewswire'],
      discoverySignals: [
        {
          type: signalType,
          text: fundingMatch ? `${item.title} — ${fundingMatch}` : item.title,
          sourceUrl: item.link,
          seenAt,
        },
      ],
      firstSeenAt: seenAt,
      relevanceScore: 0,
    });

    if (criteria.maxResults && out.length >= criteria.maxResults) break;
  }

  return out;
}

async function fetchFeed(): Promise<string | null> {
  try {
    const res = await fetch(FEED_URL, {
      headers: { 'User-Agent': 'b2b-lead-intelligence/1.0 (Apify Actor)' },
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

const LAUNCH_TITLE_RE = /\b(launch(?:es|ed|ing)?|introduc(?:es|ed|ing)|debut(?:s|ed)?|unveil(?:s|ed|ing)?|releases?|releasing|announces\s+(?:new|the))\b/i;
const LEADERSHIP_TITLE_RE = /\b(appoint(?:s|ed|ment)?|hir(?:es|ed)|name(?:s|d)?\s+(?:new|its)|join(?:s|ed)\s+as|promote(?:s|d)?|elects?|elected)\b/i;

function inferSignalType(title: string): 'funding' | 'launch' | 'leadership' | 'directory' {
  if (LEADERSHIP_TITLE_RE.test(title)) return 'leadership';
  if (LAUNCH_TITLE_RE.test(title)) return 'launch';
  return 'directory';
}
