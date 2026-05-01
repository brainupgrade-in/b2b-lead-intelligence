import { ContactInfo } from '../types.js';
import { EMAIL_REGEX, FILTERED_EMAIL_PATTERNS } from '../utils/patterns.js';
import { canonicalDomain } from '../utils/canonical-domain.js';

/**
 * Extract emails from HTML content
 */
export function extractEmails(_html: string, text: string): string[] {
  // Only search in visible text to avoid image filenames, asset paths, etc.
  const matches = text.match(EMAIL_REGEX) || [];

  // Deduplicate and filter
  const uniqueEmails = [...new Set(matches.map((e) => e.toLowerCase()))];

  return uniqueEmails.filter((email) => {
    // Filter out generic/no-reply emails
    for (const pattern of FILTERED_EMAIL_PATTERNS) {
      if (pattern.test(email)) {
        return false;
      }
    }

    // Filter out image/asset filenames (e.g., logo@2x.png)
    if (/\.(png|jpg|jpeg|gif|svg|webp|mp4|mp3|pdf|css|js)$/i.test(email)) {
      return false;
    }

    // Filter out emails that look like image dimensions (e.g., something@2x)
    if (/@\d+x\./i.test(email)) {
      return false;
    }

    // Must have a reasonable TLD
    const tld = email.split('.').pop();
    if (!tld || tld.length < 2 || tld.length > 10) {
      return false;
    }

    return true;
  });
}

/**
 * Extract phone numbers from HTML content
 */
export function extractPhones(_html: string, text: string): string[] {
  // Only search in visible text, not HTML (to avoid IDs and data attributes)
  const phones: string[] = [];

  // More strict phone pattern - must have formatting characters
  const strictPhonePatterns = [
    // US/Canada: (123) 456-7890, 123-456-7890, +1 123-456-7890
    /\+?1?[-.\s]?\(?[0-9]{3}\)?[-.\s][0-9]{3}[-.\s][0-9]{4}/g,
    // International with + and formatting: +44 20 7123 4567
    /\+[0-9]{1,3}[-.\s][0-9]{1,4}[-.\s][0-9]{1,4}[-.\s]?[0-9]{1,9}/g,
  ];

  for (const pattern of strictPhonePatterns) {
    const matches = text.match(pattern) || [];
    phones.push(...matches);
  }

  // Clean and deduplicate
  const cleaned = phones.map((phone) => {
    // Remove extra whitespace and normalize
    return phone.replace(/\s+/g, ' ').trim();
  });

  // Filter: must have at least one formatting character (-, ., space, parentheses)
  const valid = cleaned.filter((phone) => {
    const hasFormatting = /[-.\s()]/.test(phone);
    const digits = phone.replace(/\D/g, '');
    return hasFormatting && digits.length >= 10 && digits.length <= 15;
  });

  return [...new Set(valid)];
}

/**
 * Find contact form URL from links
 */
export function findContactFormUrl(
  links: string[],
  baseUrl: string
): string | null {
  const contactPatterns = [
    /\/contact\/?$/i,
    /\/contact-us\/?$/i,
    /\/get-in-touch/i,
    /\/reach-us/i,
    /\/enquiry/i,
    /\/inquiry/i,
  ];

  for (const link of links) {
    for (const pattern of contactPatterns) {
      if (pattern.test(link)) {
        // Make absolute URL if relative
        if (link.startsWith('/')) {
          const base = new URL(baseUrl);
          return base.origin + link;
        }
        return link;
      }
    }
  }

  return null;
}

/**
 * Aggregate contact info from multiple pages.
 *
 * `companyDomain` (optional) is the canonical domain of the lead's homepage.
 * When supplied, emails whose domain doesn't match are dropped — sales reps
 * have shipped outreach to partner / vendor / fund-administrator emails that
 * happened to appear on the company's site (e.g., BIT Capital surfacing
 * `kundenberatung@fondsnet.de`). This filter removes that failure mode.
 */
export function aggregateContactInfo(
  pagesData: Array<{ html: string; text: string; links: string[]; url: string }>,
  companyDomain?: string,
): ContactInfo {
  const allEmails: string[] = [];
  const allPhones: string[] = [];
  let contactFormUrl: string | null = null;

  for (const page of pagesData) {
    const emails = extractEmails(page.html, page.text);
    const phones = extractPhones(page.html, page.text);

    allEmails.push(...emails);
    allPhones.push(...phones);

    if (!contactFormUrl) {
      contactFormUrl = findContactFormUrl(page.links, page.url);
    }
  }

  // Deduplicate, then drop emails whose domain doesn't match the lead's.
  const uniqueEmails = [...new Set(allEmails)];
  const targetDomain = companyDomain ? canonicalDomain(companyDomain) : '';
  const ownEmails = targetDomain
    ? uniqueEmails.filter((email) => emailDomainMatches(email, targetDomain))
    : uniqueEmails;

  // Sort by priority (info@, sales@, contact@ first)
  const priorityOrder = ['info@', 'sales@', 'contact@', 'hello@', 'support@'];

  ownEmails.sort((a, b) => {
    const aPriority = priorityOrder.findIndex((p) => a.startsWith(p));
    const bPriority = priorityOrder.findIndex((p) => b.startsWith(p));

    if (aPriority !== -1 && bPriority === -1) return -1;
    if (aPriority === -1 && bPriority !== -1) return 1;
    if (aPriority !== -1 && bPriority !== -1) return aPriority - bPriority;
    return 0;
  });

  return {
    emails: ownEmails.slice(0, 10), // Limit to 10 most relevant
    phones: [...new Set(allPhones)].slice(0, 5), // Limit to 5
    contactFormUrl,
  };
}

/**
 * Accepts an email iff its domain (or any parent) equals the target
 * registrable domain. Treats subdomains as a match (eu.acme.com ⇒ acme.com)
 * but NOT an unrelated tenant on a SaaS provider.
 */
function emailDomainMatches(email: string, targetDomain: string): boolean {
  const at = email.lastIndexOf('@');
  if (at < 0) return false;
  const emailDomain = email.slice(at + 1).toLowerCase();
  if (!emailDomain) return false;
  return emailDomain === targetDomain || emailDomain.endsWith('.' + targetDomain);
}
