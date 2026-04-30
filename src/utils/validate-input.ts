import { Input } from '../types.js';

/**
 * Apify operational invariant: a run is meaningless without something to enrich.
 * Either a non-empty `urls` array OR a `sourcing` block with at least one source
 * must be supplied. main.ts calls this after Actor.getInput() to fail fast with
 * a clear message before spinning up a crawler.
 */
export function validateInput(input: Input | null | undefined): void {
  if (!input) {
    throw new Error('No input provided');
  }
  const hasUrls = Array.isArray(input.urls) && input.urls.length > 0;
  const hasSourcing =
    !!input.sourcing?.sources && input.sourcing.sources.length > 0;
  if (!hasUrls && !hasSourcing) {
    throw new Error(
      'Input must contain either "urls" or a "sourcing" config with at least one source',
    );
  }
}
