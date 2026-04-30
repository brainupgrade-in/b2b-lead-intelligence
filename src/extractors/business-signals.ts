import { BusinessSignals } from '../types.js';
import { BUSINESS_PAGE_PATTERNS } from '../utils/patterns.js';

/**
 * Detect business signals from crawled URLs and content
 */
export function detectBusinessSignals(
  crawledUrls: string[],
  pagesHtml: string[]
): BusinessSignals {
  const signals: BusinessSignals = {
    hasCareerPage: false,
    hasBlog: false,
    hasPricingPage: false,
    hasContactPage: false,
    hasAboutPage: false,
    hasCustomerLogos: false,
    estimatedSize: null,
  };

  // Check URLs for page types
  for (const url of crawledUrls) {
    if (matchesPattern(url, BUSINESS_PAGE_PATTERNS.careers)) {
      signals.hasCareerPage = true;
    }
    if (matchesPattern(url, BUSINESS_PAGE_PATTERNS.blog)) {
      signals.hasBlog = true;
    }
    if (matchesPattern(url, BUSINESS_PAGE_PATTERNS.pricing)) {
      signals.hasPricingPage = true;
    }
    if (matchesPattern(url, BUSINESS_PAGE_PATTERNS.contact)) {
      signals.hasContactPage = true;
    }
    if (matchesPattern(url, BUSINESS_PAGE_PATTERNS.about)) {
      signals.hasAboutPage = true;
    }
  }

  // Check HTML content for additional signals
  const allHtml = pagesHtml.join(' ');

  // Detect customer logos (common patterns)
  const logoPatterns = [
    /customer[s]?.*logo/i,
    /trusted.?by/i,
    /our.?customer[s]?/i,
    /client[s]?.*logo/i,
    /used.?by.?(companies|teams)/i,
    /logo-?wall/i,
    /customer-?logo/i,
  ];

  for (const pattern of logoPatterns) {
    if (pattern.test(allHtml)) {
      signals.hasCustomerLogos = true;
      break;
    }
  }

  // Estimate company size based on signals
  signals.estimatedSize = estimateCompanySize(signals, crawledUrls, allHtml);

  return signals;
}

/**
 * Check if URL matches any of the patterns
 */
function matchesPattern(url: string, patterns: RegExp[]): boolean {
  for (const pattern of patterns) {
    if (pattern.test(url)) {
      return true;
    }
  }
  return false;
}

/**
 * Estimate company size based on website signals
 */
function estimateCompanySize(
  signals: BusinessSignals,
  crawledUrls: string[],
  html: string
): string | null {
  let score = 0;

  // Career page indicates growth/size
  if (signals.hasCareerPage) score += 2;

  // Multiple job listings indicate larger company
  const jobKeywords = html.match(/job[s]?\s*(opening|position|listing)/gi) || [];
  if (jobKeywords.length > 5) score += 2;

  // Pricing page indicates product company
  if (signals.hasPricingPage) score += 1;

  // Customer logos indicate established business
  if (signals.hasCustomerLogos) score += 2;

  // Blog indicates content team
  if (signals.hasBlog) score += 1;

  // Multiple pages indicates larger site
  if (crawledUrls.length > 20) score += 1;

  // Enterprise keywords
  const enterprisePatterns = [
    /enterprise/i,
    /fortune\s*500/i,
    /global\s*(team|company|presence)/i,
    /worldwide/i,
    /\d+\+?\s*(employees|team members)/i,
  ];

  for (const pattern of enterprisePatterns) {
    if (pattern.test(html)) {
      score += 2;
      break;
    }
  }

  // Map score to size estimate
  if (score >= 8) return '200+';
  if (score >= 5) return '51-200';
  if (score >= 3) return '11-50';
  if (score >= 1) return '1-10';

  return null;
}
