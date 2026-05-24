import { jest, describe, test, expect, beforeAll, beforeEach } from '@jest/globals';

// ── fixtures ──────────────────────────────────────────────────────────────────

const validIntake = {
  party: [{
    name: 'Aria', class: 'Rogue', personality: 'sardonic',
    backstory_hook: 'guild fugitive', playstyle_notes: 'cunning over confrontation',
  }],
  preferences: {
    tone: 'dark', primary_goal: 'uncover a conspiracy', time_available: '3 hours',
    combat_ratio: 0.3, problem_solving_preference: 'investigation', content_limits: [],
  },
};

const noOp = () => {};

// ── mock Anthropic SDK ────────────────────────────────────────────────────────

const mockCreate = jest.fn();

jest.unstable_mockModule('@anthropic-ai/sdk', () => ({
  default: jest.fn().mockImplementation(() => ({
    messages: { create: mockCreate },
  })),
}));

// ── import intake after mocks ─────────────────────────────────────────────────

let run, step;

beforeAll(async () => {
  const mod = await import('../../agents/intake.js');
  run = mod.run;
  step = mod.step;
});

beforeEach(() => {
  jest.clearAllMocks();
});

// ── helpers ───────────────────────────────────────────────────────────────────

function apiResponds(text) {
  mockCreate.mockResolvedValue({ content: [{ text }] });
}

function apiRespondsSequence(...texts) {
  for (const text of texts) {
    mockCreate.mockResolvedValueOnce({ content: [{ text }] });
  }
}

function inputSequence(...responses) {
  const fn = jest.fn();
  for (const r of responses) fn.mockResolvedValueOnce(r);
  return fn;
}

// ── happy path ────────────────────────────────────────────────────────────────

describe('run — happy path', () => {
  test('returns parsed intake when LLM produces bare JSON immediately', async () => {
    apiResponds(JSON.stringify(validIntake));
    const result = await run(jest.fn(), { outputFn: noOp });
    expect(result).toEqual(validIntake);
  });

  test('returns parsed intake when LLM produces JSON in ```json fences', async () => {
    apiResponds('```json\n' + JSON.stringify(validIntake) + '\n```');
    const result = await run(jest.fn(), { outputFn: noOp });
    expect(result).toEqual(validIntake);
  });

  test('returns parsed intake when LLM produces JSON in plain ``` fences', async () => {
    apiResponds('```\n' + JSON.stringify(validIntake) + '\n```');
    const result = await run(jest.fn(), { outputFn: noOp });
    expect(result).toEqual(validIntake);
  });

  test('does not call inputFn when JSON found on first response', async () => {
    apiResponds(JSON.stringify(validIntake));
    const inputFn = jest.fn();
    await run(inputFn, { outputFn: noOp });
    expect(inputFn).not.toHaveBeenCalled();
  });

  test('calls Anthropic API with cache_control on system prompt', async () => {
    apiResponds(JSON.stringify(validIntake));
    await run(jest.fn(), { outputFn: noOp });
    const call = mockCreate.mock.calls[0][0];
    expect(call.system[0].cache_control).toEqual({ type: 'ephemeral' });
    expect(call.system[0].text.length).toBeGreaterThan(50);
  });

  test('kicks off conversation with "Start the session." user message', async () => {
    apiResponds(JSON.stringify(validIntake));
    await run(jest.fn(), { outputFn: noOp });
    const firstMessages = mockCreate.mock.calls[0][0].messages;
    expect(firstMessages[0]).toEqual({ role: 'user', content: 'Start the session.' });
  });
});

// ── multi-turn conversation ───────────────────────────────────────────────────

describe('run — conversation loop', () => {
  test('continues conversation when LLM responds without JSON', async () => {
    apiRespondsSequence(
      'Welcome! Tell me about your party.',
      JSON.stringify(validIntake),
    );
    const inputFn = inputSequence('We have Aria, a rogue.');
    const result = await run(inputFn, { outputFn: noOp });
    expect(result).toEqual(validIntake);
    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect(inputFn).toHaveBeenCalledTimes(1);
  });

  test('handles multiple turns before JSON', async () => {
    apiRespondsSequence(
      'What are your character names?',
      'What tone do you prefer?',
      JSON.stringify(validIntake),
    );
    const inputFn = inputSequence('Aria and Brom.', 'Dark and gritty.');
    await run(inputFn, { outputFn: noOp });
    expect(mockCreate).toHaveBeenCalledTimes(3);
    expect(inputFn).toHaveBeenCalledTimes(2);
  });

  test('builds correct alternating message history', async () => {
    apiRespondsSequence(
      'Tell me about your party.',
      JSON.stringify(validIntake),
    );
    const inputFn = inputSequence('We have one rogue.');
    await run(inputFn, { outputFn: noOp });

    const secondCallMessages = mockCreate.mock.calls[1][0].messages;
    expect(secondCallMessages[0]).toEqual({ role: 'user', content: 'Start the session.' });
    expect(secondCallMessages[1]).toEqual({ role: 'assistant', content: 'Tell me about your party.' });
    expect(secondCallMessages[2]).toEqual({ role: 'user', content: 'We have one rogue.' });
  });

  test('outputs LLM text via outputFn when not JSON', async () => {
    apiRespondsSequence(
      'Welcome! Tell me about your characters.',
      JSON.stringify(validIntake),
    );
    const outputFn = jest.fn();
    await run(inputSequence('Info here.'), { outputFn });
    expect(outputFn).toHaveBeenCalledWith('Welcome! Tell me about your characters.');
  });

  test('does not call outputFn when LLM produces JSON', async () => {
    apiResponds(JSON.stringify(validIntake));
    const outputFn = jest.fn();
    await run(jest.fn(), { outputFn });
    expect(outputFn).not.toHaveBeenCalled();
  });
});

