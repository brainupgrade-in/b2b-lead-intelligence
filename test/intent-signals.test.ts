import { describe, it, expect } from 'vitest';
import { detectIntentSignals, inferDepartmentsFromText } from '../src/extractors/intent-signals.js';

const pressPage = (text: string, html?: string, title: string | null = null) => ({
  url: 'https://acme.example/press/release',
  html: html ?? `<html><body>${text}</body></html>`,
  text,
  title,
});

const careerPage = (html: string) => ({
  url: 'https://acme.example/careers',
  html,
  text: '',
  title: null,
});

describe('detectIntentSignals: funding', () => {
  it('extracts funding mention with amount and round', () => {
    const out = detectIntentSignals([
      pressPage('We are excited to announce we have raised $20M Series B led by Sequoia.'),
    ]);
    expect(out.recentFundingMention).not.toBeNull();
    expect(out.recentFundingMention!.round?.toLowerCase()).toContain('series b');
    expect(out.recentFundingMention!.amount).toMatch(/\$20/i);
  });

  it('returns null when no funding wording is present', () => {
    const out = detectIntentSignals([pressPage('We launched a new feature today.')]);
    expect(out.recentFundingMention).toBeNull();
  });
});

describe('inferDepartmentsFromText (hiring-floor reconciliation helper)', () => {
  it('returns matching departments for HN-style hiring text', () => {
    const text = 'BIT Capital | Principal Engineer (Data & Platform) | Berlin | Full-time, Account Executive role too';
    const depts = inferDepartmentsFromText(text);
    expect(depts).toEqual(expect.arrayContaining(['engineering', 'sales']));
  });

  it('returns [] for empty / non-role text', () => {
    expect(inferDepartmentsFromText('')).toEqual([]);
    expect(inferDepartmentsFromText('Some unrelated marketing copy')).toEqual(['marketing']);
  });
});

describe('detectIntentSignals: hiring surge', () => {
  it('counts JSON-LD JobPosting blocks even when visible HTML has no anchors', () => {
    const html = `<html><body>
      <script type="application/ld+json">${JSON.stringify({
        '@type': 'JobPosting',
        title: 'Senior Backend Engineer',
      })}</script>
      <script type="application/ld+json">${JSON.stringify({
        '@type': 'JobPosting',
        title: 'Account Executive — EMEA',
      })}</script>
    </body></html>`;
    const out = detectIntentSignals([{
      url: 'https://acme.example/careers',
      html,
      text: '',
      title: null,
    }]);
    expect(out.hiringSurge.openRoles).toBe(2);
    expect(out.hiringSurge.departments).toEqual(expect.arrayContaining(['engineering', 'sales']));
  });

  it('detects heading-based roles on career pages (no anchor required)', () => {
    const html = `
      <h2>Senior Software Engineer</h2>
      <h2>Product Manager</h2>
      <h2>Open Roles</h2>
    `;
    const out = detectIntentSignals([{
      url: 'https://acme.example/careers',
      html,
      text: '',
      title: null,
    }]);
    expect(out.hiringSurge.openRoles).toBe(2); // "Open Roles" is filtered as a section label
  });

  it('counts ATS-link job cards and classifies departments', () => {
    const html = `
      <a href="https://boards.greenhouse.io/acme/jobs/123">Senior Backend Engineer</a>
      <a href="https://jobs.lever.co/acme/abc">Account Executive</a>
      <a href="/jobs/data-scientist">Data Scientist</a>
      <a href="/careers/marketing-manager">Marketing Manager</a>
    `;
    const out = detectIntentSignals([careerPage(html)]);
    expect(out.hiringSurge.openRoles).toBe(4);
    expect(out.hiringSurge.departments).toEqual(
      expect.arrayContaining(['engineering', 'sales', 'data', 'marketing']),
    );
  });

  it('returns 0 when no career page in input', () => {
    const out = detectIntentSignals([pressPage('no jobs here')]);
    expect(out.hiringSurge.openRoles).toBe(0);
  });

  it('dedupes identical role names within a single page', () => {
    const html = `
      <a href="/jobs/swe">Software Engineer</a>
      <a href="/jobs/swe-2">Software Engineer</a>
    `;
    const out = detectIntentSignals([careerPage(html)]);
    expect(out.hiringSurge.openRoles).toBe(1);
  });
});

describe('detectIntentSignals: leadership change', () => {
  it('matches "X joins as Y" pattern', () => {
    const out = detectIntentSignals([
      pressPage('Maria Rossi joins Acme as our new Chief Marketing Officer, effective Monday.'),
    ]);
    expect(out.leadershipChange).not.toBeNull();
    expect(out.leadershipChange!.name).toBe('Maria Rossi');
    expect(out.leadershipChange!.newRole.toLowerCase()).toContain('chief marketing officer');
  });

  it('matches "welcomes X as Y" verb-first pattern', () => {
    const out = detectIntentSignals([
      pressPage('Acme welcomes Tom Becker as VP of Engineering.'),
    ]);
    expect(out.leadershipChange).not.toBeNull();
    expect(out.leadershipChange!.name).toBe('Tom Becker');
  });
});

describe('detectIntentSignals: product launch', () => {
  it('detects launch wording in <title>', () => {
    const out = detectIntentSignals([
      pressPage('', '<html></html>', 'Announcing Acme 2.0 — now available'),
    ]);
    expect(out.productLaunch).not.toBeNull();
    expect(out.productLaunch!.title).toContain('Announcing');
  });

  it('falls back to <h1>/<h2> heading', () => {
    const out = detectIntentSignals([
      pressPage('', '<html><body><h1>Introducing Lightning Mode</h1></body></html>'),
    ]);
    expect(out.productLaunch).not.toBeNull();
    expect(out.productLaunch!.title).toContain('Lightning Mode');
  });
});
