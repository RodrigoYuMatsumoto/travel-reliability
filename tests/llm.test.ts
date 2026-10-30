import { afterEach, describe, expect, it, vi } from 'vitest';
import { LLMExtractor, validateSuggestions, policySnippets } from '../api/src/llm.js';
import { MemoryRecordStore } from '../api/src/storage.js';
import { Vault } from '../api/src/crypto.js';
import { loadConfig } from '../api/src/config.js';
import { extractText } from '../api/src/ingestion.js';
import type { EvidenceDocument } from '../schema/src/domain.js';
afterEach(() => vi.unstubAllGlobals());
const document = (): EvidenceDocument => ({
  id: '00000000-0000-4000-8000-000000000001',
  tripId: '00000000-0000-4000-8000-000000000002',
  mediaType: 'text/plain',
  bytes: 80,
  sha256: '0'.repeat(64),
  createdAt: '2030-01-01T00:00:00Z',
  expiresAt: null,
  label: 'Synthetic',
  fields: [],
  status: 'needs_review',
  warnings: [],
  parserVersion: '1.0.0',
  derivedFrom: null,
  preview: extractText(Buffer.from('Cancellation: synthetic refundable terms.')).snippets,
});
const config = () =>
  loadConfig({
    LLM_ENABLED: 'true',
    LLM_BASE_URL: 'https://example.invalid/v1',
    LLM_MODEL: 'synthetic-model',
    LLM_API_KEY: 'synthetic-key',
  });
describe('optional LLM boundary', () => {
  it('rejects invented facts, actions and unsupported fields', () => {
    const snippets = policySnippets(document());
    expect(() =>
      validateSuggestions(
        { fields: [{ path: 'baggage', value: 'free baggage', quote: 'invented' }] },
        snippets,
      ),
    ).toThrow('LLM_SOURCE_NOT_FOUND');
    expect(() => validateSuggestions({ fields: [], tools: ['shell'] }, snippets)).toThrow(
      'INVALID_LLM_OUTPUT',
    );
    expect(() =>
      validateSuggestions(
        {
          fields: [
            { path: 'reservation.confirmation', value: 'confirmed', quote: snippets[0]!.text },
          ],
        },
        snippets,
      ),
    ).toThrow('INVALID_LLM_FIELD');
  });
  it('cannot strip a negation from a policy snippet', () => {
    const snippets = [{ line: 1, text: 'Cancellation: non-refundable fare.' }];
    expect(() =>
      validateSuggestions(
        {
          fields: [{ path: 'cancellation.summary', value: 'refundable', quote: snippets[0]!.text }],
        },
        snippets,
      ),
    ).toThrow('LLM_SOURCE_NOT_FOUND');
    expect(() =>
      validateSuggestions(
        { fields: [{ path: 'cancellation.summary', value: 'refundable', quote: 'refundable' }] },
        snippets,
      ),
    ).toThrow('LLM_SOURCE_NOT_FOUND');
  });
  it('is disabled without explicit configuration', async () => {
    const vault = new Vault(Buffer.alloc(32, 4)),
      records = new MemoryRecordStore(vault);
    await expect(
      new LLMExtractor(loadConfig({}), records, vault).suggest('a', document()),
    ).rejects.toThrow('LLM_DISABLED');
  });
  it('caches literal suggestions and never exposes tools', async () => {
    const doc = document(),
      vault = new Vault(Buffer.alloc(32, 4)),
      records = new MemoryRecordStore(vault);
    await records.put('a', 'document', doc.id, doc, null);
    const fetch = vi.fn(async (_url: string, options: RequestInit) => {
      const payload = JSON.parse(String(options.body));
      expect(payload.tools).toBeUndefined();
      expect(payload.max_completion_tokens).toBe(1024);
      return Response.json({
        choices: [
          {
            message: {
              content: JSON.stringify({
                fields: [
                  {
                    path: 'cancellation.summary',
                    value: doc.preview![0]!.text,
                    quote: doc.preview![0]!.text,
                  },
                ],
              }),
            },
          },
        ],
        usage: { prompt_tokens: 100, completion_tokens: 40 },
      });
    });
    vi.stubGlobal('fetch', fetch);
    const engine = new LLMExtractor(config(), records, vault);
    const first = await engine.suggest('a', doc);
    const second = await engine.suggest('a', doc);
    expect(first.status).toBe('completed');
    expect(first.suggestions[0]!.state).toBe('extracted');
    expect(second.calls).toBe(1);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('bounds repairs and rejects provider tool calls', async () => {
    const doc = document(),
      vault = new Vault(Buffer.alloc(32, 4)),
      records = new MemoryRecordStore(vault);
    await records.put('a', 'document', doc.id, doc, null);
    const fetch = vi.fn(async () =>
      Response.json({
        choices: [{ message: { content: '{}', tool_calls: [{ function: { name: 'shell' } }] } }],
      }),
    );
    vi.stubGlobal('fetch', fetch);
    const result = await new LLMExtractor(config(), records, vault).suggest('a', doc);
    expect(result.status).toBe('needs_review');
    expect(result.errorCode).toBe('LLM_ACTION_OR_FORMAT_REJECTED');
    expect(result.calls).toBeLessThanOrEqual(2);
  });
  it('marks an interrupted run for review without another paid retry', async () => {
    const doc = document(),
      vault = new Vault(Buffer.alloc(32, 4)),
      records = new MemoryRecordStore(vault);
    await records.put('a', 'document', doc.id, doc, null);
    const fetch = vi.fn(async () =>
      Response.json({ choices: [{ message: { content: '{"fields":[]}' } }] }),
    );
    vi.stubGlobal('fetch', fetch);
    const engine = new LLMExtractor(config(), records, vault);
    await engine.suggest('a', doc);
    const run = (await records.list<import('../api/src/llm.js').LLMRun>('a', 'llm_run'))[0]!;
    await records.put(
      'a',
      'llm_run',
      run.id,
      { ...run.data, status: 'running', startedAt: '2000-01-01T00:00:00Z' },
      run.version,
    );
    expect((await engine.suggest('a', doc)).errorCode).toBe('LLM_INTERRUPTED');
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
