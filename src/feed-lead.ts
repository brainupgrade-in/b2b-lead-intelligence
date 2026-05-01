import {
  EnrichedLead,
  DiscoveryBlock,
  DiscoverySignal,
  IdealCustomerProfile,
  IntentSignals,
  TriggerEventType,
} from './types.js';
import { scoreFit } from './extractors/fit-score.js';
import { inferDepartmentsFromText } from './extractors/intent-signals.js';

/**
 * Feed-mode lead builder.
 *
 * Skips the per-site crawler entirely. Constructs an EnrichedLead from the
 * discovery block alone, which means: company name + URL come from the source
 * (not re-extracted from the homepage), description is the discovery signal
 * snippet, intentSignals are derived from the signal type, and fitScore runs
 * on the limited data we have (industries / keywords / intent — no tech-stack,
 * no size band, no geo).
 *
 * Output is a thin record: contact / socialProfiles / techStack / keyPeople
 * stay empty. The user paid 5x less for this; expectations match.
 */
export function buildFeedLead(
  target: { url: string; sourcedName?: string; discovery: DiscoveryBlock | null },
  icp: IdealCustomerProfile | undefined,
): EnrichedLead {
  const discovery = target.discovery;
  const description = pickDescription(discovery?.signals);
  const intentSignals = deriveIntentFromDiscovery(discovery?.signals);

  const lead: EnrichedLead = {
    inputUrl: target.url,
    companyUrl: target.url,
    companyName: target.sourcedName ?? null,
    description,
    contact: { emails: [], phones: [], contactFormUrl: null },
    socialProfiles: {
      linkedin: null, twitter: null, facebook: null, youtube: null,
      github: null, instagram: null, crunchbase: null,
    },
    techStack: { cms: null, analytics: [], chat: null, payment: [], hosting: null, frameworks: [], other: [] },
    businessSignals: {
      hasCareerPage: false, hasBlog: false, hasPricingPage: false,
      hasContactPage: false, hasAboutPage: false, hasCustomerLogos: false,
      estimatedSize: null,
    },
    keyPeople: [],
    intentSignals,
    fitScore: null,
    outreachHooks: [],
    metadata: { title: null, metaDescription: null, ogImage: null, favicon: null, language: null },
    crawlStats: {
      pagesCrawled: 0,
      crawlDurationMs: 0,
      timestamp: new Date().toISOString(),
    },
    discovery,
  };

  // ICP fit on the data we have. Industry/keyword criteria use description as
  // their haystack; size/tech/geo criteria gracefully return null and don't
  // pull the average down.
  lead.fitScore = scoreFit(lead, icp);

  return lead;
}

/**
 * Pick the longest non-empty discovery signal text as the lead description.
 * Sourcing modules already truncate to ~240 chars, so this is safe.
 */
function pickDescription(signals: DiscoverySignal[] | undefined): string | null {
  if (!signals?.length) return null;
  const texts = signals.map((s) => s.text).filter((t): t is string => !!t && t.length > 0);
  if (texts.length === 0) return null;
  texts.sort((a, b) => b.length - a.length);
  return texts[0];
}

/**
 * Build intentSignals from the discovery block. We don't have a crawled
 * funding press article, but we know the signal *type*, so we surface the
 * matching field with the signal text as evidence.
 */
function deriveIntentFromDiscovery(signals: DiscoverySignal[] | undefined): IntentSignals {
  const empty: IntentSignals = {
    recentFundingMention: null,
    hiringSurge: { openRoles: 0, departments: [] },
    leadershipChange: null,
    productLaunch: null,
    recentPressItems: [],
  };
  if (!signals?.length) return empty;

  const fundingSig = signals.find((s) => s.type === 'funding');
  const hiringSig = signals.find((s) => s.type === 'hiring');
  const leadershipSig = signals.find((s) => s.type === 'leadership');
  const launchSig = signals.find((s) => s.type === 'launch');

  return {
    recentFundingMention: fundingSig
      ? {
          text: fundingSig.text,
          amount: extractAmount(fundingSig.text),
          round: extractRound(fundingSig.text),
          sourceUrl: fundingSig.sourceUrl,
        }
      : null,
    hiringSurge: hiringSig
      ? { openRoles: 1, departments: inferDepartmentsFromText(hiringSig.text) }
      : { openRoles: 0, departments: [] },
    leadershipChange: leadershipSig
      ? {
          name: '', // can't reliably extract a person name from a headline alone
          newRole: '',
          context: leadershipSig.text,
          sourceUrl: leadershipSig.sourceUrl,
        }
      : null,
    productLaunch: launchSig
      ? { title: launchSig.text.slice(0, 200), sourceUrl: launchSig.sourceUrl }
      : null,
    recentPressItems: signals
      .filter((s) => s.type === 'funding' || s.type === 'launch' || s.type === 'leadership')
      .map((s) => s.text)
      .slice(0, 5),
  };
}

function extractAmount(text: string): string | null {
  const m = text.match(/\$[\d.,]+\s?(m|mm|million|b|bn|billion)?/i);
  return m ? m[0] : null;
}

function extractRound(text: string): string | null {
  const m = text.match(/series\s+[a-h]/i);
  if (m) return m[0].toLowerCase().replace(/\s+/g, ' ');
  if (/\bseed\b/i.test(text)) return 'seed';
  if (/\bpre-?seed\b/i.test(text)) return 'pre-seed';
  return null;
}

// Suppress unused-type-import warnings; TriggerEventType is referenced via
// DiscoverySignal but kept here for documentation.
export type { TriggerEventType };
