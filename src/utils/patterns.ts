/**
 * Email extraction patterns
 */
export const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

/**
 * Emails to filter out (generic/no-reply)
 */
export const FILTERED_EMAIL_PATTERNS = [
  /^noreply@/i,
  /^no-reply@/i,
  /^donotreply@/i,
  /^do-not-reply@/i,
  /^mailer-daemon@/i,
  /^postmaster@/i,
  /^webmaster@/i,
  /example\.com$/i,
  /test\.com$/i,
  /placeholder/i,
];

/**
 * Phone number patterns (international)
 */
export const PHONE_PATTERNS = [
  // US/Canada: (123) 456-7890, 123-456-7890, 123.456.7890
  /\+?1?[-.\s]?\(?[0-9]{3}\)?[-.\s]?[0-9]{3}[-.\s]?[0-9]{4}/g,
  // International with + prefix
  /\+[0-9]{1,3}[-.\s]?[0-9]{1,4}[-.\s]?[0-9]{1,4}[-.\s]?[0-9]{1,9}/g,
  // Generic international
  /\+?[0-9]{7,15}/g,
];

/**
 * Social media URL patterns
 */
export const SOCIAL_PATTERNS = {
  linkedin: [
    /https?:\/\/(www\.)?linkedin\.com\/company\/[a-zA-Z0-9_-]+\/?/gi,
    /https?:\/\/(www\.)?linkedin\.com\/in\/[a-zA-Z0-9_-]+\/?/gi,
  ],
  twitter: [
    /https?:\/\/(www\.)?(twitter|x)\.com\/[a-zA-Z0-9_]+\/?/gi,
  ],
  facebook: [
    /https?:\/\/(www\.)?facebook\.com\/[a-zA-Z0-9._-]+\/?/gi,
    /https?:\/\/(www\.)?fb\.com\/[a-zA-Z0-9._-]+\/?/gi,
  ],
  youtube: [
    /https?:\/\/(www\.)?youtube\.com\/(c\/|channel\/|user\/)?[a-zA-Z0-9_-]+\/?/gi,
  ],
  github: [
    /https?:\/\/(www\.)?github\.com\/[a-zA-Z0-9_-]+\/?/gi,
  ],
  instagram: [
    /https?:\/\/(www\.)?instagram\.com\/[a-zA-Z0-9._]+\/?/gi,
  ],
  crunchbase: [
    /https?:\/\/(www\.)?crunchbase\.com\/(organization|company)\/[a-zA-Z0-9_-]+\/?/gi,
  ],
};

/**
 * Tech stack detection patterns
 */
