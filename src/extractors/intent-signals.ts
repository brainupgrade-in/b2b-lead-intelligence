import {
  IntentSignals,
  FundingMention,
  HiringSurge,
  LeadershipChange,
  ProductLaunch,
} from '../types.js';
import {
  BUSINESS_PAGE_PATTERNS,
  FUNDING_PATTERNS,
  LEADERSHIP_CHANGE_PATTERNS,
  PRODUCT_LAUNCH_PATTERNS,
} from '../utils/patterns.js';

interface PageInput {
  url: string;
  html: string;
  text: string;
  title: string | null;
}

export function detectIntentSignals(pages: PageInput[]): IntentSignals {
  const pressPages = pages.filter((p) => isPressPage(p.url));
  const careerPages = pages.filter((p) => isCareerPage(p.url));

  return {
    recentFundingMention: findFundingMention(pressPages.length ? pressPages : pages),
    hiringSurge: estimateHiringSurge(careerPages),
    leadershipChange: findLeadershipChange(pressPages.length ? pressPages : pages),
    productLaunch: findProductLaunch(pressPages.length ? pressPages : pages),
    recentPressItems: collectPressItems(pressPages),
  };
}

function isPressPage(url: string): boolean {
  return BUSINESS_PAGE_PATTERNS.press.some((p) => p.test(url)) ||
    BUSINESS_PAGE_PATTERNS.blog.some((p) => p.test(url));
}

function isCareerPage(url: string): boolean {
  return BUSINESS_PAGE_PATTERNS.careers.some((p) => p.test(url));
}

function findFundingMention(pages: PageInput[]): FundingMention | null {
  for (const page of pages) {
    const haystack = page.text || stripTags(page.html);
    for (const pattern of FUNDING_PATTERNS) {
      const match = haystack.match(pattern);
      if (match) {
        const text = match[0].trim();
        return {
          text: text.slice(0, 240),
          amount: extractAmount(text),
          round: extractRound(text),
          sourceUrl: page.url,
        };
      }
    }
  }
  return null;
}

function extractAmount(text: string): string | null {
  const m = text.match(/\$[\d.,]+\s?(m|mm|million|b|bn|billion)?/i);
  return m ? m[0] : null;
}

function extractRound(text: string): string | null {
  const m = text.match(/series\s+[a-h]/i);
  if (m) return m[0].toLowerCase().replace(/\s+/g, ' ');
  if (/\bseed\b/i.test(text)) return 'seed';
  if (/\bpre-?seed\b/i.test(text)) return 'pre-seed';
  return null;
}

/**
 * Estimate hiring surge by counting job-posting links / cards on careers pages.
 * Heuristic: count anchors whose visible text or URL looks like a role.
 */
function estimateHiringSurge(pages: PageInput[]): HiringSurge {
  if (pages.length === 0) return { openRoles: 0, departments: [] };

  const departments = new Set<string>();
  let openRoles = 0;

  for (const page of pages) {
    // Count likely job links: anchors pointing to /jobs/<slug> or external ATS hosts
    const jobLinkRe = /<a[^>]+href=["']([^"']*(?:greenhouse\.io\/jobs|lever\.co\/[^"']+|workable\.com|ashbyhq|jobvite|smartrecruiters|\/jobs?\/[a-z0-9-]+|\/careers?\/[a-z0-9-]+))["'][^>]*>([^<]{3,140})<\/a>/gi;
    const seenRoles = new Set<string>();
    let m: RegExpExecArray | null;
    while ((m = jobLinkRe.exec(page.html)) !== null) {
      const roleText = decode(m[2]).trim();
      if (roleText.length < 3) continue;
      if (seenRoles.has(roleText.toLowerCase())) continue;
      seenRoles.add(roleText.toLowerCase());
      openRoles++;
      classifyDepartment(roleText, departments);
    }
  }

  return {
    openRoles,
    departments: Array.from(departments).sort(),
  };
}

