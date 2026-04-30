import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SourcedLead } from '../src/types.js';

// Mock the three child source modules. Using vi.mock() with string paths matched
// against the import in src/sources/index.ts (with the .js extension).
vi.mock('../src/sources/yc.js', () => ({
  findYcLeads: vi.fn(),
}));
vi.mock('../src/sources/hn-hiring.js', () => ({
  findHnHiringLeads: vi.fn(),
}));
vi.mock('../src/sources/cb-news.js', () => ({
  findCbNewsLeads: vi.fn(),
}));

import { findYcLeads } from '../src/sources/yc.js';
import { findHnHiringLeads } from '../src/sources/hn-hiring.js';
import { findCbNewsLeads } from '../src/sources/cb-news.js';
import {
  sourceLeads,
  dedupeByDomain,
  scoreRelevance,
} from '../src/sources/index.js';

const mockYc = vi.mocked(findYcLeads);
const mockHn = vi.mocked(findHnHiringLeads);
const mockCb = vi.mocked(findCbNewsLeads);

const lead = (overrides: Partial<SourcedLead> & { companyUrl: string }): SourcedLead => ({
  companyName: overrides.companyName ?? 'Lead Co',
  companyUrl: overrides.companyUrl,
  discoverySources: overrides.discoverySources ?? ['yc:W26'],
  discoverySignals: overrides.discoverySignals ?? [
    { type: 'directory', text: 't', sourceUrl: 's', seenAt: '2026-04-30T00:00:00Z' },
  ],
  firstSeenAt: overrides.firstSeenAt ?? '2026-04-30T00:00:00Z',
  relevanceScore: overrides.relevanceScore ?? 0,
});

describe('dedupeByDomain', () => {
  it('merges sources and signals across canonical-domain collisions', () => {
    const a = lead({
      companyUrl: 'https://acme.com',
      companyName: 'Acme',
      discoverySources: ['yc:W26'],
      discoverySignals: [{ type: 'directory', text: 'YC', sourceUrl: 's1', seenAt: '2026-04-29T00:00:00Z' }],
      firstSeenAt: '2026-04-29T00:00:00Z',
    });
    const b = lead({
      companyUrl: 'https://www.acme.com',
      companyName: 'Acme Robotics',
      discoverySources: ['hn-hiring:April 2026'],
      discoverySignals: [{ type: 'hiring', text: 'Hiring SWE', sourceUrl: 's2', seenAt: '2026-04-30T00:00:00Z' }],
      firstSeenAt: '2026-04-30T00:00:00Z',
    });
    const merged = dedupeByDomain([a, b]);
    expect(merged).toHaveLength(1);
    expect(merged[0].companyName).toBe('Acme Robotics'); // longer name wins
    expect(new Set(merged[0].discoverySources)).toEqual(new Set(['yc:W26', 'hn-hiring:April 2026']));
    expect(merged[0].discoverySignals).toHaveLength(2);
    expect(merged[0].firstSeenAt).toBe('2026-04-29T00:00:00Z'); // earlier wins
  });

  it('keeps distinct domains separate', () => {
    const a = lead({ companyUrl: 'https://acme.com' });
    const b = lead({ companyUrl: 'https://beta.io' });
    expect(dedupeByDomain([a, b])).toHaveLength(2);
  });
});

describe('scoreRelevance', () => {
  it('weights signal types: funding > leadership > hiring > launch > directory', () => {
    const fundingLead = lead({
      companyUrl: 'https://a.com',
      discoverySignals: [{ type: 'funding', text: '', sourceUrl: '', seenAt: '' }],
    });
    const directoryLead = lead({
      companyUrl: 'https://b.com',
      discoverySignals: [{ type: 'directory', text: '', sourceUrl: '', seenAt: '' }],
    });
    expect(scoreRelevance(fundingLead, undefined, undefined)).toBeGreaterThan(
      scoreRelevance(directoryLead, undefined, undefined),
    );
  });

  it('adds multi-source bonus (15 per extra source, capped at 30)', () => {
    const single = lead({ companyUrl: 'https://x.com', discoverySources: ['yc'] });
    const multi = lead({ companyUrl: 'https://x.com', discoverySources: ['yc', 'hn-hiring', 'cb-news'] });
    const baseline = scoreRelevance(single, undefined, undefined);
    const boosted = scoreRelevance(multi, undefined, undefined);
    expect(boosted).toBeGreaterThanOrEqual(baseline + 30); // 2 extra sources × 15 = 30
  });

  it('counts ICP keyword hits in lead text', () => {
    const l = lead({
      companyUrl: 'https://x.com',
      companyName: 'AI Robotics Co',
      discoverySignals: [{ type: 'directory', text: 'ai for warehouses', sourceUrl: '', seenAt: '' }],
    });
    const without = scoreRelevance(l, undefined, undefined);
    const withKw = scoreRelevance(l, undefined, ['ai', 'robotics']);
    expect(withKw).toBeGreaterThan(without);
  });

  it('clamps to [0, 100]', () => {
    const monster = lead({
      companyUrl: 'https://x.com',
      companyName: 'AI ML Robotics SaaS',
      discoverySources: ['yc', 'hn', 'cb', 'd', 'e'],
      discoverySignals: [
        { type: 'funding', text: 'ai ml saas robotics', sourceUrl: '', seenAt: '' },
        { type: 'leadership', text: 'ai ml saas robotics', sourceUrl: '', seenAt: '' },
      ],
    });
    const score = scoreRelevance(monster, { industries: ['ai', 'ml', 'saas', 'robotics'] }, ['ai', 'ml', 'saas', 'robotics']);
    expect(score).toBeLessThanOrEqual(100);
    expect(score).toBeGreaterThanOrEqual(0);
  });
});

