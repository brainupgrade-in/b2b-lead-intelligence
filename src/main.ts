import { Actor, log, ProxyConfiguration } from 'apify';
import { PlaywrightCrawler, RequestQueue } from 'crawlee';
import { Input, EnrichedLead, TechStack, DiscoveryBlock } from './types.js';
import { normalizeUrl, getBaseDomain, isSameDomain, isUsefulPage, getUrlPriority } from './utils/url-utils.js';
import { aggregateContactInfo } from './extractors/contact-info.js';
import { aggregateSocialProfiles } from './extractors/social-profiles.js';
import { detectTechStack, mergeTechStacks } from './extractors/tech-stack.js';
import { detectBusinessSignals } from './extractors/business-signals.js';
import { extractCompanyName, extractDescription, extractMetadata } from './extractors/company-info.js';
import { extractKeyPeople } from './extractors/key-people.js';
import { detectIntentSignals } from './extractors/intent-signals.js';
import { scoreFit } from './extractors/fit-score.js';
import { generateOutreachHooks } from './extractors/outreach-hooks.js';
import { sourceLeads } from './sources/index.js';
import { validateInput } from './utils/validate-input.js';

await Actor.init();

// Get input
const input = await Actor.getInput<Input>();
validateInput(input);

const {
  urls = [],
  sourcing,
  maxPagesPerDomain = 10,
  extractEmails = true,
  extractPhones = true,
  detectTechStack: shouldDetectTech = true,
  includeSocialProfiles = true,
  detectBusinessSignals: shouldDetectSignals = true,
  extractKeyPeople: shouldExtractPeople = true,
  detectIntentSignals: shouldDetectIntent = true,
  generateOutreachHooks: shouldGenerateHooks = false,
  idealCustomerProfile,
  proxyConfiguration,
} = input!;

const sourcingEnabled = !!sourcing?.sources?.length;

// Setup proxy if configured
let proxy: ProxyConfiguration | undefined;
if (proxyConfiguration) {
  proxy = await Actor.createProxyConfiguration(proxyConfiguration);
}

// Phase 1 (optional): source leads from public directories / news / hiring threads.
type ProcessTarget = { url: string; discovery: DiscoveryBlock | null };
const targets: ProcessTarget[] = [];

if (sourcingEnabled && sourcing) {
  log.info(`Sourcing leads from: ${sourcing.sources!.join(', ')}`);
  const sourced = await sourceLeads(sourcing, idealCustomerProfile);
  log.info(`Sourced ${sourced.length} unique leads from public sources`);
  for (const lead of sourced) {
    targets.push({
      url: lead.companyUrl,
      discovery: {
        sources: lead.discoverySources,
        signals: lead.discoverySignals,
        firstSeenAt: lead.firstSeenAt,
        relevanceScore: lead.relevanceScore,
      },
    });
  }
}

for (const u of urls) {
  // Direct-input URLs override any sourced duplicate (same domain), but for
  // simplicity we just append — dedup happens implicitly because the crawler
  // would re-crawl the same domain otherwise.
  targets.push({ url: u, discovery: null });
}

log.info(`Starting lead enrichment for ${targets.length} URL(s)`);

