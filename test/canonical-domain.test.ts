import { describe, it, expect } from 'vitest';
import {
  canonicalDomain,
  canonicalHomepage,
  isCompanyHomepage,
} from '../src/utils/canonical-domain.js';

describe('canonicalDomain', () => {
  it('strips scheme, www, port, trailing dot, and lowercases', () => {
    expect(canonicalDomain('https://www.Stripe.com:443/pricing?x=1')).toBe('stripe.com');
    expect(canonicalDomain('http://Foo.Example.COM.')).toBe('foo.example.com');
  });

  it('accepts bare hostnames (no scheme)', () => {
    expect(canonicalDomain('apify.com')).toBe('apify.com');
    expect(canonicalDomain('www.apify.com')).toBe('apify.com');
  });

  it('returns "" for empty input and best-effort for malformed', () => {
    expect(canonicalDomain('')).toBe('');
    // URL constructor recovers from this because we prepend https://
    expect(canonicalDomain('   foo bar  ')).toMatch(/foo|bar/);
  });

  it('is idempotent (regression: dedup correctness depends on this)', () => {
    const once = canonicalDomain('https://www.HubSpot.com/');
    const twice = canonicalDomain(once);
    expect(once).toBe(twice);
  });
});

describe('canonicalHomepage', () => {
  it('returns https://<host> regardless of input scheme/path', () => {
    expect(canonicalHomepage('http://www.acme.io/pricing')).toBe('https://acme.io');
    expect(canonicalHomepage('acme.io')).toBe('https://acme.io');
  });
});

describe('isCompanyHomepage', () => {
  it('rejects link aggregators and ATS hosts (per NON_COMPANY_HOSTS)', () => {
    expect(isCompanyHomepage('https://twitter.com/foo')).toBe(false);
    expect(isCompanyHomepage('https://news.ycombinator.com/item?id=1')).toBe(false);
    expect(isCompanyHomepage('https://github.com/some/repo')).toBe(false);
    expect(isCompanyHomepage('https://boards.greenhouse.io/foo')).toBe(false);
    expect(isCompanyHomepage('https://www.crunchbase.com/organization/x')).toBe(false);
  });

  it('rejects subdomains of banned hosts (e.g. jobs.lever.co)', () => {
    expect(isCompanyHomepage('https://jobs.lever.co/acme')).toBe(false);
    expect(isCompanyHomepage('https://efts.sec.gov/foo')).toBe(false);
  });

  it('accepts ordinary company homepages', () => {
    expect(isCompanyHomepage('https://stripe.com')).toBe(true);
    expect(isCompanyHomepage('https://www.hubspot.com/products')).toBe(true);
  });

  it('rejects empty / unparseable input', () => {
    expect(isCompanyHomepage('')).toBe(false);
  });
});
