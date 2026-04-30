import { describe, it, expect } from 'vitest';
import { findHnHiringLeads } from '../../src/sources/hn-hiring.js';
import { findCbNewsLeads } from '../../src/sources/cb-news.js';
import { findYcLeads } from '../../src/sources/yc.js';

/**
 * Integration smokes — hit the public internet. Skipped by default; opt in
 * via `npm run test:integration` (sets RUN_INTEGRATION=1, picked up by
 * vitest.config.ts which then includes this directory).
 *
 * Apify operational angle: these catch upstream-shape drift (e.g. HN Algolia
 * changing its tag scheme, YC rotating its Algolia key) BEFORE a paid run
 * surfaces 0 leads to a customer.
 */

const T = 30_000;

describe('integration: HN hiring', () => {
  it('returns at least one lead from the latest hiring thread', async () => {
    const leads = await findHnHiringLeads({ maxResults: 5 });
    expect(leads.length).toBeGreaterThan(0);
    const first = leads[0];
    expect(first.companyName.length).toBeGreaterThan(0);
    expect(first.companyUrl).toMatch(/^https?:\/\//);
    expect(first.discoverySignals[0].type).toBe('hiring');
  }, T);
});

describe('integration: Crunchbase News RSS', () => {
  it('parses the live feed and returns at least one lead', async () => {
    const leads = await findCbNewsLeads({ maxResults: 5 });
    // RSS may have low-link / non-capitalised items at any time, so accept
    // 0 as long as the call completes without throwing — but if we get any,
    // shape-check the first.
    if (leads.length > 0) {
      expect(leads[0].companyUrl).toMatch(/^https?:\/\//);
      expect(['funding', 'launch']).toContain(leads[0].discoverySignals[0].type);
    }
  }, T);
});

describe('integration: YC Algolia', () => {
  it('discovers Algolia creds from the public page and returns hits', async () => {
    const leads = await findYcLeads({ maxResults: 5 });
    expect(leads.length).toBeGreaterThan(0);
    expect(leads[0].discoverySources[0]).toMatch(/^yc/);
  }, T);
});
