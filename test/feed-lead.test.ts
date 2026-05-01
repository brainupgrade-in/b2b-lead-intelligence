import { describe, it, expect } from 'vitest';
import { buildFeedLead } from '../src/feed-lead.js';
import type { DiscoveryBlock } from '../src/types.js';

const baseDiscovery = (
  type: 'funding' | 'hiring' | 'leadership' | 'launch' | 'directory',
  text: string,
): DiscoveryBlock => ({
  sources: ['techcrunch'],
  signals: [{ type, text, sourceUrl: 'https://news.example/article', seenAt: '2026-04-30T00:00:00Z' }],
  firstSeenAt: '2026-04-30T00:00:00Z',
  relevanceScore: 50,
});

describe('buildFeedLead', () => {
  it('uses sourcedName, never re-extracts from the homepage', () => {
    const lead = buildFeedLead(
      {
        url: 'https://shepherdinsurance.com',
        sourcedName: 'Shepherd',
        discovery: baseDiscovery('funding', 'Shepherd raises $42M Series B'),
      },
      undefined,
    );
    expect(lead.companyName).toBe('Shepherd');
  });

  it('emits empty crawl-derived fields (no contact, no tech stack, no people)', () => {
    const lead = buildFeedLead(
      { url: 'https://x.example', sourcedName: 'X', discovery: baseDiscovery('directory', 'in YC W26') },
      undefined,
    );
    expect(lead.contact.emails).toEqual([]);
    expect(lead.techStack.cms).toBeNull();
    expect(lead.keyPeople).toEqual([]);
    expect(lead.businessSignals.estimatedSize).toBeNull();
    expect(lead.crawlStats.pagesCrawled).toBe(0);
  });

  it('derives recentFundingMention from a funding discovery signal', () => {
    const lead = buildFeedLead(
      {
        url: 'https://acme.example',
        sourcedName: 'Acme',
        discovery: baseDiscovery('funding', 'Acme raised $20M Series B'),
      },
      undefined,
    );
    expect(lead.intentSignals.recentFundingMention).not.toBeNull();
    expect(lead.intentSignals.recentFundingMention!.amount).toMatch(/\$20/i);
    expect(lead.intentSignals.recentFundingMention!.round).toContain('series b');
  });

  it('derives hiringSurge=1 with departments from a hiring discovery signal', () => {
    const lead = buildFeedLead(
      {
        url: 'https://acme.example',
        sourcedName: 'Acme',
        discovery: baseDiscovery('hiring', 'Acme | Senior Backend Engineer | Remote'),
      },
      undefined,
    );
    expect(lead.intentSignals.hiringSurge.openRoles).toBe(1);
    expect(lead.intentSignals.hiringSurge.departments).toContain('engineering');
  });

  it('derives productLaunch from a launch discovery signal', () => {
    const lead = buildFeedLead(
      {
        url: 'https://acme.example',
        sourcedName: 'Acme',
        discovery: baseDiscovery('launch', 'Acme unveils AI assistant'),
      },
      undefined,
    );
    expect(lead.intentSignals.productLaunch).not.toBeNull();
    expect(lead.intentSignals.productLaunch!.title).toContain('Acme');
  });

  it('runs fitScore on what data we have (no tech / size / geo)', () => {
    const lead = buildFeedLead(
      {
        url: 'https://acme.example',
        sourcedName: 'Acme',
        discovery: baseDiscovery('funding', 'Acme raises $20M Series B for B2B SaaS'),
      },
      { industries: ['SaaS'], keywords: ['B2B'] },
    );
    expect(lead.fitScore).not.toBeNull();
    // industry hit + keyword hit + intent bonus → some positive score
    expect(lead.fitScore!.score).toBeGreaterThan(0);
  });

  it('handles a discovery with no signals (degenerate but valid)', () => {
    const lead = buildFeedLead(
      { url: 'https://x.example', sourcedName: 'X', discovery: null },
      undefined,
    );
    expect(lead.companyName).toBe('X');
    expect(lead.intentSignals.recentFundingMention).toBeNull();
    expect(lead.fitScore).toBeNull();
  });
});
