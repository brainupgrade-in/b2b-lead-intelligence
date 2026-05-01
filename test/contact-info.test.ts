import { describe, it, expect } from 'vitest';
import { aggregateContactInfo } from '../src/extractors/contact-info.js';

const page = (text: string, url = 'https://acme.com') => ({
  html: `<html><body>${text}</body></html>`,
  text,
  links: [],
  url,
});

describe('aggregateContactInfo: cross-domain email filter', () => {
  // REGRESSION: BIT Capital surfaced kundenberatung@fondsnet.de as a contact
  // because the filter previously accepted ANY email from the crawled HTML.
  it('drops emails whose domain does not match the lead domain', () => {
    const out = aggregateContactInfo(
      [page('Reach us at info@acme.com or kundenberatung@partner.de')],
      'acme.com',
    );
    expect(out.emails).toContain('info@acme.com');
    expect(out.emails).not.toContain('kundenberatung@partner.de');
  });

  it('accepts emails on subdomains of the lead domain', () => {
    const out = aggregateContactInfo(
      [page('sales@eu.acme.com and team@acme.com')],
      'acme.com',
    );
    expect(out.emails).toEqual(expect.arrayContaining(['sales@eu.acme.com', 'team@acme.com']));
  });

  it('does not match an unrelated domain that happens to end with the same suffix', () => {
    const out = aggregateContactInfo(
      [page('admin@notacme.com and info@acme.com')],
      'acme.com',
    );
    expect(out.emails).toContain('info@acme.com');
    expect(out.emails).not.toContain('admin@notacme.com');
  });

  it('falls back to legacy behaviour when no companyDomain is supplied', () => {
    const out = aggregateContactInfo([
      page('a@one.com b@two.com'),
    ]);
    expect(out.emails).toEqual(expect.arrayContaining(['a@one.com', 'b@two.com']));
  });
});
