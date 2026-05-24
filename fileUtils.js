import { readFileSync, writeFileSync, appendFileSync, mkdirSync, renameSync, existsSync } from 'fs';
import { dirname, resolve, join } from 'path';
import { randomUUID } from 'crypto';

function ensureDir(dir) {
  if (dir && !existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

export function readJSON(filePath) {
  let raw;
  try {
    raw = readFileSync(filePath, 'utf8');
  } catch (err) {
    throw new Error(`readJSON: cannot read file at "${filePath}": ${err.message}`);
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`readJSON: malformed JSON in "${filePath}": ${err.message}`);
  }
}

export function writeJSON(filePath, data) {
  const absPath = resolve(filePath);
  const dir = dirname(absPath);
  ensureDir(dir);
  const tmp = join(dir, `.tmp-${randomUUID()}`);
  writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  renameSync(tmp, absPath);
}

export function readFile(filePath) {
  try {
    return readFileSync(filePath, 'utf8');
  } catch (err) {
    throw new Error(`readFile: cannot read file at "${filePath}": ${err.message}`);
  }
}

export function writeFile(filePath, content) {
  ensureDir(dirname(resolve(filePath)));
  writeFileSync(filePath, content, 'utf8');
}

export function appendToFile(filePath, content) {
  ensureDir(dirname(resolve(filePath)));
  appendFileSync(filePath, content, 'utf8');
}

export function getEncounterExchange(session) {
  if (!session.player_inputs || session.player_inputs.length === 0) return '';
  return session.player_inputs
    .map((input, i) => `Turn ${i + 1}: ${input}`)
    .join('\n');
}
