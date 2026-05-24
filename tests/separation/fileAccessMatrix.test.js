// Static code analysis — no LLM, no filesystem reads of campaign data.
// Each test reads agent source files and asserts forbidden patterns are absent.

import { describe, test, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const agentsDir = resolve(__dirname, '../../agents');
const rootDir   = resolve(__dirname, '../..');

const narratorSrc    = readFileSync(`${agentsDir}/narrator.js`,    'utf8');
const resolverSrc    = readFileSync(`${agentsDir}/resolver.js`,    'utf8');
const summarizerSrc  = readFileSync(`${agentsDir}/summarizer.js`,  'utf8');
const orchestratorSrc = readFileSync(`${rootDir}/index.js`,        'utf8');

// ── Narrator ──────────────────────────────────────────────────────────────────

describe('Narrator — forbidden file references', () => {
  test('does not construct a path containing arc_brief', () => {
    expect(narratorSrc).not.toMatch(/arc_brief/);
  });

  test('does not construct a path containing _hidden.md', () => {
    expect(narratorSrc).not.toMatch(/_hidden\.md/);
  });

  test('does not call readJSON with campaign.json', () => {
    // campaign.json contains resolution/revelation conditions — narrator must never read it
    expect(narratorSrc).not.toMatch(/readJSON\s*\([^)]*campaign\.json/);
    expect(narratorSrc).not.toMatch(/campaign\.json/);
  });
});

// ── Resolver ──────────────────────────────────────────────────────────────────

describe('Resolver — forbidden file references', () => {
  test('does not construct a path containing arc_brief', () => {
    expect(resolverSrc).not.toMatch(/arc_brief/);
  });

  test('does not construct a path containing _hidden.md', () => {
    expect(resolverSrc).not.toMatch(/_hidden\.md/);
  });

  test('does not construct paths to encounter brief files (enc_XXX.md)', () => {
    // Resolver receives structured JSON inputs — it must not load encounter prose
    expect(resolverSrc).not.toMatch(/['"`]enc_/);
  });

  test('does not construct a path containing world_primer', () => {
    expect(resolverSrc).not.toMatch(/world_primer/);
  });
});

// ── Orchestrator ──────────────────────────────────────────────────────────────

describe('Orchestrator — forbidden file reads', () => {
  test('does not call readFile on any markdown file', () => {
    // Orchestrator reads only structured JSON — no prose files
    expect(orchestratorSrc).not.toMatch(/readFile\s*\([^)]*\.md/);
  });

  test('does not import readFile from fileUtils', () => {
    // readFile is for agents reading prompts and narrative files — not the orchestrator
    expect(orchestratorSrc).not.toMatch(/\breadFile\b/);
  });
});

// ── Summarizer ────────────────────────────────────────────────────────────────

describe('Summarizer — forbidden file references', () => {
  test('does not construct a path containing arc_brief', () => {
    expect(summarizerSrc).not.toMatch(/arc_brief/);
  });

  test('does not construct a path containing campaign.json', () => {
    expect(summarizerSrc).not.toMatch(/campaign\.json/);
  });
});
