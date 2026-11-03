import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { plan } from '../api/src/planning.js';
import { catalog } from '../agent/catalog.js';
import { prepareWorkflow } from '../agent/workflow.js';
import { toolIds } from '../schema/src/planning.js';

/** Descriptive nearest-rank statistic, not a confidence interval or tail guarantee. */
export function nearestRankPercentile(values: readonly number[], quantile: number): number {
  if (
    !values.length ||
    values.length > 1000 ||
    !Number.isFinite(quantile) ||
    quantile < 0 ||
    quantile > 1 ||
    values.some((value) => !Number.isFinite(value) || value < 0)
  )
    throw new Error('BENCHMARK_SAMPLE_REJECTED');
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(quantile * sorted.length) - 1)]!;
}

/** Synthetic execution benchmark; UTF-8 payload bytes are not a token measurement. */
export function benchmarkDocumentary(repetitions = 25) {
  if (!Number.isInteger(repetitions) || repetitions < 1 || repetitions > 1000)
    throw new Error('BENCHMARK_REPETITIONS_REJECTED');
  const prompts = catalog.commands.map((command) => ({
    id: command.id,
    bytes: Buffer.byteLength(readFileSync(new URL('../' + command.path, import.meta.url))),
  }));
  const fullPromptBytes = prompts.reduce((sum, item) => sum + item.bytes, 0);
  const results = toolIds.map((tool) => {
    const input = JSON.parse(
      readFileSync(new URL('../examples/' + tool + '.json', import.meta.url), 'utf8'),
    );
    const command = catalog.commands.find((item) => item.calculatorId === tool)!;
    const suppliedFields = command.requiredInputs.map((field) => field.id);
    const prepared = prepareWorkflow({
      tripKey: 'synthetic-benchmark',
      workflowId: command.id,
      language: 'pt-BR',
      suppliedFields,
      capabilities: [],
      budget: { maxToolCalls: 1, maxRetries: 0, maxDelegations: 0 },
    });
    const durations: number[] = [];
    for (let count = 0; count < repetitions; count++) {
      const started = performance.now();
      const output = plan(tool, input);
      if (output.mode !== 'documentary' || output.externalCalls !== 0)
        throw new Error('BENCHMARK_EXTERNAL_EFFECT');
      durations.push(performance.now() - started);
    }
    let rejectsMissingInput = false;
    try {
      plan(tool, {});
    } catch {
      rejectsMissingInput = true;
    }
    if (!rejectsMissingInput) throw new Error('BENCHMARK_INVALID_INPUT_ACCEPTED');
    return {
      calculator: tool,
      executions: repetitions,
      invalidInputRejected: rejectsMissingInput,
      selectedPromptBytes: prompts.find((item) => item.id === command.id)!.bytes,
      workflowPreparationBytes: Buffer.byteLength(JSON.stringify(prepared)),
      p50Ms: nearestRankPercentile(durations, 0.5),
      p95Ms: nearestRankPercentile(durations, 0.95),
      modelCalls: 0,
      networkCalls: 0,
    };
  });
  return {
    format: 'travel-reliability-documentary-benchmark/1',
    dataset: 'repository synthetic examples; no real travelers or user pilot',
    softwareVersion: catalog.version,
    executions: repetitions * toolIds.length,
    fullPromptBytes,
    calculators: results,
    measurements: { payloadUnit: 'UTF-8 bytes', tokenizer: null, tokenSavingsClaimed: false },
    latencyMethod: {
      percentile: 'nearest-rank',
      samplesPerCalculator: repetitions,
      scope: 'plan(tool, input) only; input loading and workflow preparation excluded',
      confidenceInterval: null,
    },
    limits: [
      'Payload bytes do not measure tokens, factual correctness, human adoption or model quality.',
      'Latency is local execution time; it is not a provider or production service benchmark.',
      'No real traveler, supplier account or model inference is used.',
      'Small per-calculator samples give descriptive percentiles only, not production p95 or statistical confidence.',
      'Selected workflow bytes exclude hub/role/schema, host context and output overhead; no total-token reduction is claimed.',
    ],
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  process.stdout.write(JSON.stringify(benchmarkDocumentary(), null, 2) + '\n');
}
