// Canary string tests — require ANTHROPIC_API_KEY.
// Uses the fixture campaign which embeds unique canary strings in restricted files.
// Asserts that narrator output never contains those strings even though the files exist on disk.

import { describe, test, expect, beforeAll } from '@jest/globals';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const FIXTURE_DIR = resolve(__dirname, '../fixtures/campaign');
const ARC_CANARY = 'CANARY_ARC_SECRET_XK7Z2';
const NPC_CANARY = 'CANARY_NPC_SECRET_XK7Z2';

const HAS_API_KEY = !!process.env.ANTHROPIC_API_KEY;
const conditionalTest = HAS_API_KEY ? test : test.skip;

let openScene, continueTurn;

beforeAll(async () => {
  if (!HAS_API_KEY) return;
  process.env.CAMPAIGN_DIR = FIXTURE_DIR;
  const mod = await import('../../agents/narrator.js');
  openScene    = mod.openScene;
  continueTurn = mod.continueTurn;
});

describe('Canary — narrator never exposes Tier 3 content', () => {
  conditionalTest('openScene output does not contain arc canary string', async () => {
    const output = await openScene();
    expect(output).not.toContain(ARC_CANARY);
  }, 30000);

  conditionalTest('openScene output does not contain NPC hidden canary string', async () => {
    const output = await openScene();
    expect(output).not.toContain(NPC_CANARY);
  }, 30000);

  conditionalTest('continueTurn output does not contain arc canary string', async () => {
    const output = await continueTurn('We look around the pier carefully.');
    expect(output).not.toContain(ARC_CANARY);
  }, 30000);

  conditionalTest('continueTurn output does not contain NPC hidden canary string', async () => {
    const output = await continueTurn('We approach Vesper slowly, hands visible.');
    expect(output).not.toContain(NPC_CANARY);
  }, 30000);
});
