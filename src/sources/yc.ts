import { SourcedLead } from '../types.js';
import { canonicalDomain, canonicalHomepage, isCompanyHomepage } from '../utils/canonical-domain.js';

/**
 * Y Combinator companies directory — public Algolia-backed search.
 *
 * The YC site embeds an Algolia application ID and a *secured* search key in
 * `window.AlgoliaOpts` on every public page. We re-fetch this on each run so
 * we automatically pick up key rotations rather than hard-coding them.
 *
 * Index: `YCCompany_production`. Each hit returns `name`, `slug`, `website`,
 * `one_liner`, `long_description`, `batch`, `industries`, `all_locations`,
 * `team_size`, `status` — everything we need for both the discovery row AND
 * for downstream relevance scoring against the ICP.
 */

const YC_PUBLIC_PAGE = 'https://www.ycombinator.com/companies';
const YC_INDEX = 'YCCompany_production';

interface AlgoliaCreds {
  app: string;
  key: string;
}

interface YcHit {
  id?: number;
  name?: string;
  slug?: string;
  website?: string;
  one_liner?: string;
  long_description?: string;
  batch?: string;
  industries?: string[];
  all_locations?: string;
  team_size?: number;
  status?: string;
}

export interface YcCriteria {
  industries?: string[];
  keywords?: string[];
  maxResults?: number;
}

export async function findYcLeads(criteria: YcCriteria): Promise<SourcedLead[]> {
  const creds = await fetchAlgoliaCreds();
  if (!creds) return [];

  const queries = buildQueries(criteria);
  const out: SourcedLead[] = [];
  const seen = new Set<string>();
  const cap = criteria.maxResults ?? 30;

  for (const q of queries) {
    if (out.length >= cap) break;
    const remaining = cap - out.length;
    const hits = await runQuery(creds, q, Math.max(remaining * 2, 10));
    for (const hit of hits) {
      if (out.length >= cap) break;
      const lead = hitToLead(hit);
      if (!lead) continue;
      const domainKey = canonicalDomain(lead.companyUrl);
      if (!domainKey || seen.has(domainKey)) continue;
      seen.add(domainKey);
      out.push(lead);
    }
  }

  return out;
}

async function fetchAlgoliaCreds(): Promise<AlgoliaCreds | null> {
  try {
    const res = await fetch(YC_PUBLIC_PAGE, {
      headers: { 'User-Agent': 'lead-enrichment-tool/1.0 (Apify Actor)' },
    });
    if (!res.ok) return null;
    const html = await res.text();
    const m = html.match(/window\.AlgoliaOpts\s*=\s*(\{[^}]*\})/);
    if (!m) return null;
    const obj = JSON.parse(m[1]) as { app?: string; key?: string };
    if (!obj.app || !obj.key) return null;
    return { app: obj.app, key: obj.key };
  } catch {
    return null;
  }
}

interface Query {
  query: string;
  facetFilters?: string[][];
}

function buildQueries(criteria: YcCriteria): Query[] {
  // Each industry generates one query (Algolia AND-combines facetFilters within
  // a single inner array, OR-combines across outer arrays — we want OR-on-industry).
  const queries: Query[] = [];

  const baseQuery = (criteria.keywords ?? []).join(' ').trim();

  if (criteria.industries?.length) {
    for (const ind of criteria.industries) {
      queries.push({
        query: baseQuery,
        facetFilters: [[`industries:${ind}`]],
      });
    }
  } else {
    queries.push({ query: baseQuery });
  }

  return queries;
}

async function runQuery(creds: AlgoliaCreds, q: Query, hitsPerPage: number): Promise<YcHit[]> {
  const url = `https://${creds.app.toLowerCase()}-dsn.algolia.net/1/indexes/${YC_INDEX}/query`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'X-Algolia-Application-Id': creds.app,
        'X-Algolia-API-Key': creds.key,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: q.query ?? '',
        hitsPerPage,
        ...(q.facetFilters ? { facetFilters: q.facetFilters } : {}),
      }),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { hits?: YcHit[] };
    return data.hits ?? [];
  } catch {
    return [];
  }
}

function hitToLead(hit: YcHit): SourcedLead | null {
  if (!hit.name || !hit.website) return null;
  if (!isCompanyHomepage(hit.website)) return null;

  const batch = hit.batch ? `yc:${hit.batch}` : 'yc';
  const description = (hit.one_liner || hit.long_description || '').slice(0, 240);
  const seenAt = new Date().toISOString();

  return {
    companyName: hit.name,
    companyUrl: canonicalHomepage(hit.website),
    discoverySources: [batch],
    discoverySignals: [
      {
        type: 'directory',
        text: description
          ? `YC ${hit.batch ?? ''} — ${description}`
          : `Listed in YC directory${hit.batch ? ` (${hit.batch})` : ''}`,
        sourceUrl: `https://www.ycombinator.com/companies/${hit.slug ?? ''}`.replace(/\/$/, ''),
        seenAt,
      },
    ],
    firstSeenAt: seenAt,
    relevanceScore: 0,
  };
}
