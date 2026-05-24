import { readJSON, writeJSON, readFile, writeFile, appendToFile, getEncounterExchange } from '../../fileUtils.js';
import { mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';

const TEST_DIR = join(tmpdir(), `dm-fileutils-${randomUUID()}`);

beforeAll(() => mkdirSync(TEST_DIR, { recursive: true }));
afterAll(() => rmSync(TEST_DIR, { recursive: true, force: true }));

function p(name) {
  return join(TEST_DIR, name);
}

// ── readJSON / writeJSON ────────────────────────────────────────────────────

describe('readJSON / writeJSON', () => {
  test('roundtrip returns identical object', () => {
    const obj = { a: 1, b: [2, 3], c: { d: true } };
    writeJSON(p('roundtrip.json'), obj);
    expect(readJSON(p('roundtrip.json'))).toEqual(obj);
  });

  test('writeJSON creates parent directories when absent', () => {
    writeJSON(p('nested/deep/file.json'), { ok: true });
    expect(readJSON(p('nested/deep/file.json'))).toEqual({ ok: true });
  });

  test('readJSON throws descriptively when file does not exist', () => {
    expect(() => readJSON(p('nonexistent.json'))).toThrow(/cannot read file/);
  });

  test('readJSON throws descriptively when content is malformed JSON', () => {
    writeFile(p('bad.json'), 'not {{ valid json');
    expect(() => readJSON(p('bad.json'))).toThrow(/malformed JSON/);
  });
});

// ── atomic write ───────────────────────────────────────────────────────────

describe('atomic write', () => {
  test('target file contains new content after writeJSON', () => {
    writeJSON(p('atomic.json'), { v: 1 });
    writeJSON(p('atomic.json'), { v: 2 });
    expect(readJSON(p('atomic.json'))).toEqual({ v: 2 });
  });

  test('writeJSON replaces existing file with no partial state', () => {
    writeJSON(p('replace.json'), { original: true });
    writeJSON(p('replace.json'), { updated: true });
    expect(readJSON(p('replace.json'))).toEqual({ updated: true });
  });

  test('concurrent writes to different paths do not corrupt each other', async () => {
    await Promise.all([
      Promise.resolve(writeJSON(p('concurrent-a.json'), { file: 'a' })),
      Promise.resolve(writeJSON(p('concurrent-b.json'), { file: 'b' })),
    ]);
    expect(readJSON(p('concurrent-a.json'))).toEqual({ file: 'a' });
    expect(readJSON(p('concurrent-b.json'))).toEqual({ file: 'b' });
  });
});

// ── appendToFile ───────────────────────────────────────────────────────────

describe('appendToFile', () => {
  test('appending to an existing file adds content at end; prior content unchanged', () => {
    writeFile(p('append.txt'), 'first');
    appendToFile(p('append.txt'), ' second');
    expect(readFile(p('append.txt'))).toBe('first second');
  });

  test('appending to a non-existent file creates the file', () => {
    appendToFile(p('append-new.txt'), 'hello');
    expect(readFile(p('append-new.txt'))).toBe('hello');
  });
});

// ── getEncounterExchange ───────────────────────────────────────────────────

describe('getEncounterExchange', () => {
  test('returns a numbered list from player_inputs', () => {
    const session = { player_inputs: ['look around', 'talk to vesper'] };
    const result = getEncounterExchange(session);
    expect(result).toContain('Turn 1: look around');
    expect(result).toContain('Turn 2: talk to vesper');
  });

  test('returns empty string when player_inputs is empty', () => {
    expect(getEncounterExchange({ player_inputs: [] })).toBe('');
  });

  test('5 entries produce labels Turn 1 through Turn 5', () => {
    const session = { player_inputs: ['a', 'b', 'c', 'd', 'e'] };
    const result = getEncounterExchange(session);
    for (let i = 1; i <= 5; i++) {
      expect(result).toContain(`Turn ${i}:`);
    }
  });
});
