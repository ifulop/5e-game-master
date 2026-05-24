import Anthropic from '@anthropic-ai/sdk';
import { readFile } from '../fileUtils.js';
import { fileURLToPath } from 'url';
import { resolve, dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SYSTEM_PROMPT_PATH = resolve(__dirname, '../prompts/summarizer_system.txt');
const MODEL = process.env.SUMMARIZER_MODEL ?? 'claude-haiku-4-5-20251001';

let _systemPrompt = null;
function systemPrompt() {
  _systemPrompt ??= readFile(SYSTEM_PROMPT_PATH);
  return _systemPrompt;
}

// ── retry ─────────────────────────────────────────────────────────────────────

function isRetriable(err) {
  return err?.status === 429 || err?.status === 529;
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

// ── main export ───────────────────────────────────────────────────────────────

export async function summarize({ encounter_exchange, resolution }) {
  const userMessage = [
    '## Encounter Exchange',
    encounter_exchange || '(no turns recorded)',
    '',
    '## Resolution Result',
    JSON.stringify(resolution, null, 2),
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

  return response.content[0].text.trim();
}
