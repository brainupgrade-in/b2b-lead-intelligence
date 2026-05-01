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
import { detectIntentSignals, inferDepartmentsFromText } from './extractors/intent-signals.js';
import { scoreFit } from './extractors/fit-score.js';
import { generateOutreachHooks } from './extractors/outreach-hooks.js';
import { sourceLeads } from './sources/index.js';
import { validateInput } from './utils/validate-input.js';
import { buildFeedLead } from './feed-lead.js';

await Actor.init();

// Get input
const input = await Actor.getInput<Input>();
validateInput(input);

const {
  mode = 'enriched',
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
log.info(`Run mode: ${mode}`);

// Setup proxy if configured
let proxy: ProxyConfiguration | undefined;
if (proxyConfiguration) {
  proxy = await Actor.createProxyConfiguration(proxyConfiguration);
}

// Phase 1 (optional): source leads from public directories / news / hiring threads.
type ProcessTarget = {
  url: string;
  discovery: DiscoveryBlock | null;
  sourcedName?: string; // companyName resolved by sourcing — preferred over re-extraction
};
const targets: ProcessTarget[] = [];

if (sourcingEnabled && sourcing) {
  log.info(`Sourcing leads from: ${sourcing.sources!.join(', ')}`);
  const { leads: sourced, stats } = await sourceLeads(sourcing, idealCustomerProfile);
  for (const s of stats) {
    if (s.status === 'ok') {
      log.info(`  ${s.source} → ${s.rawCount} lead(s) before dedup`);
    } else {
      log.warning(`  ${s.source} → error: ${s.error}`);
    }
  }
  log.info(`Sourced ${sourced.length} unique leads after dedup / filter / cap`);
  for (const lead of sourced) {
    targets.push({
      url: lead.companyUrl,
      sourcedName: lead.companyName,
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

if (mode === 'feed') {
  log.info(`Feed mode: emitting ${targets.length} thin lead(s) without per-site crawl`);
} else {
  log.info(`Enriched mode: starting full crawl + extraction for ${targets.length} URL(s)`);
}

// Phase 2: per-target processing — feed mode emits a thin lead, enriched mode
// runs the full crawl + extractor pipeline.
for (const target of targets) {
  const inputUrl = target.url;
  const inputDiscovery = target.discovery;

  if (mode === 'feed') {
    const feedLead = buildFeedLead(target, idealCustomerProfile);
    await Actor.pushData(feedLead);
    log.info(`Feed: ${feedLead.companyName ?? inputUrl} (relevance ${inputDiscovery?.relevanceScore ?? '-'})`);
    continue;
  }

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
          // Initial parse signal — fires before client-side rendering completes.
          await page.waitForLoadState('domcontentloaded');

          // SPA hydration wait: many modern sites (Next.js, MongoDB, etc.) render
          // navigation links AFTER domcontentloaded. Without this wait the link
          // extractor sees an empty <a> set and pagesCrawled collapses to 1.
          // Strategy: wait briefly for ≥5 anchors; if not, fall back to networkidle.
          await page.waitForFunction(
            () => document.querySelectorAll('a[href]').length >= 5,
            { timeout: 3000 },
          ).catch(() => { /* will fall back below */ });

          const initialAnchorCount = await page.evaluate(
            () => document.querySelectorAll('a[href]').length,
          );
          if (initialAnchorCount < 5) {
            await page
              .waitForLoadState('networkidle', { timeout: 5000 })
              .catch(() => { /* slow sites with persistent connections */ });
          }

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

          // Enqueue more links from same domain.
          //
          // Cost-control: the SEED page gets a wide expansion (up to 20 links)
          // because we don't know yet which paths exist. After that, every
          // subsequent page gets a tight cap (5) AND only enqueues HIGH-priority
          // paths (/team, /about, /contact, /careers, /pricing). This stops the
          // pagination explosion on link-rich sites and roughly halves enriched
          // compute cost, without losing the BD-relevant pages.
          if (pageCount < maxPagesPerDomain) {
            const isHomepage = pageCount === 1;
            const minPriority = isHomepage ? 1 : 8;
            const enqueueLimit = isHomepage ? 20 : 5;

            const sameDomainLinks = links
              .filter((link) => isSameDomain(link, baseDomain) && isUsefulPage(link))
              .filter((link) => getUrlPriority(link) >= minPriority);

            sameDomainLinks.sort((a, b) => getUrlPriority(b) - getUrlPriority(a));
            const toEnqueue = sameDomainLinks.slice(0, enqueueLimit);

            log.info(
              `Crawled ${url} — ${links.length} links seen, ${toEnqueue.length} ${isHomepage ? 'enqueueable' : 'high-priority enqueueable'} (page ${pageCount}/${maxPagesPerDomain})`,
            );

            if (toEnqueue.length === 0 && isHomepage) {
              // Diagnostic: helps users identify SPA / nav-render issues per lead.
              log.warning(
                `${url} produced 0 enqueueable internal links — site may be SPA-heavy or DOM-stripped. Lead will have homepage-only data.`,
              );
            }

            await enqueueLinks({
              urls: toEnqueue,
              // Crawlee's default 'same-hostname' rejects www-vs-bare-domain
              // pairs, e.g. seed `cnbc.com` filtering out every `www.cnbc.com`
              // link. We already filtered to the registrable domain via
              // isSameDomain(); 'same-domain' here lets those subdomain URLs
              // through.
              strategy: 'same-domain',
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
      // Prefer the sourcing-supplied name when present — it's what brought the
      // lead here, often parsed from a HN/CB-News/TC subject line. Without
      // this, sites with titles like "Home | Shepherd" (Webflow default) get
      // companyName="Home" which is non-actionable for sales.
      companyName: target.sourcedName
        ?? (homepageData ? extractCompanyName(homepageData.title, homepageData.html, baseDomain) : null),
      description: homepageData
        ? extractDescription(homepageData.html)
        : null,
      contact: (extractEmails || extractPhones)
        ? aggregateContactInfo(
            pagesData.map((p) => ({ html: p.html, text: p.text, links: p.links, url: p.url })),
            baseDomain,
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

    // Hiring-floor reconciliation: if discovery surfaced a hiring trigger
    // (the lead came in *because* they were hiring) but the homepage-side
    // extractor missed open roles, anchor openRoles to ≥1 with department
    // hints parsed from the discovery signal text. Prevents the awkward
    // "sourced from a hiring thread but openRoles=0" output.
    if (
      enrichedLead.intentSignals.hiringSurge.openRoles === 0 &&
      inputDiscovery?.signals?.some((s) => s.type === 'hiring')
    ) {
      const hiringText = inputDiscovery.signals
        .filter((s) => s.type === 'hiring')
        .map((s) => s.text)
        .join(' ');
      enrichedLead.intentSignals.hiringSurge = {
        openRoles: 1,
        departments: inferDepartmentsFromText(hiringText),
      };
    }

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

log.info(`${mode === 'feed' ? 'Feed' : 'Enriched'} run completed`);

// Pay-per-event: feed mode is 5x cheaper because we skipped the crawler.
const eventName = mode === 'feed' ? 'lead-feed' : 'lead-enrichment';
const leadCount = targets.length;
if (leadCount > 0) {
  try {
    await Actor.charge({ eventName, count: leadCount });
    log.info(`Charged ${leadCount} × ${eventName}`);
  } catch (error) {
    // Charging may fail if PPE is not configured - this is OK for free runs
    log.debug(`Pay-per-event charging skipped: ${error instanceof Error ? error.message : 'Not configured'}`);
  }
}

await Actor.exit();
