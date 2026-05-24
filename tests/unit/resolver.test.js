import { jest, describe, test, expect, beforeAll, beforeEach } from '@jest/globals';

// ── fixtures ──────────────────────────────────────────────────────────────────

const validResult = {
  encounter_id: 'enc_002',
  turn: 3,
  revelation_triggers: [],
  resolution_triggered: null,
  object_state_changes: [],
  npc_attitude_changes: [],
  encounter_continues: true,
  requires_narrative_update: false,
  notes: 'No conditions met this turn.',
};

const baseParams = {
  input: 'I look around the tavern carefully',
  accumulated_inputs: ['We entered the tavern', 'I look around the tavern carefully'],
  revelation_conditions: [
    { id: 'tavern_ledger_found', condition: 'players search the tavern or bar area', triggered: false },
  ],
  resolution_conditions: {
    victory:  { condition: 'players escape with the ledger', triggered: false },
    failure:  { condition: 'tavern collapses', triggered: false },
    partial:  { condition: 'players escape without the ledger', triggered: false },
  },
  location_secrets: null,
  npc_attitudes: {},
  encounter_id: 'enc_002',
  turn: 3,
};

// ── mock Anthropic SDK ────────────────────────────────────────────────────────

const mockCreate = jest.fn();

jest.unstable_mockModule('@anthropic-ai/sdk', () => ({
  default: jest.fn().mockImplementation(() => ({
    messages: { create: mockCreate },
  })),
}));

// ── import resolver after mocks ───────────────────────────────────────────────

let evaluate;

beforeAll(async () => {
  const mod = await import('../../agents/resolver.js');
  evaluate = mod.evaluate;
});

beforeEach(() => {
  jest.clearAllMocks();
  mockCreate.mockResolvedValue({
    content: [{ text: JSON.stringify(validResult) }],
  });
});

// ── helpers ───────────────────────────────────────────────────────────────────

function apiReturns(obj) {
  mockCreate.mockResolvedValue({ content: [{ text: JSON.stringify(obj) }] });
}

