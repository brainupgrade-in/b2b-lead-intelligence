/**
 * Reduce a URL or hostname to a registrable-domain key suitable for cross-source dedup.
 *
 * No PSL dependency: lower-cases, strips a leading `www.`, drops port / trailing dot.
 * Good enough for B2B websites (rare enough to host on a multi-level public suffix
 * that this matters); accepts the trade-off of treating `foo.co.uk` and
 * `bar.foo.co.uk` as different domains, which is what we want for sourcing dedup.
 */
export function canonicalDomain(input: string): string {
  if (!input) return '';
  let raw = input.trim();
  if (!/^https?:\/\//i.test(raw)) raw = `https://${raw}`;
  try {
    const parsed = new URL(raw);
    let host = parsed.hostname.toLowerCase();
    if (host.startsWith('www.')) host = host.slice(4);
    return host.replace(/\.+$/, '');
  } catch {
    return input.toLowerCase().trim();
  }
}

/**
 * Normalise to canonical https://host (drop path/query) — used as the
 * `companyUrl` for sourced leads when only a hostname is known.
 */
export function canonicalHomepage(input: string): string {
  const host = canonicalDomain(input);
  return host ? `https://${host}` : input;
}

/**
 * Hosts that are link aggregators / ATS / news outlets — never the company's
 * own homepage. Sourcing modules use this to drop noise links.
 */
const NON_COMPANY_HOSTS = new Set<string>([
  'twitter.com', 'x.com', 'linkedin.com', 'facebook.com', 'instagram.com',
  'youtube.com', 'youtu.be', 'tiktok.com', 'reddit.com', 'medium.com',
  'github.com', 'gitlab.com', 'news.ycombinator.com', 'ycombinator.com',
  'producthunt.com', 'crunchbase.com', 'news.crunchbase.com', 'techcrunch.com',
  'venturebeat.com', 'sifted.eu', 'forbes.com', 'businesswire.com',
  'prnewswire.com', 'wikipedia.org', 'apple.com', 'play.google.com',
  'apps.apple.com', 'greenhouse.io', 'lever.co', 'workable.com',
  'jobs.ashbyhq.com', 'boards.greenhouse.io', 'jobs.lever.co',
  'sec.gov', 'edgar.sec.gov', 'efts.sec.gov',
]);

export function isCompanyHomepage(url: string): boolean {
  const host = canonicalDomain(url);
  if (!host) return false;
  // Reject any host whose registrable suffix matches a known non-company host.
  for (const banned of NON_COMPANY_HOSTS) {
    if (host === banned || host.endsWith(`.${banned}`)) return false;
  }
  return true;
}
