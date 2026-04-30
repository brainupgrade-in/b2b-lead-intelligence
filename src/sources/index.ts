import {
  IdealCustomerProfile,
  SourceName,
  SourcedLead,
  SourcingConfig,
  TriggerEventType,
} from '../types.js';
import { canonicalDomain } from '../utils/canonical-domain.js';
import { findYcLeads } from './yc.js';
import { findHnHiringLeads } from './hn-hiring.js';
import { findCbNewsLeads } from './cb-news.js';

/**
 * Run the configured sourcing modules in parallel, dedupe by canonical domain,
 * relevance-score against the ICP, and cap to maxResults.
 */
export async function sourceLeads(
  cfg: SourcingConfig,
  icp: IdealCustomerProfile | undefined,
): Promise<SourcedLead[]> {
  const sources = cfg.sources ?? [];
  if (sources.length === 0) return [];

  const cap = cfg.maxResults ?? 25;
  // Per-source budget — slightly over-source so dedupe doesn't starve us.
  const perSource = Math.max(Math.ceil((cap * 1.5) / sources.length), 8);

  // Industries / keywords come from the sourcing block first, then fall back
  // to the ICP block so a single ICP description drives both stages.
  const industries = cfg.industries ?? icp?.industries;
  const keywords = cfg.keywords ?? icp?.keywords;
  const triggerSet = cfg.triggerEventTypes ? new Set(cfg.triggerEventTypes) : null;

  const tasks = sources.map((s) => runOne(s, { industries, keywords, recencyDays: cfg.recencyDays, maxResults: perSource }));
  const results = await Promise.allSettled(tasks);

  const merged: SourcedLead[] = [];
  for (const r of results) {
    if (r.status === 'fulfilled') merged.push(...r.value);
  }

  const triggerFiltered = triggerSet
    ? merged.filter((l) => l.discoverySignals.some((s) => triggerSet.has(s.type)))
    : merged;

  const deduped = dedupeByDomain(triggerFiltered);
  const scored = deduped.map((l) => ({ ...l, relevanceScore: scoreRelevance(l, icp, keywords) }));

  scored.sort((a, b) => b.relevanceScore - a.relevanceScore);
  return scored.slice(0, cap);
}

interface PerSourceCriteria {
  industries?: string[];
  keywords?: string[];
  recencyDays?: number;
  maxResults?: number;
}

async function runOne(source: SourceName, c: PerSourceCriteria): Promise<SourcedLead[]> {
  switch (source) {
    case 'yc':
      return findYcLeads({ industries: c.industries, keywords: c.keywords, maxResults: c.maxResults });
    case 'hn-hiring':
      return findHnHiringLeads({ keywords: c.keywords, recencyDays: c.recencyDays, maxResults: c.maxResults });
    case 'cb-news':
      return findCbNewsLeads({ keywords: c.keywords, recencyDays: c.recencyDays, maxResults: c.maxResults });
    default:
      return [];
  }
}

/**
 * Merge leads that share a canonical domain — preserve all sources and signals
 * so a company that surfaces via multiple sources gets correctly ranked.
 */
export function dedupeByDomain(leads: SourcedLead[]): SourcedLead[] {
  const byDomain = new Map<string, SourcedLead>();
  for (const lead of leads) {
    const key = canonicalDomain(lead.companyUrl);
    if (!key) continue;
    const prev = byDomain.get(key);
    if (!prev) {
      byDomain.set(key, lead);
      continue;
    }
    byDomain.set(key, {
      ...prev,
      companyName: prev.companyName.length >= lead.companyName.length ? prev.companyName : lead.companyName,
      discoverySources: Array.from(new Set([...prev.discoverySources, ...lead.discoverySources])),
      discoverySignals: [...prev.discoverySignals, ...lead.discoverySignals],
      firstSeenAt: prev.firstSeenAt < lead.firstSeenAt ? prev.firstSeenAt : lead.firstSeenAt,
    });
  }
  return Array.from(byDomain.values());
}

/**
 * Relevance score (0-100) based on:
 *   + multi-source overlap (each extra source after the first adds 15)
 *   + signal-type weighting: funding > leadership > hiring > launch > directory
 *   + ICP keyword/industry hits in the lead text
 */
export function scoreRelevance(
  lead: SourcedLead,
  icp: IdealCustomerProfile | undefined,
  keywords: string[] | undefined,
): number {
  const signalWeights: Record<TriggerEventType, number> = {
    funding: 35,
    leadership: 25,
    hiring: 20,
    launch: 15,
    directory: 10,
  };
  const types = new Set(lead.discoverySignals.map((s) => s.type));
  let score = 0;
  for (const t of types) score += signalWeights[t] ?? 0;

  // Multi-source bonus
  if (lead.discoverySources.length > 1) {
    score += Math.min(30, (lead.discoverySources.length - 1) * 15);
  }

  // ICP keyword hits in the signal text (proxy for fit at sourcing time —
  // the post-enrichment fitScore is the rigorous one)
  const blob = (
    lead.companyName + ' ' +
    lead.discoverySignals.map((s) => s.text).join(' ')
  ).toLowerCase();
  if (keywords?.length) {
    const hits = keywords.filter((k) => blob.includes(k.toLowerCase())).length;
    score += hits * 8;
  }
  if (icp?.industries?.length) {
    const hits = icp.industries.filter((i) => blob.includes(i.toLowerCase())).length;
    score += hits * 6;
  }

  return Math.max(0, Math.min(100, Math.round(score)));
}