function apiReturnsText(text) {
  mockCreate.mockResolvedValue({ content: [{ text }] });
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('evaluate — happy path', () => {
  test('returns parsed result when API returns valid JSON', async () => {
    const result = await evaluate(baseParams);
    expect(result).toEqual(validResult);
  });

  test('calls the Anthropic API exactly once per evaluate call', async () => {
    await evaluate(baseParams);
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  test('passes system prompt as first message with cache_control', async () => {
    await evaluate(baseParams);
    const call = mockCreate.mock.calls[0][0];
    expect(call.system[0].cache_control).toEqual({ type: 'ephemeral' });
    expect(call.system[0].type).toBe('text');
    expect(typeof call.system[0].text).toBe('string');
    expect(call.system[0].text.length).toBeGreaterThan(100);
  });

  test('user message contains encounter_id', async () => {
    await evaluate(baseParams);
    const userContent = mockCreate.mock.calls[0][0].messages[0].content;
    expect(userContent).toContain('enc_002');
  });

  test('user message contains current player input', async () => {
    await evaluate(baseParams);
    const userContent = mockCreate.mock.calls[0][0].messages[0].content;
    expect(userContent).toContain('I look around the tavern carefully');
  });

  test('user message contains revelation conditions as JSON', async () => {
    await evaluate(baseParams);
    const userContent = mockCreate.mock.calls[0][0].messages[0].content;
    expect(userContent).toContain('tavern_ledger_found');
  });

  test('strips markdown code fences from response', async () => {
    apiReturnsText('```json\n' + JSON.stringify(validResult) + '\n```');
    const result = await evaluate(baseParams);
    expect(result.encounter_id).toBe('enc_002');
  });

  test('strips plain ``` fences from response', async () => {
    apiReturnsText('```\n' + JSON.stringify(validResult) + '\n```');
    const result = await evaluate(baseParams);
    expect(result.encounter_id).toBe('enc_002');
  });
});

describe('evaluate — input handling', () => {
  test('accumulated_inputs defaults to [] when omitted', async () => {
    const { accumulated_inputs: _, ...paramsWithout } = baseParams;
    await expect(evaluate(paramsWithout)).resolves.toEqual(validResult);
  });

  test('npc_attitudes defaults to {} when omitted', async () => {
    const { npc_attitudes: _, ...paramsWithout } = baseParams;
    await expect(evaluate(paramsWithout)).resolves.toEqual(validResult);
  });

  test('location_secrets can be null', async () => {
    await expect(evaluate({ ...baseParams, location_secrets: null })).resolves.toEqual(validResult);
  });
});

describe('evaluate — JSON parsing', () => {
  test('throws descriptive error when API returns malformed JSON', async () => {
    apiReturnsText('this is not json at all');
    await expect(evaluate(baseParams)).rejects.toThrow('Resolver returned invalid JSON');
  });

  test('error message includes start of raw response', async () => {
    apiReturnsText('oops not json { broken');
    await expect(evaluate(baseParams)).rejects.toThrow('oops not json');
  });
});

describe('evaluate — field validation', () => {
  const requiredFields = [
    'encounter_id', 'turn', 'revelation_triggers', 'resolution_triggered',
    'object_state_changes', 'npc_attitude_changes', 'encounter_continues',
    'requires_narrative_update', 'notes',
  ];

  for (const field of requiredFields) {
    test(`throws when "${field}" is missing from response`, async () => {
      const { [field]: _, ...without } = validResult;
      apiReturns(without);
      await expect(evaluate(baseParams)).rejects.toThrow(`"${field}"`);
    });
  }

  test('throws when revelation_triggers is not an array', async () => {
    apiReturns({ ...validResult, revelation_triggers: 'bad' });
    await expect(evaluate(baseParams)).rejects.toThrow('revelation_triggers must be an array');
  });

  test('throws when object_state_changes is not an array', async () => {
    apiReturns({ ...validResult, object_state_changes: null });
    await expect(evaluate(baseParams)).rejects.toThrow('object_state_changes must be an array');
  });

  test('throws when npc_attitude_changes is not an array', async () => {
    apiReturns({ ...validResult, npc_attitude_changes: 42 });
    await expect(evaluate(baseParams)).rejects.toThrow('npc_attitude_changes must be an array');
  });
});

describe('evaluate — retry behaviour', () => {
  test('retries on 429 and succeeds on second attempt', async () => {
    const rateLimitError = Object.assign(new Error('rate limited'), { status: 429 });
    mockCreate
      .mockRejectedValueOnce(rateLimitError)
      .mockResolvedValueOnce({ content: [{ text: JSON.stringify(validResult) }] });

    const result = await evaluate(baseParams);
    expect(result).toEqual(validResult);
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });

  test('retries on 529 (overloaded) and succeeds on second attempt', async () => {
    const overloadedError = Object.assign(new Error('overloaded'), { status: 529 });
    mockCreate
      .mockRejectedValueOnce(overloadedError)
      .mockResolvedValueOnce({ content: [{ text: JSON.stringify(validResult) }] });

    const result = await evaluate(baseParams);
    expect(result).toEqual(validResult);
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });

  test('throws immediately on non-retriable error (e.g. 400)', async () => {
    const badRequestError = Object.assign(new Error('bad request'), { status: 400 });
    mockCreate.mockRejectedValue(badRequestError);
    await expect(evaluate(baseParams)).rejects.toThrow('bad request');
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  test('throws after exhausting all retry attempts on persistent 429', async () => {
    const rateLimitError = Object.assign(new Error('rate limited'), { status: 429 });
    mockCreate.mockRejectedValue(rateLimitError);
    await expect(evaluate(baseParams)).rejects.toThrow('rate limited');
    expect(mockCreate).toHaveBeenCalledTimes(3);
  });
});
