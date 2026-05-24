import Anthropic from '@anthropic-ai/sdk';
import { readFile } from '../fileUtils.js';
import { createInterface } from 'readline';
import { fileURLToPath } from 'url';
import { resolve, dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SYSTEM_PROMPT_PATH = resolve(__dirname, '../prompts/intake_system.txt');
const MODEL = process.env.INTAKE_MODEL ?? 'claude-sonnet-4-6';
const DEFAULT_MAX_TURNS = 20;

let _systemPrompt = null;
function systemPrompt() {
  _systemPrompt ??= readFile(SYSTEM_PROMPT_PATH);
  return _systemPrompt;
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
  // try ```json or ``` fence first
  const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (fenceMatch) {
    try { return JSON.parse(fenceMatch[1].trim()); } catch { /* fall through */ }
  }
  // try to find a bare JSON object
  const objMatch = text.match(/\{[\s\S]*\}/);
  if (objMatch) {
    try { return JSON.parse(objMatch[0]); } catch { /* fall through */ }
  }
  return null;
}

// ── validation ────────────────────────────────────────────────────────────────

const PARTY_FIELDS = ['name', 'class', 'personality', 'backstory_hook', 'playstyle_notes'];
const PREFS_FIELDS = ['tone', 'primary_goal', 'time_available', 'combat_ratio', 'problem_solving_preference', 'content_limits'];

function validate(data) {
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

// ── default I/O ───────────────────────────────────────────────────────────────

function createStdinInputFn() {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return () => new Promise(resolve => rl.question('> ', answer => {
    rl.close();
    resolve(answer);
  }));
}

// ── single-step export (HTTP use) ─────────────────────────────────────────────

export async function step(messages) {
  const client = new Anthropic();
  const response = await withRetry(() =>
    client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: [{ type: 'text', text: systemPrompt(), cache_control: { type: 'ephemeral' } }],
      messages,
    })
  );
  const text = response.content[0].text;
  const parsed = tryExtractJSON(text);
  if (parsed) return { done: true, intake: validate(parsed) };
  return { done: false, text };
}

// ── main export ───────────────────────────────────────────────────────────────

export async function run(inputFn, { outputFn, maxTurns } = {}) {
  const input = inputFn ?? createStdinInputFn();
  const output = outputFn ?? (text => process.stdout.write(text + '\n'));
  const MAX = maxTurns ?? DEFAULT_MAX_TURNS;

  const messages = [{ role: 'user', content: 'Start the session.' }];
  const client = new Anthropic();

  for (let turn = 0; turn < MAX; turn++) {
    const response = await withRetry(() =>
      client.messages.create({
        model: MODEL,
        max_tokens: 1024,
        system: [{ type: 'text', text: systemPrompt(), cache_control: { type: 'ephemeral' } }],
        messages,
      })
    );

    const text = response.content[0].text;

    const parsed = tryExtractJSON(text);
    if (parsed) return validate(parsed);

    output(text);
    const playerInput = await input();
    messages.push({ role: 'assistant', content: text });
    messages.push({ role: 'user', content: playerInput });
  }

  throw new Error(`Intake: max turns (${MAX}) exceeded without producing intake data`);
}
