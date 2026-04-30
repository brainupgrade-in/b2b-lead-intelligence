import {
  EnrichedLead,
  FitScore,
  IdealCustomerProfile,
} from '../types.js';

/**
 * Rule-based ICP fit scoring (0-100).
 *
 * The score is the average of contributing-criterion scores. Each criterion
 * the user defined contributes equally; criteria they didn't specify don't
 * pull the score down. Returns null when no ICP was supplied.
 */
export function scoreFit(
  lead: EnrichedLead,
  icp: IdealCustomerProfile | undefined,
): FitScore | null {
  if (!icp) return null;

  const reasons: string[] = [];
  const disqualifiers: string[] = [];
  const criteria: number[] = [];

  if (icp.industries?.length) {
    const sc = scoreIndustries(lead, icp.industries, reasons, disqualifiers);
    if (sc !== null) criteria.push(sc);
  }
  if (typeof icp.sizeMin === 'number' || typeof icp.sizeMax === 'number') {
    const sc = scoreSize(lead, icp.sizeMin, icp.sizeMax, reasons, disqualifiers);
    if (sc !== null) criteria.push(sc);
  }
  if (icp.requiredTech?.length) {
    const sc = scoreRequiredTech(lead, icp.requiredTech, reasons, disqualifiers);
    criteria.push(sc);
  }
  if (icp.preferredTech?.length) {
    const sc = scorePreferredTech(lead, icp.preferredTech, reasons);
    criteria.push(sc);
  }
  if (icp.geo?.length) {
    const sc = scoreGeo(lead, icp.geo, reasons, disqualifiers);
    if (sc !== null) criteria.push(sc);
  }
  if (icp.keywords?.length) {
    const sc = scoreKeywords(lead, icp.keywords, reasons);
    criteria.push(sc);
  }

  // Always add intent boost as a small bonus (max 100), so a strong intent
  // signal can lift a borderline-fit account.
  const intent = scoreIntent(lead, reasons);
  if (intent > 0) criteria.push(intent);

  if (criteria.length === 0) {
    return { score: 0, reasons: ['No ICP criteria provided'], disqualifiers: [] };
  }

  const avg = criteria.reduce((a, b) => a + b, 0) / criteria.length;
  return {
    score: Math.round(avg),
    reasons,
    disqualifiers,
  };
}

function scoreIndustries(
  lead: EnrichedLead,
  industries: string[],
  reasons: string[],
  disqualifiers: string[],
): number | null {
  const haystack = [
    lead.description ?? '',
    lead.metadata.metaDescription ?? '',
    lead.metadata.title ?? '',
    lead.companyName ?? '',
  ].join(' ').toLowerCase();

  const matched = industries.filter((ind) => haystack.includes(ind.toLowerCase()));
  if (matched.length > 0) {
    reasons.push(`Industry match: ${matched.join(', ')}`);
    return 100;
  }
  disqualifiers.push(`No industry match (looked for ${industries.join(', ')})`);
  return 0;
}

function scoreSize(
  lead: EnrichedLead,
  min: number | undefined,
  max: number | undefined,
  reasons: string[],
  disqualifiers: string[],
): number | null {
  const band = lead.businessSignals.estimatedSize; // '1-10' | '11-50' | '51-200' | '200+' | null
  if (!band) return null;
  const [bandMin, bandMax] = parseBand(band);

  const minOk = typeof min !== 'number' || bandMax >= min;
  const maxOk = typeof max !== 'number' || bandMin <= max;
  if (minOk && maxOk) {
    reasons.push(`Estimated size ${band} fits target range`);
    return 100;
  }
  disqualifiers.push(`Estimated size ${band} outside target range`);
  return 0;
}

function parseBand(band: string): [number, number] {
  if (band === '1-10') return [1, 10];
  if (band === '11-50') return [11, 50];
  if (band === '51-200') return [51, 200];
  if (band === '200+') return [200, 100000];
  return [0, 100000];
}

function scoreRequiredTech(
  lead: EnrichedLead,
  required: string[],
  reasons: string[],
  disqualifiers: string[],
): number {
  const stack = collectTechStrings(lead);
  const missing = required.filter((t) => !stack.some((s) => s.includes(t.toLowerCase())));
  if (missing.length === 0) {
    reasons.push(`All required tech present: ${required.join(', ')}`);
    return 100;
  }
  disqualifiers.push(`Missing required tech: ${missing.join(', ')}`);
  return 0;
}

function scorePreferredTech(
  lead: EnrichedLead,
  preferred: string[],
  reasons: string[],
): number {
  const stack = collectTechStrings(lead);
  const matched = preferred.filter((t) => stack.some((s) => s.includes(t.toLowerCase())));
  if (matched.length > 0) {
    reasons.push(`Preferred tech detected: ${matched.join(', ')}`);
  }
  return Math.round((matched.length / preferred.length) * 100);
}

function collectTechStrings(lead: EnrichedLead): string[] {
  const t = lead.techStack;
  return [
    t.cms,
    ...t.analytics,
    t.chat,
    ...t.payment,
    t.hosting,
    ...t.frameworks,
    ...t.other,
  ]
    .filter((s): s is string => !!s)
    .map((s) => s.toLowerCase());
}

function scoreGeo(
  lead: EnrichedLead,
  geos: string[],
  reasons: string[],
  disqualifiers: string[],
): number | null {
  const haystack = [
    lead.description ?? '',
    lead.metadata.metaDescription ?? '',
    lead.metadata.language ?? '',
    lead.contact.phones.join(' '),
  ].join(' ').toLowerCase();
  const matched = geos.filter((g) => haystack.includes(g.toLowerCase()));
  if (matched.length > 0) {
    reasons.push(`Geo signal match: ${matched.join(', ')}`);
    return 100;
  }
  // Geo is fuzzy — don't disqualify, just return 0 to lower the average.
  disqualifiers.push(`No clear geo signal for ${geos.join(', ')}`);
  return 0;
}

function scoreKeywords(
  lead: EnrichedLead,
  keywords: string[],
  reasons: string[],
): number {
  const haystack = [
    lead.description ?? '',
    lead.metadata.metaDescription ?? '',
    lead.metadata.title ?? '',
  ].join(' ').toLowerCase();
  const matched = keywords.filter((k) => haystack.includes(k.toLowerCase()));
  if (matched.length > 0) {
    reasons.push(`Keyword hits: ${matched.join(', ')}`);
  }
  return Math.round((matched.length / keywords.length) * 100);
}

function scoreIntent(lead: EnrichedLead, reasons: string[]): number {
  let pts = 0;
  const sig = lead.intentSignals;
  if (sig?.recentFundingMention) {
    pts += 40;
    reasons.push(`Funding signal: ${sig.recentFundingMention.text}`);
  }
  if (sig?.hiringSurge?.openRoles >= 5) {
    pts += 30;
    reasons.push(`Hiring surge: ${sig.hiringSurge.openRoles} open roles in ${sig.hiringSurge.departments.join(', ') || 'multiple depts'}`);
  } else if (sig?.hiringSurge?.openRoles > 0) {
    pts += 15;
    reasons.push(`Hiring activity: ${sig.hiringSurge.openRoles} open role(s)`);
  }
  if (sig?.leadershipChange) {
    pts += 20;
    reasons.push(`Leadership change: ${sig.leadershipChange.name} → ${sig.leadershipChange.newRole}`);
  }
  if (sig?.productLaunch) {
    pts += 10;
    reasons.push(`Recent product activity: ${sig.productLaunch.title}`);
  }
  return Math.min(100, pts);
}
