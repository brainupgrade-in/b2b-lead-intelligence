import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractKeyPeople } from '../src/extractors/key-people.js';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const fixture = (name: string) => readFileSync(join(FIXTURES, name), 'utf-8');

describe('extractKeyPeople', () => {
  it('parses JSON-LD Person schemas with sameAs LinkedIn URLs', () => {
    const people = extractKeyPeople([
      { url: 'https://acme.example/team', html: fixture('team-jsonld.html') },
    ]);
    const jane = people.find((p) => p.name === 'Jane Smith');
    expect(jane).toBeDefined();
    expect(jane!.linkedinUrl).toBe('https://linkedin.com/in/jane-smith');
    expect(jane!.profileImageUrl).toBe('https://acme.example/images/jane.jpg');
    // "founder" pattern is checked first → "& Co-Founder" in title gets categorized as founder
    expect(jane!.category).toBe('founder');

    const carlos = people.find((p) => p.name === 'Carlos Rivera');
    expect(carlos).toBeDefined();
    expect(carlos!.category).toBe('tech'); // CTO
    expect(carlos!.linkedinUrl).toBe('https://linkedin.com/in/carlos-rivera');
  });

  it('extracts card-block people with role keywords', () => {
    const people = extractKeyPeople([
      { url: 'https://acme.example/leadership', html: fixture('team-cards.html') },
    ]);
    const names = people.map((p) => p.name);
    expect(names).toContain('Priya Iyer');
    expect(names).toContain('Tom Becker');
    // "Lower Case" entry has no role-keyword-bearing title, so it should be filtered.
    expect(names).not.toContain('Lower Case');
  });

  it('skips pages whose URL does not look like a people/team page', () => {
    const people = extractKeyPeople([
      { url: 'https://acme.example/pricing', html: fixture('team-jsonld.html') },
    ]);
    expect(people).toEqual([]);
  });

  it('dedupes when JSON-LD and LinkedIn-anchor extractors find the same person', () => {
    // JSON-LD declares Carlos with linkedin, and the body also embeds his
    // LinkedIn URL near a heading — both paths should resolve to one entry.
    const html =
      `<html><head>` +
      `<script type="application/ld+json">${JSON.stringify({
        '@type': 'Person',
        name: 'Carlos Rivera',
        jobTitle: 'Chief Technology Officer',
        sameAs: 'https://linkedin.com/in/carlos-rivera',
      })}</script>` +
      `</head><body>` +
      `<h2>Carlos Rivera</h2><p>CTO</p>` +
      `<a href="https://linkedin.com/in/carlos-rivera">LinkedIn</a>` +
      `</body></html>`;
    const people = extractKeyPeople([{ url: 'https://acme.example/team', html }]);
    const carlos = people.filter((p) => p.linkedinUrl === 'https://linkedin.com/in/carlos-rivera');
    expect(carlos).toHaveLength(1);
    expect(carlos[0].name).toBe('Carlos Rivera');
  });
});
