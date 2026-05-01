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
  const seenRoles = new Set<string>();

  const recordRole = (roleText: string): void => {
    const trimmed = roleText.trim();
    if (trimmed.length < 3 || trimmed.length > 140) return;
    const key = trimmed.toLowerCase();
    if (seenRoles.has(key)) return;
    // Filter clear non-roles ("Apply now", "View all", section labels)
    if (/^(apply|view all|see all|see more|all jobs?|open roles?|careers?|join|learn more)$/i.test(trimmed)) return;
    seenRoles.add(key);
    classifyDepartment(trimmed, departments);
  };

  for (const page of pages) {
    // Strategy 1: anchor links to ATS hosts or /jobs/<slug>
    const jobLinkRe = /<a[^>]+href=["']([^"']*(?:greenhouse\.io\/jobs|lever\.co\/[^"']+|workable\.com|ashbyhq|jobvite|smartrecruiters|\/jobs?\/[a-z0-9-]+|\/careers?\/[a-z0-9-]+))["'][^>]*>([^<]{3,140})<\/a>/gi;
    let m: RegExpExecArray | null;
    while ((m = jobLinkRe.exec(page.html)) !== null) {
      recordRole(decode(m[2]));
    }

    // Strategy 2: JSON-LD JobPosting blocks. Many sites embed structured data
    // for SEO even when their visible markup is JS-rendered. Counts roles
    // even if the actual list never hydrates server-side.
    const ldRe = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
    while ((m = ldRe.exec(page.html)) !== null) {
      try {
        const data = JSON.parse(m[1].trim());
        walkForJobPostings(data, recordRole);
      } catch {
        // Malformed JSON-LD — ignore
      }
    }

    // Strategy 3: heading-based role lists (only on careers-shape pages so we
    // don't mis-classify random h-tags as roles).
    if (isCareerPage(page.url)) {
      const headingRe = /<h[2-4][^>]*>([^<]{4,120})<\/h[2-4]>/gi;
      while ((m = headingRe.exec(page.html)) !== null) {
        const txt = decode(m[1]).trim();
        if (looksLikeRole(txt)) recordRole(txt);
      }
      // List-item roles ("Senior Backend Engineer · Remote")
      const liRe = /<li[^>]*>([^<]{4,140})<\/li>/gi;
      while ((m = liRe.exec(page.html)) !== null) {
        const txt = decode(m[1]).trim().split(/[·•|—–]/)[0]?.trim();
        if (txt && looksLikeRole(txt)) recordRole(txt);
      }
    }
  }

  return {
    openRoles: seenRoles.size,
    departments: Array.from(departments).sort(),
  };
}

function walkForJobPostings(node: unknown, record: (role: string) => void): void {
  if (!node) return;
  if (Array.isArray(node)) {
    for (const child of node) walkForJobPostings(child, record);
    return;
  }
  if (typeof node !== 'object') return;
  const obj = node as Record<string, unknown>;
  const type = obj['@type'];
  if (type === 'JobPosting' && typeof obj.title === 'string') {
    record(obj.title);
  }
  for (const v of Object.values(obj)) {
    if (typeof v === 'object' && v !== null) walkForJobPostings(v, record);
  }
}

function looksLikeRole(text: string): boolean {
  // Must contain a role-shaped keyword to count as a job title.
  return /\b(engineer|developer|manager|director|lead|head|architect|designer|analyst|scientist|specialist|representative|executive|officer|consultant|associate|coordinator|recruiter|advocate|advisor|strategist|administrator|writer|editor|producer|partner|founder|president|controller|counsel|operator|technician)\b/i.test(text);
}

const DEPARTMENT_BUCKETS: Array<{ dept: string; pat: RegExp }> = [
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

function classifyDepartment(roleText: string, into: Set<string>): void {
  for (const b of DEPARTMENT_BUCKETS) {
    if (b.pat.test(roleText)) {
      into.add(b.dept);
      return;
    }
  }
}

/**
 * Run all bucket patterns against a free-text description (e.g. an HN hiring
 * comment) and return every matching department. Used by the hiring-floor
 * reconciliation in main.ts when discovery surfaced a hiring signal but the
 * homepage-side extractor missed open roles.
 */
export function inferDepartmentsFromText(text: string): string[] {
  if (!text) return [];
  const out = new Set<string>();
  for (const b of DEPARTMENT_BUCKETS) {
    if (b.pat.test(text)) out.add(b.dept);
  }
  return Array.from(out).sort();
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