function classifyDepartment(roleText: string, into: Set<string>): void {
  const buckets: Array<{ dept: string; pat: RegExp }> = [
    { dept: 'engineering', pat: /\b(engineer|developer|sre|devops|swe|infrastructure|platform|backend|frontend|fullstack|full-stack|qa|quality assurance)\b/i },
    { dept: 'sales', pat: /\b(sales|account executive|\bae\b|\bsdr\b|\bbdr\b|account manager|business development|gtm)\b/i },
    { dept: 'marketing', pat: /\b(marketing|growth|content|seo|brand|demand gen|product marketing)\b/i },
    { dept: 'product', pat: /\b(product manager|\bpm\b|product designer|product owner)\b/i },
    { dept: 'design', pat: /\b(designer|design lead|ux|ui|user experience)\b/i },
    { dept: 'data', pat: /\b(data (scientist|analyst|engineer)|machine learning|\bml\b|\bai\b|analytics)\b/i },
    { dept: 'operations', pat: /\b(operations|ops manager|coo|chief of staff)\b/i },
    { dept: 'finance', pat: /\b(finance|accountant|controller|fp&a|cfo)\b/i },
    { dept: 'people', pat: /\b(recruiter|talent|people ops|human resources|\bhr\b)\b/i },
    { dept: 'support', pat: /\b(customer success|support|customer experience|onboarding)\b/i },
    { dept: 'legal', pat: /\b(legal|counsel|paralegal|compliance)\b/i },
  ];
  for (const b of buckets) {
    if (b.pat.test(roleText)) {
      into.add(b.dept);
      return;
    }
  }
}

function findLeadershipChange(pages: PageInput[]): LeadershipChange | null {
  for (const page of pages) {
    const text = page.text || stripTags(page.html);
    for (const pattern of LEADERSHIP_CHANGE_PATTERNS) {
      const m = text.match(pattern);
      if (m) {
        // Pattern shapes:
        //   /([Name]) (joins|appointed) ... (role)/   -> name=m[1], role=m[3]
        //   /(welcomes) ([Name]) as (role)/           -> name=m[2], role=m[3]
        const isVerbFirst = /^(welcomes|welcoming|appoints|appointed|names|named)/i.test(m[1] ?? '');
        const name = (isVerbFirst ? m[2] : m[1]) ?? '';
        const newRole = (isVerbFirst ? m[3] : m[3]) ?? '';
        if (!name || !newRole) continue;
        return {
          name: name.trim(),
          newRole: newRole.trim().slice(0, 120),
          context: m[0].slice(0, 240),
          sourceUrl: page.url,
        };
      }
    }
  }
  return null;
}

function findProductLaunch(pages: PageInput[]): ProductLaunch | null {
  for (const page of pages) {
    const titleSrc = page.title || extractTitleFromHtml(page.html);
    if (titleSrc && PRODUCT_LAUNCH_PATTERNS.some((p) => p.test(titleSrc))) {
      return { title: titleSrc.slice(0, 200), sourceUrl: page.url };
    }
    // Fallback: scan first <h1>/<h2> with launch wording
    const headingMatch = page.html.match(/<h[12][^>]*>([^<]{6,160})<\/h[12]>/i);
    if (headingMatch) {
      const heading = decode(headingMatch[1]).trim();
      if (PRODUCT_LAUNCH_PATTERNS.some((p) => p.test(heading))) {
        return { title: heading.slice(0, 200), sourceUrl: page.url };
      }
    }
  }
  return null;
}

function collectPressItems(pages: PageInput[]): string[] {
  const items: string[] = [];
  for (const page of pages) {
    const re = /<h[12-3][^>]*>([^<]{8,160})<\/h[12-3]>/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(page.html)) !== null) {
      const t = decode(m[1]).trim();
      if (t && !items.includes(t)) items.push(t);
      if (items.length >= 10) return items;
    }
  }
  return items;
}

function extractTitleFromHtml(html: string): string | null {
  const m = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return m ? decode(m[1]).trim() : null;
}

function stripTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function decode(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}
