import { TechStack } from '../types.js';
import { TECH_PATTERNS } from '../utils/patterns.js';

/**
 * Detect technologies from HTML content
 */
export function detectTechStack(html: string): TechStack {
  const techStack: TechStack = {
    cms: null,
    analytics: [],
    chat: null,
    payment: [],
    hosting: null,
    frameworks: [],
    other: [],
  };

  // Detect CMS
  for (const [name, patterns] of Object.entries(TECH_PATTERNS.cms)) {
    for (const pattern of patterns) {
      if (pattern.test(html)) {
        techStack.cms = name;
        break;
      }
    }
    if (techStack.cms) break;
  }

  // Detect Analytics (can have multiple)
  for (const [name, patterns] of Object.entries(TECH_PATTERNS.analytics)) {
    for (const pattern of patterns) {
      if (pattern.test(html)) {
        if (!techStack.analytics.includes(name)) {
          techStack.analytics.push(name);
        }
        break;
      }
    }
  }

  // Detect Chat widget
  for (const [name, patterns] of Object.entries(TECH_PATTERNS.chat)) {
    for (const pattern of patterns) {
      if (pattern.test(html)) {
        techStack.chat = name;
        break;
      }
    }
    if (techStack.chat) break;
  }

  // Detect Payment (can have multiple)
  for (const [name, patterns] of Object.entries(TECH_PATTERNS.payment)) {
    for (const pattern of patterns) {
      if (pattern.test(html)) {
        if (!techStack.payment.includes(name)) {
          techStack.payment.push(name);
        }
        break;
      }
    }
  }

  // Detect Hosting
  for (const [name, patterns] of Object.entries(TECH_PATTERNS.hosting)) {
    for (const pattern of patterns) {
      if (pattern.test(html)) {
        techStack.hosting = name;
        break;
      }
    }
    if (techStack.hosting) break;
  }

  // Detect Frameworks (can have multiple)
  for (const [name, patterns] of Object.entries(TECH_PATTERNS.frameworks)) {
    for (const pattern of patterns) {
      if (pattern.test(html)) {
        if (!techStack.frameworks.includes(name)) {
          techStack.frameworks.push(name);
        }
        break;
      }
    }
  }

  return techStack;
}

/**
 * Merge tech stacks from multiple pages
 */
export function mergeTechStacks(stacks: TechStack[]): TechStack {
  const merged: TechStack = {
    cms: null,
    analytics: [],
    chat: null,
    payment: [],
    hosting: null,
    frameworks: [],
    other: [],
  };

  for (const stack of stacks) {
    // Take first CMS found
    if (!merged.cms && stack.cms) {
      merged.cms = stack.cms;
    }

    // Merge analytics
    for (const item of stack.analytics) {
      if (!merged.analytics.includes(item)) {
        merged.analytics.push(item);
      }
    }

    // Take first chat found
    if (!merged.chat && stack.chat) {
      merged.chat = stack.chat;
    }

    // Merge payment
    for (const item of stack.payment) {
      if (!merged.payment.includes(item)) {
        merged.payment.push(item);
      }
    }

    // Take first hosting found
    if (!merged.hosting && stack.hosting) {
      merged.hosting = stack.hosting;
    }

    // Merge frameworks
    for (const item of stack.frameworks) {
      if (!merged.frameworks.includes(item)) {
        merged.frameworks.push(item);
      }
    }
  }

  return merged;
}
