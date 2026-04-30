import { EnrichedLead } from '../types.js';
import { chatComplete } from '../utils/llm.js';

/**
 * Generate 2–3 short, ready-to-send personalisation hooks for a BD outreach.
 *
 * Strategy: collect the most recent / most BD-relevant signals already
 * extracted (intent signals, leadership, recent press, hiring) and ask the LLM
 * to turn them into one-sentence hooks. Returns [] when there's not enough
 * signal to be specific (we'd rather emit nothing than something generic).
 */
export async function generateOutreachHooks(lead: EnrichedLead): Promise<string[]> {
  const facts = collectFacts(lead);
  if (facts.length < 1) return [];

  const system = [
    'You write short, specific outreach openers for B2B sales reps.',
    'Each hook must reference one concrete fact from the input — never invent details.',
    'Tone: peer-to-peer, curious, not salesy. No hype words ("revolutionary", "game-changing").',
    'Length: one sentence per hook, ≤ 25 words.',
    'Output: a JSON array of strings ONLY, no surrounding prose, no markdown fences.',
  ].join(' ');

  const user = [
    `Company: ${lead.companyName ?? lead.companyUrl}`,
    `URL: ${lead.companyUrl}`,
    '',
    'Facts:',
    ...facts.map((f, i) => `${i + 1}. ${f}`),
    '',
    'Write 2–3 outreach hooks as a JSON array of strings. Each must reference exactly one fact.',
  ].join('\n');

  let raw: string;
  try {
    raw = await chatComplete(
      [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      { maxTokens: 400, temperature: 0.5 },
    );
  } catch {
    return [];
  }

  return parseHooks(raw);
}

function collectFacts(lead: EnrichedLead): string[] {
  const facts: string[] = [];
  const sig = lead.intentSignals;

  if (sig?.recentFundingMention) {
    facts.push(`Funding mention on ${sig.recentFundingMention.sourceUrl}: "${sig.recentFundingMention.text}"`);
  }
  if (sig?.leadershipChange) {
    facts.push(`Leadership change: ${sig.leadershipChange.name} as ${sig.leadershipChange.newRole}`);
  }
  if (sig?.productLaunch) {
    facts.push(`Recent launch / announcement: "${sig.productLaunch.title}"`);
  }
  if (sig?.hiringSurge?.openRoles >= 3) {
    facts.push(
      `Hiring ${sig.hiringSurge.openRoles} open roles` +
      (sig.hiringSurge.departments.length ? ` across ${sig.hiringSurge.departments.join(', ')}` : '')
    );
  }
  // Surface the top-ranked decision-maker (sales/exec/founder) if any
  const topPerson = lead.keyPeople.find((p) => ['founder', 'executive', 'sales'].includes(p.category))
    ?? lead.keyPeople[0];
  if (topPerson) {
    facts.push(`Decision-maker on team: ${topPerson.name}, ${topPerson.title || topPerson.category}`);
  }
  if (lead.businessSignals.hasCustomerLogos) {
    facts.push('Site features customer-logo wall (established product company)');
  }
  if (lead.techStack.cms || lead.techStack.frameworks.length) {
    const techParts = [lead.techStack.cms, ...lead.techStack.frameworks].filter(Boolean) as string[];
    if (techParts.length) facts.push(`Tech stack includes: ${techParts.slice(0, 4).join(', ')}`);
  }
  if (sig?.recentPressItems?.length) {
    facts.push(`Recent press headlines: ${sig.recentPressItems.slice(0, 3).map((t) => `"${t}"`).join('; ')}`);
  }
  if (lead.description) {
    facts.push(`Company description: ${lead.description.slice(0, 220)}`);
  }
  return facts;
}

function parseHooks(raw: string): string[] {
  // Strip ``` fences if model added them despite instructions
  const cleaned = raw.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();

  // Try strict JSON parse first
  try {
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) {
      return parsed
        .filter((s): s is string => typeof s === 'string')
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
        .slice(0, 3);
    }
  } catch {
    // fall through
  }

  // Extract a JSON array slice from the response
  const start = cleaned.indexOf('[');
  const end = cleaned.lastIndexOf(']');
  if (start >= 0 && end > start) {
    try {
      const sliced = JSON.parse(cleaned.slice(start, end + 1));
      if (Array.isArray(sliced)) {
        return sliced
          .filter((s): s is string => typeof s === 'string')
          .map((s) => s.trim())
          .filter((s) => s.length > 0)
          .slice(0, 3);
      }
    } catch {
      // fall through
    }
  }

  // Last-resort: split lines starting with "- " or numbered items
  const lines = cleaned
    .split('\n')
    .map((l) => l.replace(/^\s*(?:[-*]|\d+\.)\s*/, '').replace(/^["']|["']$/g, '').trim())
    .filter((l) => l.length > 10);
  return lines.slice(0, 3);
}
