import { Metadata } from '../types.js';

/**
 * Extract company name from page data
 */
export function extractCompanyName(
  title: string | null,
  html: string,
  domain: string
): string | null {
  // Try to get from Open Graph
  const ogSiteName = extractMetaContent(html, 'og:site_name');
  if (ogSiteName) {
    return cleanCompanyName(ogSiteName);
  }

  // Try to get from title (usually "Company Name | Tagline" or "Company Name - Tagline")
  if (title) {
    const separators = [' | ', ' - ', ' – ', ' — ', ' : '];
    for (const sep of separators) {
      if (title.includes(sep)) {
        const parts = title.split(sep);
        // First part is usually the company name
        return cleanCompanyName(parts[0]);
      }
    }
    // If no separator, use the whole title
    return cleanCompanyName(title);
  }

  // Fallback to domain name
  const domainParts = domain.replace('www.', '').split('.');
  if (domainParts.length > 0) {
    return capitalizeFirst(domainParts[0]);
  }

  return null;
}

/**
 * Extract company description
 */
export function extractDescription(html: string): string | null {
  // Try Open Graph description first
  const ogDesc = extractMetaContent(html, 'og:description');
  if (ogDesc) {
    return cleanDescription(ogDesc);
  }

  // Try meta description
  const metaDesc = extractMetaContent(html, 'description');
  if (metaDesc) {
    return cleanDescription(metaDesc);
  }

  // Try Twitter description
  const twitterDesc = extractMetaContent(html, 'twitter:description');
  if (twitterDesc) {
    return cleanDescription(twitterDesc);
  }

  return null;
}

/**
 * Extract metadata from page
 */
export function extractMetadata(html: string, url: string): Metadata {
  return {
    title: extractMetaContent(html, 'og:title') || extractTitle(html),
    metaDescription: extractMetaContent(html, 'description'),
    ogImage: extractMetaContent(html, 'og:image'),
    favicon: extractFavicon(html, url),
    language: extractLanguage(html),
  };
}

/**
 * Extract content from meta tags
 */
function extractMetaContent(html: string, name: string): string | null {
  // Try property attribute (Open Graph)
  const propertyMatch = html.match(
    new RegExp(`<meta[^>]*property=["']${name}["'][^>]*content=["']([^"']+)["']`, 'i')
  );
  if (propertyMatch) {
    return propertyMatch[1];
  }

  // Try content before property
  const propertyMatch2 = html.match(
    new RegExp(`<meta[^>]*content=["']([^"']+)["'][^>]*property=["']${name}["']`, 'i')
  );
  if (propertyMatch2) {
    return propertyMatch2[1];
  }

  // Try name attribute
  const nameMatch = html.match(
    new RegExp(`<meta[^>]*name=["']${name}["'][^>]*content=["']([^"']+)["']`, 'i')
  );
  if (nameMatch) {
    return nameMatch[1];
  }

  // Try content before name
  const nameMatch2 = html.match(
    new RegExp(`<meta[^>]*content=["']([^"']+)["'][^>]*name=["']${name}["']`, 'i')
  );
  if (nameMatch2) {
    return nameMatch2[1];
  }

  return null;
}

/**
 * Extract title from HTML
 */
function extractTitle(html: string): string | null {
  const match = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return match ? match[1].trim() : null;
}

/**
 * Extract favicon URL
 */
function extractFavicon(html: string, baseUrl: string): string | null {
  const patterns = [
    /<link[^>]*rel=["'](?:shortcut )?icon["'][^>]*href=["']([^"']+)["']/i,
    /<link[^>]*href=["']([^"']+)["'][^>]*rel=["'](?:shortcut )?icon["']/i,
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) {
      let favicon = match[1];
      // Make absolute URL if relative
      if (favicon.startsWith('/')) {
        const base = new URL(baseUrl);
        return base.origin + favicon;
      }
      return favicon;
    }
  }

  // Default favicon path
  try {
    const base = new URL(baseUrl);
    return base.origin + '/favicon.ico';
  } catch {
    return null;
  }
}

/**
 * Extract page language
 */
function extractLanguage(html: string): string | null {
  const match = html.match(/<html[^>]*lang=["']([^"']+)["']/i);
  return match ? match[1] : null;
}

/**
 * Clean company name
 */
function cleanCompanyName(name: string): string {
  return name
    .replace(/\s*[-|–—:]\s*.*$/, '') // Remove taglines
    .replace(/^\s+|\s+$/g, '') // Trim
    .replace(/\s+/g, ' '); // Normalize spaces
}

/**
 * Clean description
 */
function cleanDescription(desc: string): string {
  return desc
    .replace(/^\s+|\s+$/g, '')
    .replace(/\s+/g, ' ')
    .slice(0, 500); // Limit length
}

/**
 * Capitalize first letter
 */
function capitalizeFirst(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}
