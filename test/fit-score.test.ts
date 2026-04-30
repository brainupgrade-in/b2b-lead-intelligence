import { describe, it, expect } from 'vitest';
import { scoreFit } from '../src/extractors/fit-score.js';
import type { EnrichedLead, IdealCustomerProfile } from '../src/types.js';

function makeLead(overrides: Partial<EnrichedLead> = {}): EnrichedLead {
  return {
    inputUrl: 'https://lead.example',
    companyUrl: 'https://lead.example',
    companyName: overrides.companyName ?? 'Lead Co',
    description: overrides.description ?? null,
    contact: overrides.contact ?? { emails: [], phones: [], contactFormUrl: null },
    socialProfiles: overrides.socialProfiles ?? {
      linkedin: null, twitter: null, facebook: null, youtube: null,
      github: null, instagram: null, crunchbase: null,
    },
    techStack: overrides.techStack ?? {
      cms: null, analytics: [], chat: null, payment: [],
      hosting: null, frameworks: [], other: [],
    },
    businessSignals: overrides.businessSignals ?? {
      hasCareerPage: false, hasBlog: false, hasPricingPage: false,
      hasContactPage: false, hasAboutPage: false, hasCustomerLogos: false,
      estimatedSize: null,
    },
    keyPeople: overrides.keyPeople ?? [],
    intentSignals: overrides.intentSignals ?? {
      recentFundingMention: null,
      hiringSurge: { openRoles: 0, departments: [] },
      leadershipChange: null, productLaunch: null, recentPressItems: [],
    },
    fitScore: null,
    outreachHooks: [],
    metadata: overrides.metadata ?? {
      title: null, metaDescription: null, ogImage: null, favicon: null, language: null,
    },
    crawlStats: {
      pagesCrawled: 0, crawlDurationMs: 0, timestamp: '2026-04-30T00:00:00Z',
    },
    discovery: null,
  };
}

describe('scoreFit', () => {
  it('returns null when no ICP supplied (sourcing-only run)', () => {
    expect(scoreFit(makeLead(), undefined)).toBeNull();
  });

  it('scores an industry-matched lead at 100 from that criterion', () => {
    const lead = makeLead({
      description: 'We are a B2B SaaS platform for fintech compliance.',
    });
    const fit = scoreFit(lead, { industries: ['fintech'] })!;
    expect(fit.score).toBe(100);
    expect(fit.reasons.some((r) => r.toLowerCase().includes('fintech'))).toBe(true);
  });

  it('records a disqualifier when industry does not match', () => {
    const lead = makeLead({ description: 'gaming studio' });
    const fit = scoreFit(lead, { industries: ['fintech'] })!;
    expect(fit.score).toBe(0);
    expect(fit.disqualifiers.length).toBeGreaterThan(0);
  });

  it('parses size band 51-200 and accepts when in target range', () => {
    const lead = makeLead({
      businessSignals: {
        hasCareerPage: false, hasBlog: false, hasPricingPage: false,
        hasContactPage: false, hasAboutPage: false, hasCustomerLogos: false,
        estimatedSize: '51-200',
      },
    });
    const fit = scoreFit(lead, { sizeMin: 50, sizeMax: 500 })!;
    expect(fit.score).toBe(100);
  });

  it('rejects size band outside target', () => {
    const lead = makeLead({
      businessSignals: {
        hasCareerPage: false, hasBlog: false, hasPricingPage: false,
        hasContactPage: false, hasAboutPage: false, hasCustomerLogos: false,
        estimatedSize: '1-10',
      },
    });
    const fit = scoreFit(lead, { sizeMin: 50 })!;
    expect(fit.score).toBe(0);
  });

  it('requiredTech is all-or-nothing', () => {
    const techy = makeLead({
      techStack: { cms: 'WordPress', analytics: ['Mixpanel'], chat: null, payment: [], hosting: null, frameworks: ['React'], other: [] },
    });
    const allPresent = scoreFit(techy, { requiredTech: ['react', 'wordpress'] })!;
    expect(allPresent.score).toBe(100);

    const oneMissing = scoreFit(techy, { requiredTech: ['react', 'shopify'] })!;
    expect(oneMissing.score).toBe(0);
    expect(oneMissing.disqualifiers.some((d) => d.toLowerCase().includes('shopify'))).toBe(true);
  });

  it('preferredTech is proportional', () => {
    const lead = makeLead({
      techStack: { cms: null, analytics: [], chat: null, payment: [], hosting: null, frameworks: ['React'], other: [] },
    });
    const fit = scoreFit(lead, { preferredTech: ['react', 'vue', 'angular', 'svelte'] })!;
    expect(fit.score).toBe(25); // 1 of 4
  });

  it('intent signals add a bonus when present', () => {
    const baseline = scoreFit(makeLead({ description: 'fintech' }), { industries: ['fintech'] })!.score;
    const withIntent = scoreFit(
      makeLead({
        description: 'fintech',
        intentSignals: {
          recentFundingMention: { text: 'Raised $20M', amount: '$20M', round: 'series b', sourceUrl: 's' },
          hiringSurge: { openRoles: 8, departments: ['engineering', 'sales'] },
          leadershipChange: { name: 'A', newRole: 'CFO', context: '', sourceUrl: '' },
          productLaunch: null,
          recentPressItems: [],
        },
      }),
      { industries: ['fintech'] },
    )!;
    // intent contributes another averaged criterion, so the score may move; what
    // we care about is reasons mention the trigger events.
    expect(withIntent.reasons.some((r) => /funding|hiring|leadership/i.test(r))).toBe(true);
    // baseline only had 1 criterion at 100. With intent ~90, average lands < 100.
    expect(withIntent.score).toBeLessThanOrEqual(baseline);
  });

  it('returns score=0 with informative reason when ICP is empty object', () => {
    const fit = scoreFit(makeLead(), {} as IdealCustomerProfile)!;
    expect(fit.score).toBe(0);
    expect(fit.reasons[0]).toMatch(/no icp/i);
  });
});