// ── validation ────────────────────────────────────────────────────────────────

describe('run — validation', () => {
  test('throws when party is missing', async () => {
    const { party: _, ...without } = validIntake;
    apiResponds(JSON.stringify(without));
    await expect(run(jest.fn(), { outputFn: noOp })).rejects.toThrow('"party"');
  });

  test('throws when party is empty array', async () => {
    apiResponds(JSON.stringify({ ...validIntake, party: [] }));
    await expect(run(jest.fn(), { outputFn: noOp })).rejects.toThrow('"party"');
  });

  test('throws when party member is missing a required field', async () => {
    const bad = { ...validIntake, party: [{ name: 'Aria', class: 'Rogue' }] };
    apiResponds(JSON.stringify(bad));
    await expect(run(jest.fn(), { outputFn: noOp })).rejects.toThrow('personality');
  });

  test('throws when preferences is missing', async () => {
    const { preferences: _, ...without } = validIntake;
    apiResponds(JSON.stringify(without));
    await expect(run(jest.fn(), { outputFn: noOp })).rejects.toThrow('"preferences"');
  });

  test('throws when preferences.tone is missing', async () => {
    const { tone: _, ...prefsWithout } = validIntake.preferences;
    apiResponds(JSON.stringify({ ...validIntake, preferences: prefsWithout }));
    await expect(run(jest.fn(), { outputFn: noOp })).rejects.toThrow('"tone"');
  });

  test('throws when preferences.combat_ratio is missing', async () => {
    const { combat_ratio: _, ...prefsWithout } = validIntake.preferences;
    apiResponds(JSON.stringify({ ...validIntake, preferences: prefsWithout }));
    await expect(run(jest.fn(), { outputFn: noOp })).rejects.toThrow('"combat_ratio"');
  });

  test('throws when content_limits is not an array', async () => {
    apiResponds(JSON.stringify({ ...validIntake, preferences: { ...validIntake.preferences, content_limits: 'none' } }));
    await expect(run(jest.fn(), { outputFn: noOp })).rejects.toThrow('content_limits');
  });
});

// ── limits ────────────────────────────────────────────────────────────────────

describe('run — max turns', () => {
  test('throws after maxTurns exceeded with no JSON produced', async () => {
    apiResponds('Tell me more...');
    const inputFn = jest.fn().mockResolvedValue('More info.');
    await expect(run(inputFn, { outputFn: noOp, maxTurns: 3 })).rejects.toThrow('max turns');
    expect(mockCreate).toHaveBeenCalledTimes(3);
  });
});

// ── step() — single HTTP turn ─────────────────────────────────────────────────

describe('step — single HTTP turn', () => {
  test('returns { done: true, intake } when LLM produces JSON', async () => {
    apiResponds(JSON.stringify(validIntake));
    const result = await step([{ role: 'user', content: 'Start the session.' }]);
    expect(result).toEqual({ done: true, intake: validIntake });
  });

  test('returns { done: false, text } when LLM produces conversational response', async () => {
    apiResponds('Tell me about your characters.');
    const result = await step([{ role: 'user', content: 'Start the session.' }]);
    expect(result).toEqual({ done: false, text: 'Tell me about your characters.' });
  });

  test('retries on 429 and returns result on second attempt', async () => {
    const rateLimitError = Object.assign(new Error('rate limited'), { status: 429 });
    mockCreate
      .mockRejectedValueOnce(rateLimitError)
      .mockResolvedValueOnce({ content: [{ text: JSON.stringify(validIntake) }] });
    const result = await step([{ role: 'user', content: 'Start.' }]);
    expect(result).toEqual({ done: true, intake: validIntake });
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });
});

// ── retry behaviour ───────────────────────────────────────────────────────────

describe('run — retry behaviour', () => {
  test('retries on 429 and succeeds on second attempt', async () => {
    const rateLimitError = Object.assign(new Error('rate limited'), { status: 429 });
    mockCreate
      .mockRejectedValueOnce(rateLimitError)
      .mockResolvedValueOnce({ content: [{ text: JSON.stringify(validIntake) }] });
    const result = await run(jest.fn(), { outputFn: noOp });
    expect(result).toEqual(validIntake);
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });

  test('throws immediately on non-retriable error', async () => {
    const badRequest = Object.assign(new Error('bad request'), { status: 400 });
    mockCreate.mockRejectedValue(badRequest);
    await expect(run(jest.fn(), { outputFn: noOp })).rejects.toThrow('bad request');
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });
});
