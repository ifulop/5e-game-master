import Anthropic from '@anthropic-ai/sdk';
import { readFile } from '../fileUtils.js';
import { fileURLToPath } from 'url';
import { resolve, dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROMPTS_DIR = resolve(__dirname, '../prompts');
const MODEL = process.env.INTAKE_MODEL ?? 'claude-sonnet-4-6';

let _reviewPrompt = null;
let _finalizePrompt = null;

function reviewPrompt() {
  _reviewPrompt ??= readFile(`${PROMPTS_DIR}/intake_review_system.txt`);
  return _reviewPrompt;
}

function finalizePrompt() {
  _finalizePrompt ??= readFile(`${PROMPTS_DIR}/intake_finalize_system.txt`);
  return _finalizePrompt;
}

// ── retry ─────────────────────────────────────────────────────────────────────

function isRetriable(err) {
  return err?.status === 429 || err?.status === 529 || err?.status === 500 || err?.code === 'ECONNRESET';
}

async function withRetry(fn, maxAttempts = 3) {
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isRetriable(err) || attempt === maxAttempts) throw err;
      const jitter = 0.8 + Math.random() * 0.4;
      await new Promise(r => setTimeout(r, Math.round(1000 * 2 ** (attempt - 1) * jitter)));
    }
  }
  throw lastErr;
}

// ── JSON extraction ───────────────────────────────────────────────────────────

function tryExtractJSON(text) {
  const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (fenceMatch) {
    try { return JSON.parse(fenceMatch[1].trim()); } catch { /* fall through */ }
  }
  const objMatch = text.match(/\{[\s\S]*\}/);
  if (objMatch) {
    try { return JSON.parse(objMatch[0]); } catch { /* fall through */ }
  }
  return null;
}

// ── validation ────────────────────────────────────────────────────────────────

const PARTY_FIELDS = ['name', 'class', 'personality', 'backstory_hook', 'playstyle_notes'];
const PREFS_FIELDS = ['tone', 'primary_goal', 'time_available', 'combat_ratio', 'problem_solving_preference', 'content_limits'];

export function validate(data) {
  if (!Array.isArray(data.party) || data.party.length === 0) {
    throw new Error('Intake: "party" must be a non-empty array');
  }
  for (const player of data.party) {
    for (const field of PARTY_FIELDS) {
      if (!(field in player)) throw new Error(`Intake: party member missing field "${field}"`);
    }
  }
  if (!data.preferences || typeof data.preferences !== 'object') {
    throw new Error('Intake: "preferences" object is required');
  }
  for (const field of PREFS_FIELDS) {
    if (!(field in data.preferences)) throw new Error(`Intake: preferences missing field "${field}"`);
  }
  if (!Array.isArray(data.preferences.content_limits)) {
    throw new Error('Intake: preferences.content_limits must be an array');
  }
  return data;
}

// ── LLM call ──────────────────────────────────────────────────────────────────

async function callLLM(systemText, userMessage, maxTokens = 1024) {
  const client = new Anthropic();
  const response = await withRetry(() =>
    client.messages.create({
      model: MODEL,
      max_tokens: maxTokens,
      system: [{ type: 'text', text: systemText, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: userMessage }],
    })
  );
  return response.content[0].text;
}

// ── exports ───────────────────────────────────────────────────────────────────

// Step 1: receive structured form data, return narrative character summary
export async function review(formData) {
  const userMessage = `Here is the party's information:\n\n${JSON.stringify(formData, null, 2)}`;
  return callLLM(reviewPrompt(), userMessage);
}

// Step 2: merge additional details into form data, return validated intake object
export async function finalize(formData, additionalDetails) {
  const userMessage = [
    'FORM DATA:',
    JSON.stringify(formData, null, 2),
    '',
    'ADDITIONAL DETAILS:',
    additionalDetails,
  ].join('\n');
  const text = await callLLM(finalizePrompt(), userMessage);
  const parsed = tryExtractJSON(text);
  if (!parsed) throw new Error('Intake finalize: LLM did not return valid JSON');
  return validate(parsed);
}
