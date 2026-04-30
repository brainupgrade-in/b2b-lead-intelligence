import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  decodeEntities,
  parseHiringComment,
} from '../src/sources/hn-hiring.js';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const fixture = (name: string) => readFileSync(join(FIXTURES, name), 'utf-8');

describe('decodeEntities', () => {
  it('decodes hex, decimal, and named HTML entities', () => {
    expect(decodeEntities('a&#x2F;b')).toBe('a/b');
    expect(decodeEntities('&#47;path')).toBe('/path');
    expect(decodeEntities('Tom&apos;s &amp; Jerry&#x27;s')).toBe("Tom's & Jerry's");
    expect(decodeEntities('&nbsp;x&nbsp;')).toBe(' x ');
  });

  it('leaves plain text untouched', () => {
    expect(decodeEntities('hello world')).toBe('hello world');
  });
});

describe('parseHiringComment', () => {
  // REGRESSION: build 1.0.16 returned 0 leads because HN Algolia HTML-encodes
  // forward slashes in href attributes as &#x2F;, and our URL regex required
  // literal "//". decodeEntities() must be applied BEFORE URL extraction.
  it('extracts URL from href with HTML-entity-encoded slashes', () => {
    const parsed = parseHiringComment(fixture('hn-comment-encoded.html'));
    expect(parsed).not.toBeNull();
    expect(parsed!.url).toBe('https://acmerobotics.example/careers/senior-backend');
    expect(parsed!.name).toBe('Acme Robotics');
    expect(parsed!.summary).toMatch(/autonomous warehouse robots/);
  });

  it('strips bracketed location/role tag prefixes from the company name', () => {
    const parsed = parseHiringComment(fixture('hn-comment-bracketed.html'));
    expect(parsed).not.toBeNull();
    expect(parsed!.name).toBe('Beta Health');
    // parseHiringComment returns the raw href (paths preserved); the orchestrator
    // is what canonicalizes to the homepage. Both paths point at the same domain.
    expect(parsed!.url).toMatch(/^https:\/\/betahealth\.example/);
  });

  it('returns null when only a non-company host (github) is linked', () => {
    const parsed = parseHiringComment(fixture('hn-comment-aggregator-link.html'));
    expect(parsed).toBeNull();
  });

  it('returns null when no URL is present at all', () => {
    expect(parseHiringComment('<p>just text, no link</p>')).toBeNull();
  });

  it('truncates very long company names to 80 chars', () => {
    const longName = 'A'.repeat(200);
    const html = `<p>${longName}<p>Apply: <a href="https://x.example">https://x.example</a>`;
    const parsed = parseHiringComment(html);
    expect(parsed).not.toBeNull();
    expect(parsed!.name.length).toBeLessThanOrEqual(80);
  });
});
