import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseRssItems,
  extractCompanyName,
  matchFunding,
  pickCompanyHomepageFromHtml,
  findCbNewsLeads,
} from '../src/sources/cb-news.js';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const fixture = (name: string) => readFileSync(join(FIXTURES, name), 'utf-8');

describe('parseRssItems', () => {
  it('parses CDATA-wrapped title/description and content:encoded', () => {
    const items = parseRssItems(fixture('cb-news-feed.xml'));
    expect(items).toHaveLength(3);
    expect(items[0].title).toContain('Acme Robotics Raises');
    expect(items[0].link).toBe('https://news.crunchbase.com/venture/acme-robotics-series-b/');
    expect(items[0].contentEncoded).toContain('acmerobotics.example');
    expect(items[0].pubDateMs).toBeTypeOf('number');
  });
});

describe('matchFunding', () => {
  it('detects $XM Series B / seed wording', () => {
    expect(matchFunding('Acme Raises $20M Series B Led By Sequoia')).toMatch(/series b|\$20m/i);
    expect(matchFunding('Beta Lands $5M Seed To Automate')).toMatch(/seed|\$5m/i);
  });
  it('returns null for non-funding text', () => {
    expect(matchFunding('Acme launches new product')).toBeNull();
  });
});

describe('extractCompanyName', () => {
  it('extracts subject from "<Company> <verb> ..." headlines', () => {
    expect(extractCompanyName('Acme Robotics Raises $20M Series B')).toBe('Acme Robotics');
    expect(extractCompanyName('Beta Health Lands $5M Seed')).toBe('Beta Health');
  });

  // REGRESSION: previous behaviour returned "Swedish Legal Tech Startup Legora"
  // and let pickCompanyHomepageFromHtml return any cited URL — this surfaced
  // CNBC as a fake lead. The fix peels descriptor prefixes.
  it('peels descriptor words ("Swedish Legal Tech Startup Legora Lands ...") to "Legora"', () => {
    expect(extractCompanyName('Swedish Legal Tech Startup Legora Lands Another $50M In Nvidia-Led Series D Extension')).toBe('Legora');
    expect(extractCompanyName('UK Fintech Startup Brex Closes $40M')).toBe('Brex');
  });

  it('falls back to leading cap-words when no action verb is present', () => {
    expect(extractCompanyName('Acme Robotics — quarterly update')).toBe('Acme Robotics');
  });

  it('returns null when title does not start with capitalised words and has no verb-aligned subject', () => {
    expect(extractCompanyName('lowercase-name-startup raises money')).toBeNull();
  });
});

describe('pickCompanyHomepageFromHtml', () => {
  it('legacy mode (no companyName): skips aggregator links and returns first company-looking URL', () => {
    const html =
      '<a href="https://news.crunchbase.com/x">cb</a>' +
      '<a href="https://techcrunch.com/x">tc</a>' +
      '<a href="https://acmerobotics.example/">company</a>';
    expect(pickCompanyHomepageFromHtml(html)).toBe('https://acmerobotics.example/');
  });

  it('legacy mode: returns null when only aggregator/news hosts are linked', () => {
    const html =
      '<a href="https://news.crunchbase.com/x">cb</a>' +
      '<a href="https://techcrunch.com/x">tc</a>';
    expect(pickCompanyHomepageFromHtml(html)).toBeNull();
  });

  // REGRESSION (CNBC bug): when a companyName is supplied, the picker must
  // verify that the chosen URL plausibly belongs to that company — anchor
  // text or hostname token match — and refuse otherwise. Previously returned
  // any non-aggregator URL → cited cnbc.com surfaced as a "lead".
  it('strict mode: refuses URLs unrelated to the title-extracted company', () => {
    const html =
      '<a href="https://cnbc.com/2026/04/30/legal-tech.html">CNBC coverage</a>' +
      '<a href="https://reuters.com/x">Reuters</a>';
    expect(pickCompanyHomepageFromHtml(html, 'Legora')).toBeNull();
  });

  it('strict mode: accepts URLs whose hostname contains a name token', () => {
    const html = '<a href="https://legora.com/about">Legora homepage</a>';
    expect(pickCompanyHomepageFromHtml(html, 'Legora')).toBe('https://legora.com/about');
  });

  it('strict mode: accepts URLs whose anchor text contains the company name', () => {
    const html = '<a href="https://acme-prod.example/">Visit Legora</a>';
    expect(pickCompanyHomepageFromHtml(html, 'Legora')).toBe('https://acme-prod.example/');
  });

  it('strict mode: prefers the company link over a cited publication', () => {
    const html =
      '<a href="https://cnbc.com/x">CNBC coverage</a>' +
      '<a href="https://legora.com/">Legora</a>';
    expect(pickCompanyHomepageFromHtml(html, 'Legora')).toBe('https://legora.com/');
  });
});

describe('findCbNewsLeads (full pipeline, mocked fetch)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('end-to-end produces deduped, dated, signal-typed leads', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      text: async () => fixture('cb-news-feed.xml'),
    })) as unknown as typeof fetch);

    const leads = await findCbNewsLeads({ maxResults: 10 });
    // Item 3 has a non-capitalised title so extractCompanyName returns null -> dropped.
    expect(leads).toHaveLength(2);
    const acme = leads.find((l) => l.companyName.includes('Acme'))!;
    expect(acme).toBeDefined();
    expect(acme.companyUrl).toBe('https://acmerobotics.example');
    expect(acme.discoverySources).toEqual(['cb-news']);
    expect(acme.discoverySignals[0].type).toBe('funding');
    expect(acme.discoverySignals[0].sourceUrl).toContain('news.crunchbase.com');
  });

  it('returns [] gracefully when feed fetch fails (network resilience)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, text: async () => '' })) as unknown as typeof fetch);
    const leads = await findCbNewsLeads({ maxResults: 5 });
    expect(leads).toEqual([]);
  });

  it('returns [] when fetch throws (DNS / timeout simulation)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ENETUNREACH'); }) as unknown as typeof fetch);
    const leads = await findCbNewsLeads({ maxResults: 5 });
    expect(leads).toEqual([]);
  });
});