export const TECH_PATTERNS = {
  cms: {
    WordPress: [/wp-content/i, /wp-includes/i, /wordpress/i],
    Shopify: [/cdn\.shopify\.com/i, /shopify/i],
    Webflow: [/webflow/i],
    Wix: [/wix\.com/i, /wixsite/i, /parastorage\.com/i],
    Squarespace: [/squarespace/i, /sqsp/i],
    Drupal: [/drupal/i, /sites\/all\/themes/i],
    Joomla: [/joomla/i, /\/media\/system/i],
    Ghost: [/ghost\.io/i, /ghost\.org/i],
    HubSpot: [/hubspot/i, /hs-scripts/i, /hbspt/i],
    Contentful: [/contentful/i],
  },
  analytics: {
    'Google Analytics': [/gtag/i, /google-analytics/i, /UA-\d+/i, /G-[A-Z0-9]+/i, /googletagmanager/i],
    'Google Tag Manager': [/googletagmanager\.com\/gtm/i, /GTM-[A-Z0-9]+/i],
    Mixpanel: [/mixpanel/i],
    Amplitude: [/amplitude/i],
    Segment: [/segment\.com/i, /analytics\.js/i, /cdn\.segment/i],
    Hotjar: [/hotjar/i, /hj\(/i],
    FullStory: [/fullstory/i],
    Heap: [/heap\.io/i, /heapanalytics/i],
    Plausible: [/plausible/i],
    Fathom: [/usefathom/i],
  },
  chat: {
    Intercom: [/intercom/i, /widget\.intercom\.io/i],
    Drift: [/drift\.com/i, /driftt/i],
    Zendesk: [/zendesk/i, /zdassets/i],
    Freshdesk: [/freshdesk/i],
    Crisp: [/crisp\.chat/i],
    'Tawk.to': [/tawk\.to/i],
    HubSpot: [/hubspot.*chat/i, /hs-scripts.*chatflow/i],
    LiveChat: [/livechatinc/i],
  },
  payment: {
    Stripe: [/stripe\.com/i, /stripe\.js/i, /js\.stripe/i],
    PayPal: [/paypal/i, /paypalobjects/i],
    Braintree: [/braintree/i],
    Square: [/squareup/i, /square\.com/i],
    Shopify: [/shopify.*pay/i],
  },
  frameworks: {
    React: [/__REACT/i, /react-dom/i, /react\.production/i, /_jsx/i],
    Vue: [/vue\.js/i, /vuejs/i, /__VUE/i, /vue\.runtime/i],
    Angular: [/angular/i, /ng-version/i],
    'Next.js': [/_next/i, /__NEXT/i, /next\/dist/i],
    'Nuxt.js': [/nuxt/i, /__NUXT/i],
    Svelte: [/svelte/i],
    jQuery: [/jquery/i],
    Bootstrap: [/bootstrap/i],
    Tailwind: [/tailwindcss/i, /tailwind/i],
  },
  hosting: {
    AWS: [/amazonaws\.com/i, /cloudfront\.net/i],
    Cloudflare: [/cloudflare/i, /cdnjs\.cloudflare/i],
    Vercel: [/vercel/i, /\.vercel\.app/i],
    Netlify: [/netlify/i],
    Heroku: [/heroku/i],
    'Google Cloud': [/googleapis\.com/i, /googleusercontent/i],
    Azure: [/azure/i, /azurewebsites/i, /azureedge/i],
    DigitalOcean: [/digitalocean/i],
    Fastly: [/fastly/i],
  },
};

/**
 * Business signal page patterns
 */
export const BUSINESS_PAGE_PATTERNS = {
  careers: [/\/careers?\/?/i, /\/jobs\/?/i, /\/join-us/i, /\/work-with-us/i, /greenhouse\.io/i, /lever\.co/i, /workable/i, /\/open-roles/i, /\/openings/i],
  blog: [/\/blog\/?$/i, /\/news\/?$/i, /\/articles\/?$/i, /\/insights\/?$/i],
  pricing: [/\/pricing\/?$/i, /\/plans\/?$/i, /\/packages\/?$/i],
  contact: [/\/contact\/?$/i, /\/contact-us\/?$/i, /\/get-in-touch/i],
  about: [/\/about\/?$/i, /\/about-us\/?$/i, /\/company\/?$/i, /\/our-story/i],
  people: [
    /\/team\/?$/i,
    /\/our-team\/?$/i,
    /\/leadership\/?$/i,
    /\/leaders\/?$/i,
    /\/people\/?$/i,
    /\/founders\/?$/i,
    /\/management\/?$/i,
    /\/executives\/?$/i,
    /\/about\/team\/?$/i,
    /\/about-us\/team\/?$/i,
    /\/who-we-are\/?$/i,
    /\/staff\/?$/i,
  ],
  press: [
    /\/press\/?/i,
    /\/news\/?/i,
    /\/newsroom\/?/i,
    /\/media\/?/i,
    /\/announcements\/?/i,
    /\/press-releases?\/?/i,
  ],
};

/**
 * Title-keyword to role-category mapping for KeyPerson categorization.
 * Order matters: founder first (so "founder & CEO" catches founder), then specific roles.
 */
export const ROLE_KEYWORDS: Array<{ category: string; patterns: RegExp[] }> = [
  { category: 'founder', patterns: [/\bco-?founder\b/i, /\bfounder\b/i] },
  { category: 'executive', patterns: [/\bceo\b/i, /chief executive/i, /\bcoo\b/i, /chief operating/i, /\bpresident\b/i, /\bowner\b/i, /managing director/i] },
  { category: 'sales', patterns: [/\bcro\b/i, /chief revenue/i, /vp.*sales/i, /vice president.*sales/i, /head of sales/i, /sales director/i, /director of sales/i, /\bcco\b/i, /chief commercial/i, /\bcso\b/i] },
  { category: 'marketing', patterns: [/\bcmo\b/i, /chief marketing/i, /vp.*marketing/i, /head of marketing/i, /director of marketing/i, /marketing director/i, /head of growth/i] },
  { category: 'tech', patterns: [/\bcto\b/i, /chief technology/i, /\bcio\b/i, /chief information/i, /vp.*engineering/i, /head of engineering/i, /engineering director/i, /director of engineering/i, /\bcdo\b/i, /chief data/i] },
  { category: 'product', patterns: [/\bcpo\b/i, /chief product/i, /vp.*product/i, /head of product/i, /director of product/i, /product director/i] },
  { category: 'finance', patterns: [/\bcfo\b/i, /chief financial/i, /vp.*finance/i, /head of finance/i, /finance director/i] },
  { category: 'people', patterns: [/\bchro\b/i, /chief (people|human)/i, /vp.*people/i, /head of people/i, /head of (hr|talent)/i] },
];

/**
 * Patterns that signal a recent funding event in press/news/blog content.
 */
export const FUNDING_PATTERNS = [
  /\b(series\s+[a-h])\b[^.]{0,120}\$[\d.,]+\s?(m|mm|million|b|bn|billion)?/i,
  /\$[\d.,]+\s?(m|mm|million|b|bn|billion)\s+(in\s+)?(funding|round|raise[d]?|investment|series\s+[a-h])/i,
  /\braised\s+\$[\d.,]+\s?(m|mm|million|b|bn|billion)?/i,
  /\bsecured\s+\$[\d.,]+\s?(m|mm|million|b|bn|billion)?\s+(funding|round|investment)/i,
  /\bclosed\s+(a\s+)?\$[\d.,]+\s?(m|mm|million|b|bn|billion)?\s+(seed|series|round|funding)/i,
];

/**
 * Patterns that signal a leadership change (new hire, promotion, appointment).
 */
export const LEADERSHIP_CHANGE_PATTERNS = [
  /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})\s+(joins|joined|appointed as|named as|named|welcomes|welcomed|hired as|promoted to)\s+(?:our\s+)?(?:new\s+)?([^.]{3,80})/,
  /(welcomes|welcoming|appoints|appointed|names|named)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})\s+(?:as|to)\s+(?:its|our)?\s*(?:new\s+)?([^.]{3,80})/,
];

/**
 * Patterns that signal a product launch / announcement.
 */
export const PRODUCT_LAUNCH_PATTERNS = [
  /\b(announc(?:ing|e|ed|ement)|introduc(?:ing|e|ed)|launch(?:ing|ed)?|now available|unveil(?:ing|ed)?|releas(?:ing|ed))\b/i,
];
