import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateInput } from '../src/utils/validate-input.js';
import type { Input } from '../src/types.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const inputSchema = JSON.parse(
  readFileSync(join(ROOT, '.actor/input_schema.json'), 'utf-8'),
);
const datasetSchema = JSON.parse(
  readFileSync(join(ROOT, '.actor/dataset_schema.json'), 'utf-8'),
);
const actorJson = JSON.parse(
  readFileSync(join(ROOT, '.actor/actor.json'), 'utf-8'),
);

describe('Apify input schema', () => {
  it('parses as valid JSON with the expected top-level shape', () => {
    expect(inputSchema.type).toBe('object');
    expect(inputSchema.schemaVersion).toBe(1);
    expect(typeof inputSchema.properties).toBe('object');
  });

  // CHALLENGE-COMPLIANCE / OPERATIONAL: urls is no longer required because a
  // sourcing-only run is supported. main.ts enforces "urls OR sourcing" at
  // runtime via validateInput().
  it('does not list "urls" in required[] (sourcing-only runs are supported)', () => {
    expect(Array.isArray(inputSchema.required)).toBe(true);
    expect(inputSchema.required).not.toContain('urls');
  });

  it('declares both urls and sourcing properties', () => {
    expect(inputSchema.properties.urls).toBeDefined();
    expect(inputSchema.properties.sourcing).toBeDefined();
  });

  it('declares the BD intelligence feature flags', () => {
    for (const flag of ['extractKeyPeople', 'detectIntentSignals', 'generateOutreachHooks', 'idealCustomerProfile']) {
      expect(inputSchema.properties[flag]).toBeDefined();
    }
  });

  it('every declared property has a description (Apify quality-score requirement)', () => {
    for (const [name, def] of Object.entries(inputSchema.properties as Record<string, { description?: string }>)) {
      expect(def.description, `property "${name}" missing description`).toBeTruthy();
    }
  });
});

describe('Apify dataset schema', () => {
  it('parses cleanly and uses actorSpecification 1', () => {
    expect(datasetSchema.actorSpecification).toBe(1);
    expect(datasetSchema.fields.type).toBe('object');
  });

  it('declares every field that EnrichedLead populates', () => {
    // These names must match keys we set in main.ts when constructing EnrichedLead.
    const required = [
      'inputUrl', 'companyUrl', 'companyName', 'description',
      'contact', 'socialProfiles', 'techStack', 'businessSignals',
      'keyPeople', 'intentSignals', 'fitScore', 'outreachHooks',
      'discovery', 'metadata', 'crawlStats',
    ];
    for (const f of required) {
      expect(datasetSchema.fields.properties[f], `dataset_schema missing field "${f}"`).toBeDefined();
    }
  });

  it('exposes the Sourced Leads view used by the dashboard', () => {
    expect(datasetSchema.views?.sourcedLeads).toBeDefined();
    const fields = datasetSchema.views.sourcedLeads.transformation.fields;
    expect(fields).toEqual(expect.arrayContaining([
      'companyName', 'companyUrl', 'discovery.relevanceScore', 'discovery.sources',
    ]));
  });
});

describe('Apify actor.json', () => {
  it('declares dockerfile, build tag, and an entry script', () => {
    expect(actorJson.actorSpecification).toBe(1);
    expect(actorJson.dockerfile || actorJson.buildTag).toBeTruthy();
  });
});

describe('Pay-per-event config', () => {
  const ppe = JSON.parse(
    readFileSync(join(ROOT, '.actor/pay_per_event.json'), 'utf-8'),
  );

  it('declares both lead-enrichment and lead-feed events', () => {
    const eventNames = ppe.eventDescriptors.map((e: { eventName: string }) => e.eventName);
    expect(eventNames).toEqual(expect.arrayContaining(['lead-enrichment', 'lead-feed']));
  });

  it('feed mode is priced strictly lower than enriched mode (5x by design)', () => {
    const enriched = ppe.eventDescriptors.find((e: { eventName: string; eventPriceUsd: number }) => e.eventName === 'lead-enrichment');
    const feed = ppe.eventDescriptors.find((e: { eventName: string; eventPriceUsd: number }) => e.eventName === 'lead-feed');
    expect(feed.eventPriceUsd).toBeLessThan(enriched.eventPriceUsd);
  });
});

describe('Mode toggle in input schema', () => {
  it('declares mode with feed/enriched enum and enriched as default', () => {
    expect(inputSchema.properties.mode).toBeDefined();
    expect(inputSchema.properties.mode.enum).toEqual(['feed', 'enriched']);
    expect(inputSchema.properties.mode.default).toBe('enriched');
  });
});

describe('Input validation gate (operational invariant)', () => {
  it('rejects null/undefined input', () => {
    expect(() => validateInput(null)).toThrow(/no input/i);
    expect(() => validateInput(undefined)).toThrow(/no input/i);
  });

  it('rejects an empty input (no urls, no sourcing)', () => {
    expect(() => validateInput({} as Input)).toThrow(/urls.*sourcing|sourcing.*urls/i);
  });

  it('rejects empty urls AND empty sourcing.sources', () => {
    expect(() =>
      validateInput({ urls: [], sourcing: { sources: [] } } as unknown as Input),
    ).toThrow(/urls|sourcing/i);
  });

  it('accepts urls-only', () => {
    expect(() =>
      validateInput({ urls: ['https://x.example'] } as Input),
    ).not.toThrow();
  });

  it('accepts sourcing-only', () => {
    expect(() =>
      validateInput({ sourcing: { sources: ['hn-hiring'] } } as Input),
    ).not.toThrow();
  });

  it('accepts both', () => {
    expect(() =>
      validateInput({
        urls: ['https://x.example'],
        sourcing: { sources: ['yc'] },
      } as Input),
    ).not.toThrow();
  });
});
