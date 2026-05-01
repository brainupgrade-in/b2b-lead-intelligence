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

  // REGRESSION 1: "Shepherd (Series B) | ONSITE | San Francisco" was extracting
  // the parenthetical into the name.
  it('strips trailing parentheticals like "(Series B)" or "(Remote US)" from the name', () => {
    const shepherd = parseHiringComment(
      '<p>Shepherd (Series B) | ONSITE | San Francisco<p>Apply: <a href="https://shepherdinsurance.com">link</a>',
    );
    expect(shepherd?.name).toBe('Shepherd');

    const prairielearn = parseHiringComment(
      '<p>PrairieLearn (Remote US) — Full-Stack Software Engineer<p>Apply: <a href="https://prairielearn.com">apply</a>',
    );
    expect(prairielearn?.name).toBe('PrairieLearn');
  });

  // REGRESSION 2: "Amodo Design (https://amodo.com) | Frontend" was returning
  // "Amodo Design (https" — the `:` in the URL was being treated as a delimiter.
  it('does not split on colons inside embedded URLs (URL-stripping happens before delimiter split)', () => {
    const parsed = parseHiringComment(
      '<p>Amodo Design (https://amododesign.com) | Frontend Engineer<p>Apply: <a href="https://amododesign.com">go</a>',
    );
    expect(parsed?.name).toBe('Amodo Design');
  });

  // REGRESSION 3: Aqora's HN post linked only to quantum.jobs (their ATS).
  // The parser was happy to use it; we now prefer a homepage-shaped host
  // when one is present, and only fall back to careers hosts as a last resort.
  it('prefers a non-careers host when both are present in the comment', () => {
    const parsed = parseHiringComment(
      '<p>Acme Robotics<p>Site: <a href="https://acme.example">acme.example</a> Apply: <a href="https://jobs.acme.example/x">careers</a>',
    );
    expect(parsed?.url).toBe('https://acme.example');
  });

  it('falls back to a .jobs / careers URL only when no homepage URL exists', () => {
    const parsed = parseHiringComment(
      '<p>Aqora<p>Apply: <a href="https://quantum.jobs">quantum.jobs</a>',
    );
    // Better to keep the lead with a careers URL than to drop it entirely.
    expect(parsed?.name).toBe('Aqora');
    expect(parsed?.url).toBe('https://quantum.jobs');
  });
});
