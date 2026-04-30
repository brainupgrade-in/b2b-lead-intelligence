export interface IdealCustomerProfile {
  industries?: string[];
  sizeMin?: number;
  sizeMax?: number;
  requiredTech?: string[];
  preferredTech?: string[];
  geo?: string[];
  keywords?: string[];
}

export type SourceName = 'yc' | 'hn-hiring' | 'cb-news';

export type TriggerEventType =
  | 'funding'
  | 'hiring'
  | 'launch'
  | 'leadership'
  | 'directory';

export interface SourcingConfig {
  sources?: SourceName[];
  recencyDays?: number;
  triggerEventTypes?: TriggerEventType[];
  maxResults?: number;
  industries?: string[];
  keywords?: string[];
}

export interface DiscoverySignal {
  type: TriggerEventType;
  text: string;
  sourceUrl: string;
  seenAt: string;
}

export interface SourcedLead {
  companyName: string;
  companyUrl: string;
  discoverySources: string[];
  discoverySignals: DiscoverySignal[];
  firstSeenAt: string;
  relevanceScore: number;
}

export interface DiscoveryBlock {
  sources: string[];
  signals: DiscoverySignal[];
  firstSeenAt: string;
  relevanceScore: number;
}

export interface Input {
  urls?: string[];
  sourcing?: SourcingConfig;
  maxPagesPerDomain: number;
  extractEmails: boolean;
  extractPhones: boolean;
  detectTechStack: boolean;
  includeSocialProfiles: boolean;
  detectBusinessSignals: boolean;
  extractKeyPeople?: boolean;
  detectIntentSignals?: boolean;
  generateOutreachHooks?: boolean;
  idealCustomerProfile?: IdealCustomerProfile;
  proxyConfiguration?: {
    useApifyProxy?: boolean;
    apifyProxyGroups?: string[];
    proxyUrls?: string[];
  };
}

export interface ContactInfo {
  emails: string[];
  phones: string[];
  contactFormUrl: string | null;
}

export interface SocialProfiles {
  linkedin: string | null;
  twitter: string | null;
  facebook: string | null;
  youtube: string | null;
  github: string | null;
  instagram: string | null;
  crunchbase: string | null;
}

export interface TechStack {
  cms: string | null;
  analytics: string[];
  chat: string | null;
  payment: string[];
  hosting: string | null;
  frameworks: string[];
  other: string[];
}

export interface BusinessSignals {
  hasCareerPage: boolean;
  hasBlog: boolean;
  hasPricingPage: boolean;
  hasContactPage: boolean;
  hasAboutPage: boolean;
  hasCustomerLogos: boolean;
  estimatedSize: string | null;
}

export interface Metadata {
  title: string | null;
  metaDescription: string | null;
  ogImage: string | null;
  favicon: string | null;
  language: string | null;
}

export interface CrawlStats {
  pagesCrawled: number;
  crawlDurationMs: number;
  timestamp: string;
  error?: string;
}

export type PersonCategory =
  | 'executive'
  | 'sales'
  | 'marketing'
  | 'tech'
  | 'founder'
  | 'product'
  | 'finance'
  | 'people'
  | 'other';

export interface KeyPerson {
  name: string;
  title: string;
  category: PersonCategory;
  linkedinUrl: string | null;
  profileImageUrl: string | null;
  sourceUrl: string;
}

export interface FundingMention {
  text: string;
  amount: string | null;
  round: string | null;
  sourceUrl: string;
}

export interface HiringSurge {
  openRoles: number;
  departments: string[];
}

export interface LeadershipChange {
  name: string;
  newRole: string;
  context: string;
  sourceUrl: string;
}

export interface ProductLaunch {
  title: string;
  sourceUrl: string;
}

export interface IntentSignals {
  recentFundingMention: FundingMention | null;
  hiringSurge: HiringSurge;
  leadershipChange: LeadershipChange | null;
  productLaunch: ProductLaunch | null;
  recentPressItems: string[];
}

export interface FitScore {
  score: number;
  reasons: string[];
  disqualifiers: string[];
}

export interface EnrichedLead {
  inputUrl: string;
  companyUrl: string;
  companyName: string | null;
  description: string | null;
  contact: ContactInfo;
  socialProfiles: SocialProfiles;
  techStack: TechStack;
  businessSignals: BusinessSignals;
  keyPeople: KeyPerson[];
  intentSignals: IntentSignals;
  fitScore: FitScore | null;
  outreachHooks: string[];
  metadata: Metadata;
  crawlStats: CrawlStats;
  discovery: DiscoveryBlock | null;
}

export interface PageData {
  url: string;
  html: string;
  title: string | null;
  text: string;
}
