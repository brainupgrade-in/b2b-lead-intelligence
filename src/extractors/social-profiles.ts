import { SocialProfiles } from '../types.js';
import { SOCIAL_PATTERNS } from '../utils/patterns.js';

/**
 * Extract social profile URLs from HTML content
 */
export function extractSocialProfiles(html: string): SocialProfiles {
  const profiles: SocialProfiles = {
    linkedin: null,
    twitter: null,
    facebook: null,
    youtube: null,
    github: null,
    instagram: null,
    crunchbase: null,
  };

  for (const [platform, patterns] of Object.entries(SOCIAL_PATTERNS)) {
    for (const pattern of patterns) {
      const matches = html.match(pattern);
      if (matches && matches.length > 0) {
        // Get the first match and clean it
        let url = matches[0];

        // Remove trailing slashes for consistency
        url = url.replace(/\/+$/, '');

        // Skip if it's just the domain (likely a false positive)
        if (platform === 'linkedin' && !url.includes('/company/') && !url.includes('/in/')) {
          continue;
        }

        profiles[platform as keyof SocialProfiles] = url;
        break; // Use first valid match
      }
    }
  }

  return profiles;
}

/**
 * Aggregate social profiles from multiple pages
 */
export function aggregateSocialProfiles(
  pagesHtml: string[]
): SocialProfiles {
  const aggregated: SocialProfiles = {
    linkedin: null,
    twitter: null,
    facebook: null,
    youtube: null,
    github: null,
    instagram: null,
    crunchbase: null,
  };

  for (const html of pagesHtml) {
    const profiles = extractSocialProfiles(html);

    // Fill in any missing profiles
    for (const [key, value] of Object.entries(profiles)) {
      if (value && !aggregated[key as keyof SocialProfiles]) {
        aggregated[key as keyof SocialProfiles] = value;
      }
    }
  }

  return aggregated;
}
