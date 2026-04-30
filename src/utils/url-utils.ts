/**
 * Normalize URL to consistent format
 */
export function normalizeUrl(url: string): string {
  try {
    // Add protocol if missing
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = 'https://' + url;
    }

    const parsed = new URL(url);

    // Force HTTPS
    parsed.protocol = 'https:';

    // Remove trailing slash
    let normalized = parsed.origin + parsed.pathname.replace(/\/+$/, '');

    // Keep query string if present
    if (parsed.search) {
      normalized += parsed.search;
    }

    return normalized;
  } catch {
    return url;
  }
}

/**
 * Get base domain from URL
 */
export function getBaseDomain(url: string): string {
  try {
    const parsed = new URL(normalizeUrl(url));
    return parsed.hostname;
  } catch {
    return url;
  }
}

/**
 * Check if URL belongs to same domain
 */
export function isSameDomain(url: string, baseDomain: string): boolean {
  try {
    const parsed = new URL(url);
    const urlDomain = parsed.hostname;

    // Exact match or subdomain
    return (
      urlDomain === baseDomain ||
      urlDomain.endsWith('.' + baseDomain)
    );
  } catch {
    return false;
  }
}

/**
 * Check if URL is likely a useful page to crawl
 */
export function isUsefulPage(url: string): boolean {
  const lowercaseUrl = url.toLowerCase();

  // Skip non-HTML resources
  const skipExtensions = [
    '.pdf', '.jpg', '.jpeg', '.png', '.gif', '.svg', '.webp',
    '.mp4', '.mp3', '.wav', '.avi', '.mov',
    '.zip', '.rar', '.tar', '.gz',
    '.css', '.js', '.json', '.xml',
    '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  ];

  for (const ext of skipExtensions) {
    if (lowercaseUrl.endsWith(ext)) {
      return false;
    }
  }

  // Skip common non-content paths
  const skipPaths = [
    '/wp-admin', '/wp-login', '/admin', '/login', '/logout',
    '/cart', '/checkout', '/account', '/my-account',
    '/search', '/tag/', '/category/',
    '/feed', '/rss', '/sitemap',
  ];

  for (const path of skipPaths) {
    if (lowercaseUrl.includes(path)) {
      return false;
    }
  }

  return true;
}

/**
 * Prioritize URLs for crawling (higher priority = crawl first)
 */
export function getUrlPriority(url: string): number {
  const lowercaseUrl = url.toLowerCase();

  // Highest priority - key pages for lead enrichment
  const highPriority = ['/about', '/contact', '/team', '/our-team', '/leadership', '/leaders', '/people', '/founders', '/management', '/company', '/careers', '/jobs', '/pricing'];
  for (const path of highPriority) {
    if (lowercaseUrl.includes(path)) {
      return 10;
    }
  }

  // Medium priority
  const mediumPriority = ['/blog', '/news', '/press', '/newsroom', '/announcements', '/customers', '/case-studies'];
  for (const path of mediumPriority) {
    if (lowercaseUrl.includes(path)) {
      return 5;
    }
  }

  // Homepage
  try {
    if (lowercaseUrl.endsWith('/') || new URL(url).pathname === '/') {
      return 8;
    }
  } catch {
    // Invalid URL, treat as low priority
  }

  return 1;
}