// Phase 2: enrich each URL.
for (const target of targets) {
  const inputUrl = target.url;
  const inputDiscovery = target.discovery;
  try {
    const startTime = Date.now();
    const normalizedUrl = normalizeUrl(inputUrl);
    const baseDomain = getBaseDomain(normalizedUrl);

    log.info(`Processing: ${normalizedUrl}`);

    // Data collectors for this domain
    const pagesData: Array<{
      url: string;
      html: string;
      text: string;
      title: string | null;
      links: string[];
    }> = [];

    const techStacks: TechStack[] = [];
    const crawledUrls: string[] = [];
    let pageCount = 0;

    // Create unique request queue for this domain
    const queueId = `queue-${baseDomain.replace(/\./g, '-')}-${Date.now()}`;
    const requestQueue = await RequestQueue.open(queueId);

    // Create crawler for this domain
    const crawler = new PlaywrightCrawler({
      proxyConfiguration: proxy,
      maxRequestsPerCrawl: maxPagesPerDomain,
      maxConcurrency: 3,
      requestHandlerTimeoutSecs: 60,
      navigationTimeoutSecs: 30,
      requestQueue,

      async requestHandler({ page, request, enqueueLinks }) {
        const url = request.url;
        log.debug(`Crawling: ${url}`);

        try {
          // Wait for page to load
          await page.waitForLoadState('domcontentloaded');

          // Get page content
          const html = await page.content();
          const title = await page.title();
          const text = await page.evaluate(() => document.body?.innerText || '');

          // Get all links on page
          const links = await page.evaluate(() => {
            return Array.from(document.querySelectorAll('a[href]'))
              .map((a) => (a as HTMLAnchorElement).href)
              .filter((href) => href.startsWith('http'));
          });

          // Store page data
          pagesData.push({ url, html, text, title, links });
          crawledUrls.push(url);
          pageCount++;

          // Detect tech stack if enabled
          if (shouldDetectTech) {
            const tech = detectTechStack(html);
            techStacks.push(tech);
          }

          // Enqueue more links from same domain
          if (pageCount < maxPagesPerDomain) {
            const sameDomainLinks = links
              .filter((link) => isSameDomain(link, baseDomain) && isUsefulPage(link))
              .slice(0, 20); // Limit links per page

            // Sort by priority
            sameDomainLinks.sort((a, b) => getUrlPriority(b) - getUrlPriority(a));

            await enqueueLinks({
              urls: sameDomainLinks,
              transformRequestFunction: (req) => {
                req.userData = { priority: getUrlPriority(req.url) };
                return req;
              },
            });
          }
        } catch (error) {
          log.warning(`Error processing ${url}: ${error}`);
        }
      },

      failedRequestHandler({ request }) {
        log.warning(`Request failed: ${request.url}`);
      },
    });

    // Run crawler
    await crawler.run([normalizedUrl]);

    // Clean up request queue
    await requestQueue.drop();

    // Aggregate results
    const endTime = Date.now();

    // Get homepage data for metadata (with safe URL parsing)
    const homepageData = pagesData.find((p) => {
      try {
        const pathname = new URL(p.url).pathname;
        return p.url === normalizedUrl || pathname === '/' || pathname === '';
      } catch {
        return false;
      }
    }) || pagesData[0];

    const allHtml = pagesData.map((p) => p.html);

    // Build enriched lead object
    const enrichedLead: EnrichedLead = {
      inputUrl,
      companyUrl: normalizedUrl,
      companyName: homepageData
        ? extractCompanyName(homepageData.title, homepageData.html, baseDomain)
        : null,
      description: homepageData
        ? extractDescription(homepageData.html)
        : null,
      contact: (extractEmails || extractPhones)
        ? aggregateContactInfo(
            pagesData.map((p) => ({ html: p.html, text: p.text, links: p.links, url: p.url }))
          )
        : { emails: [], phones: [], contactFormUrl: null },
      socialProfiles: includeSocialProfiles
        ? aggregateSocialProfiles(allHtml)
        : {
            linkedin: null,
            twitter: null,
            facebook: null,
            youtube: null,
            github: null,
            instagram: null,
            crunchbase: null,
          },
      techStack: shouldDetectTech
        ? mergeTechStacks(techStacks)
        : { cms: null, analytics: [], chat: null, payment: [], hosting: null, frameworks: [], other: [] },
      businessSignals: shouldDetectSignals
        ? detectBusinessSignals(crawledUrls, allHtml)
        : {
            hasCareerPage: false,
            hasBlog: false,
            hasPricingPage: false,
            hasContactPage: false,
            hasAboutPage: false,
            hasCustomerLogos: false,
            estimatedSize: null,
          },
      keyPeople: shouldExtractPeople
        ? extractKeyPeople(pagesData.map((p) => ({ url: p.url, html: p.html })))
        : [],
      intentSignals: shouldDetectIntent
        ? detectIntentSignals(pagesData.map((p) => ({ url: p.url, html: p.html, text: p.text, title: p.title })))
        : { recentFundingMention: null, hiringSurge: { openRoles: 0, departments: [] }, leadershipChange: null, productLaunch: null, recentPressItems: [] },
      fitScore: null,
      outreachHooks: [],
      metadata: homepageData
        ? extractMetadata(homepageData.html, homepageData.url)
        : { title: null, metaDescription: null, ogImage: null, favicon: null, language: null },
      crawlStats: {
        pagesCrawled: pageCount,
        crawlDurationMs: endTime - startTime,
        timestamp: new Date().toISOString(),
      },
      discovery: inputDiscovery,
    };

    // ICP fit score depends on extracted signals being populated.
    enrichedLead.fitScore = scoreFit(enrichedLead, idealCustomerProfile);

    // Outreach hooks (LLM-backed, opt-in) — runs after all signals are in.
    if (shouldGenerateHooks) {
      try {
        enrichedLead.outreachHooks = await generateOutreachHooks(enrichedLead);
      } catch (err) {
        log.warning(`Outreach-hook generation failed for ${normalizedUrl}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // Push to dataset
    await Actor.pushData(enrichedLead);

    log.info(`Completed: ${normalizedUrl} - ${pageCount} pages in ${endTime - startTime}ms`);

  } catch (error) {
    log.error(`Failed to process ${inputUrl}: ${error}`);

    // Push error result so user knows this URL failed
    const errorLead: EnrichedLead = {
      inputUrl,
      companyUrl: normalizeUrl(inputUrl),
      companyName: null,
      description: null,
      contact: { emails: [], phones: [], contactFormUrl: null },
      socialProfiles: {
        linkedin: null,
        twitter: null,
        facebook: null,
        youtube: null,
        github: null,
        instagram: null,
        crunchbase: null,
      },
      techStack: { cms: null, analytics: [], chat: null, payment: [], hosting: null, frameworks: [], other: [] },
      businessSignals: {
        hasCareerPage: false,
        hasBlog: false,
        hasPricingPage: false,
        hasContactPage: false,
        hasAboutPage: false,
        hasCustomerLogos: false,
        estimatedSize: null,
      },
      keyPeople: [],
      intentSignals: { recentFundingMention: null, hiringSurge: { openRoles: 0, departments: [] }, leadershipChange: null, productLaunch: null, recentPressItems: [] },
      fitScore: null,
      outreachHooks: [],
      metadata: { title: null, metaDescription: null, ogImage: null, favicon: null, language: null },
      crawlStats: {
        pagesCrawled: 0,
        crawlDurationMs: 0,
        timestamp: new Date().toISOString(),
        error: String(error),
      },
      discovery: inputDiscovery,
    };
    await Actor.pushData(errorLead);
  }
}

log.info('Lead enrichment completed!');

// Charge per URL enriched (Pay-Per-Event)
// Pricing: $0.0025 per URL enriched = $2.50 per 1,000 URLs
const urlCount = targets.length;
if (urlCount > 0) {
  try {
    await Actor.charge({ eventName: 'lead-enrichment', count: urlCount });
    log.info(`Charged for ${urlCount} URL enrichments`);
  } catch (error) {
    // Charging may fail if PPE is not configured - this is OK for free runs
    log.debug(`Pay-per-event charging skipped: ${error instanceof Error ? error.message : 'Not configured'}`);
  }
}

await Actor.exit();
