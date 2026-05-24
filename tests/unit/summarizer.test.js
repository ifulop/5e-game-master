import { jest, describe, test, expect, beforeAll, beforeEach } from '@jest/globals';

// ── fixtures ──────────────────────────────────────────────────────────────────

const sampleExchange = 'Turn 1: We enter cautiously\nTurn 2: I search behind the bar\nTurn 3: We grab the ledger and run';

const sampleResolution = {
  encounter_id: 'enc_001',
  turn: 3,
  resolution_triggered: 'victory',
  revelation_triggers: ['tavern_ledger_found'],
  object_state_changes: [{ location: 'tavern', object_id: 'ledger', new_state: 'taken', interacted_by: 'aria', interaction: 'picked up' }],
  npc_attitude_changes: [],
  encounter_continues: false,
  requires_narrative_update: false,
  notes: 'Ledger found and taken.',
};

const sampleSummary = '# Enc 001 Summary — The Burning Tavern\n\n## Outcome: success\n\n## What Happened\nThe party entered the tavern and searched behind the bar.';

// ── mock Anthropic SDK ────────────────────────────────────────────────────────

const mockCreate = jest.fn();

jest.unstable_mockModule('@anthropic-ai/sdk', () => ({
  default: jest.fn().mockImplementation(() => ({
    messages: { create: mockCreate },
  })),
}));

// ── import summarizer after mocks ─────────────────────────────────────────────

let summarize;

beforeAll(async () => {
  const mod = await import('../../agents/summarizer.js');
  summarize = mod.summarize;
});

beforeEach(() => {
  jest.clearAllMocks();
  mockCreate.mockResolvedValue({ content: [{ text: sampleSummary }] });
});

// ── helpers ───────────────────────────────────────────────────────────────────

function apiReturnsText(text) {
  mockCreate.mockResolvedValue({ content: [{ text }] });
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('summarize — happy path', () => {
  test('returns trimmed text from LLM', async () => {
    apiReturnsText('  ' + sampleSummary + '  ');
    const result = await summarize({ encounter_exchange: sampleExchange, resolution: sampleResolution });
    expect(result).toBe(sampleSummary);
  });

  test('calls the Anthropic API exactly once', async () => {
    await summarize({ encounter_exchange: sampleExchange, resolution: sampleResolution });
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  test('passes system prompt with cache_control ephemeral', async () => {
    await summarize({ encounter_exchange: sampleExchange, resolution: sampleResolution });
    const call = mockCreate.mock.calls[0][0];
    expect(call.system[0].cache_control).toEqual({ type: 'ephemeral' });
    expect(call.system[0].type).toBe('text');
    expect(call.system[0].text.length).toBeGreaterThan(50);
  });
});

describe('summarize — user message construction', () => {
  test('includes encounter exchange in user message', async () => {
    await summarize({ encounter_exchange: sampleExchange, resolution: sampleResolution });
    const userContent = mockCreate.mock.calls[0][0].messages[0].content;
    expect(userContent).toContain('Turn 1: We enter cautiously');
    expect(userContent).toContain('Turn 3: We grab the ledger and run');
  });

  test('includes resolution JSON in user message', async () => {
    await summarize({ encounter_exchange: sampleExchange, resolution: sampleResolution });
    const userContent = mockCreate.mock.calls[0][0].messages[0].content;
    expect(userContent).toContain('enc_001');
    expect(userContent).toContain('victory');
  });

  test('handles empty encounter_exchange gracefully', async () => {
    await expect(
      summarize({ encounter_exchange: '', resolution: sampleResolution })
    ).resolves.toBe(sampleSummary);
    const userContent = mockCreate.mock.calls[0][0].messages[0].content;
    expect(userContent).toContain('(no turns recorded)');
  });

  test('handles null encounter_exchange gracefully', async () => {
    await expect(
      summarize({ encounter_exchange: null, resolution: sampleResolution })
    ).resolves.toBe(sampleSummary);
    const userContent = mockCreate.mock.calls[0][0].messages[0].content;
    expect(userContent).toContain('(no turns recorded)');
  });
});

describe('summarize — retry behaviour', () => {
  test('retries on 429 and succeeds on second attempt', async () => {
    const rateLimitError = Object.assign(new Error('rate limited'), { status: 429 });
    mockCreate
      .mockRejectedValueOnce(rateLimitError)
      .mockResolvedValueOnce({ content: [{ text: sampleSummary }] });
    const result = await summarize({ encounter_exchange: sampleExchange, resolution: sampleResolution });
    expect(result).toBe(sampleSummary);
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });

  test('retries on 529 and succeeds on second attempt', async () => {
    const overloadedError = Object.assign(new Error('overloaded'), { status: 529 });
    mockCreate
      .mockRejectedValueOnce(overloadedError)
      .mockResolvedValueOnce({ content: [{ text: sampleSummary }] });
    const result = await summarize({ encounter_exchange: sampleExchange, resolution: sampleResolution });
    expect(result).toBe(sampleSummary);
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });

  test('throws immediately on non-retriable error', async () => {
    const badRequest = Object.assign(new Error('bad request'), { status: 400 });
    mockCreate.mockRejectedValue(badRequest);
    await expect(
      summarize({ encounter_exchange: sampleExchange, resolution: sampleResolution })
    ).rejects.toThrow('bad request');
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  test('throws after exhausting all retry attempts on persistent 429', async () => {
    const rateLimitError = Object.assign(new Error('rate limited'), { status: 429 });
    mockCreate.mockRejectedValue(rateLimitError);
    await expect(
      summarize({ encounter_exchange: sampleExchange, resolution: sampleResolution })
    ).rejects.toThrow('rate limited');
    expect(mockCreate).toHaveBeenCalledTimes(3);
  });
});
