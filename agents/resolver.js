import Anthropic from '@anthropic-ai/sdk';
import { readFile } from '../fileUtils.js';
import { fileURLToPath } from 'url';
import { resolve, dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SYSTEM_PROMPT_PATH = resolve(__dirname, '../prompts/resolver_system.txt');
const MODEL = process.env.RESOLVER_MODEL ?? 'claude-haiku-4-5-20251001';

const REQUIRED_FIELDS = [
  'encounter_id', 'turn', 'revelation_triggers', 'resolution_triggered',
  'object_state_changes', 'npc_attitude_changes', 'encounter_continues',
  'requires_narrative_update', 'notes',
];

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

// ── validation ────────────────────────────────────────────────────────────────

function validate(result) {
  for (const field of REQUIRED_FIELDS) {
    if (!(field in result)) throw new Error(`Resolver response missing field: "${field}"`);
  }
  if (!Array.isArray(result.revelation_triggers))   throw new Error('revelation_triggers must be an array');
  if (!Array.isArray(result.object_state_changes))  throw new Error('object_state_changes must be an array');
  if (!Array.isArray(result.npc_attitude_changes))  throw new Error('npc_attitude_changes must be an array');
  return result;
}

// ── main export ───────────────────────────────────────────────────────────────

export async function evaluate(params) {
  const {
    input,
    accumulated_inputs = [],
    revelation_conditions = [],
    resolution_conditions = {},
    location_secrets = null,
    npc_attitudes = {},
    encounter_id,
    turn,
  } = params;

  const userMessage = [
    '## Current Player Input',
    input,
    '',
    '## Accumulated Player Inputs This Encounter',
    accumulated_inputs.map((inp, i) => `Turn ${i + 1}: ${inp}`).join('\n') || '(none yet)',
    '',
    '## Encounter ID',
    encounter_id,
    '',
    '## Turn Number',
    String(turn),
    '',
    '## Revelation Conditions',
    JSON.stringify(revelation_conditions, null, 2),
    '',
    '## Resolution Conditions',
    JSON.stringify(resolution_conditions, null, 2),
    '',
    '## Location Secrets',
    JSON.stringify(location_secrets, null, 2),
    '',
    '## Active NPC Attitudes',
    JSON.stringify(npc_attitudes, null, 2),
  ].join('\n');

  const client = new Anthropic();
  const response = await withRetry(() =>
    client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: [{ type: 'text', text: systemPrompt(), cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: userMessage }],
    })
  );

  const raw = response.content[0].text.trim();
  const jsonText = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();

  let result;
  try {
    result = JSON.parse(jsonText);
  } catch (err) {
    throw new Error(`Resolver returned invalid JSON: ${err.message}\nRaw: ${raw.slice(0, 300)}`);
  }

  return validate(result);
}