describe('sourceLeads orchestrator', () => {
  beforeEach(() => {
    mockYc.mockReset();
    mockHn.mockReset();
    mockCb.mockReset();
  });

  it('runs only the configured sources', async () => {
    mockHn.mockResolvedValue([lead({ companyUrl: 'https://hncorp.example' })]);
    mockYc.mockResolvedValue([]);
    mockCb.mockResolvedValue([]);

    await sourceLeads({ sources: ['hn-hiring'], maxResults: 5 }, undefined);
    expect(mockHn).toHaveBeenCalledOnce();
    expect(mockYc).not.toHaveBeenCalled();
    expect(mockCb).not.toHaveBeenCalled();
  });

  // APIFY OPERATIONAL: a single source crashing must not sink the whole run.
  it('isolates source failures (Promise.allSettled — one rejection does not crash the run)', async () => {
    mockYc.mockRejectedValue(new Error('YC down'));
    mockHn.mockResolvedValue([lead({ companyUrl: 'https://hn.example', companyName: 'HN Co' })]);
    mockCb.mockResolvedValue([lead({ companyUrl: 'https://cb.example', companyName: 'CB Co' })]);

    const out = await sourceLeads(
      { sources: ['yc', 'hn-hiring', 'cb-news'], maxResults: 10 },
      undefined,
    );
    expect(out).toHaveLength(2);
    expect(out.map((l) => l.companyUrl).sort()).toEqual([
      'https://cb.example',
      'https://hn.example',
    ]);
  });

  it('honours triggerEventTypes filter', async () => {
    mockHn.mockResolvedValue([
      lead({
        companyUrl: 'https://a.example',
        discoverySignals: [{ type: 'hiring', text: '', sourceUrl: '', seenAt: '' }],
      }),
    ]);
    mockYc.mockResolvedValue([
      lead({
        companyUrl: 'https://b.example',
        discoverySignals: [{ type: 'directory', text: '', sourceUrl: '', seenAt: '' }],
      }),
    ]);
    mockCb.mockResolvedValue([]);

    const out = await sourceLeads(
      { sources: ['yc', 'hn-hiring'], maxResults: 10, triggerEventTypes: ['hiring'] },
      undefined,
    );
    expect(out).toHaveLength(1);
    expect(out[0].companyUrl).toBe('https://a.example');
  });

  it('caps output at maxResults after scoring (highest relevance wins)', async () => {
    mockYc.mockResolvedValue([
      lead({
        companyUrl: 'https://low.example',
        discoverySignals: [{ type: 'directory', text: '', sourceUrl: '', seenAt: '' }],
      }),
    ]);
    mockHn.mockResolvedValue([
      lead({
        companyUrl: 'https://high.example',
        discoverySignals: [{ type: 'funding', text: '', sourceUrl: '', seenAt: '' }],
      }),
    ]);
    mockCb.mockResolvedValue([]);

    const out = await sourceLeads(
      { sources: ['yc', 'hn-hiring'], maxResults: 1 },
      undefined,
    );
    expect(out).toHaveLength(1);
    expect(out[0].companyUrl).toBe('https://high.example');
  });

  it('returns [] when no sources configured (no-op)', async () => {
    const out = await sourceLeads({ sources: [], maxResults: 10 }, undefined);
    expect(out).toEqual([]);
  });
});
