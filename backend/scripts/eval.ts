import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createAiProvider } from '../src/integrations/ai.js';
import { readConfig } from '../src/config.js';
import { emptyFields } from '../src/contracts.js';
import { evalCases } from './eval-cases.js';

const args = process.argv.slice(2);
const live = args.includes('--live');
const arg = (name: string, fallback: string) =>
  args.find((value) => value.startsWith(`${name}=`))?.slice(name.length + 1) ?? fallback;
const repetitions = Number(arg('--repeat', '1'));
if (!Number.isInteger(repetitions) || repetitions < 1 || repetitions > 3)
  throw new Error('--repeat must be 1–3');
const config = readConfig();
if (live && !config.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is required for --live');
const ai = createAiProvider({
  apiKey: config.OPENAI_API_KEY,
  model: config.OPENAI_MODEL,
  mode: live ? 'openai' : 'stub',
  timeoutMs: config.AI_TIMEOUT_MS,
  maxOutputTokens: config.AI_MAX_OUTPUT_TOKENS,
});
const results: {
  caseId: string;
  repetition: number;
  mode: string;
  passed: boolean;
  failures: string[];
  fields: string[];
  durationMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
  fallbackReason: string | null;
}[] = [];
// Bounded concurrency of two; all descriptions are synthetic and contain no user secrets.
const jobs = evalCases.flatMap((item) =>
  Array.from({ length: repetitions }, (_, index) => ({ item, repetition: index + 1 })),
);
async function worker() {
  for (;;) {
    const job = jobs.shift();
    if (!job) return;
    const { item, repetition } = job;
    const input = { rawDescription: item.description, fields: { ...emptyFields(), ...item.fields } };
    const result = await ai.analyze(input);
    const failures: string[] = [];
    if (live && result.mode !== 'openai') failures.push(`fallback:${result.run?.fallbackReason}`);
    for (const suggestion of result.suggestions) {
      if (suggestion.value !== suggestion.source.quote || !item.description.includes(suggestion.value))
        failures.push('ungrounded');
      if (input.fields[suggestion.field]) failures.push(`overwritten:${suggestion.field}`);
      if (item.forbidden.includes(suggestion.field)) failures.push(`prohibited:${suggestion.field}`);
    }
    if (live)
      for (const required of item.required) {
        const suggestion = result.suggestions.find((value) => value.field === required.field);
        if (!suggestion?.value.toLocaleLowerCase().includes(required.includes.toLocaleLowerCase()))
          failures.push(`missing:${required.field}`);
      }
    const entry = {
      caseId: item.id,
      repetition,
      mode: result.mode,
      passed: !failures.length,
      failures,
      fields: result.suggestions.map((s) => s.field),
      durationMs: result.run?.durationMs ?? 0,
      inputTokens: result.run?.inputTokens ?? null,
      outputTokens: result.run?.outputTokens ?? null,
      fallbackReason: result.run?.fallbackReason ?? null,
    };
    results.push(entry);
    console.log(
      `${item.id} #${repetition}: ${entry.passed ? 'PASS' : failures.join(', ')} (${result.mode}, ${entry.durationMs}ms)`,
    );
  }
}
await Promise.all([worker(), worker()]);
const times = results.map((r) => r.durationMs).sort((a, b) => a - b);
const report = {
  generatedAt: new Date().toISOString(),
  model: live ? config.OPENAI_MODEL : null,
  mode: live ? 'live' : 'stub-contract-only',
  scope:
    '15 synthetic extraction scenarios; exact quote grounding, expected fields, prohibited assumptions, preserving edits. Not a complete semantic or UX benchmark.',
  total: results.length,
  passed: results.filter((r) => r.passed).length,
  fallbacks: results.filter((r) => r.mode !== 'openai').length,
  p50Ms: times[Math.floor(times.length * 0.5)],
  p95Ms: times[Math.min(times.length - 1, Math.floor(times.length * 0.95))],
  inputTokens: results.reduce((sum, r) => sum + (r.inputTokens ?? 0), 0),
  outputTokens: results.reduce((sum, r) => sum + (r.outputTokens ?? 0), 0),
  results: results.sort((a, b) => a.caseId.localeCompare(b.caseId) || a.repetition - b.repetition),
};
const path = resolve(arg('--output', `../docs/evals/${live ? 'live' : 'stub'}-harness-report.json`));
mkdirSync(dirname(path), { recursive: true });
writeFileSync(path, JSON.stringify(report, null, 2) + '\n');
console.log(
  JSON.stringify({
    total: report.total,
    passed: report.passed,
    fallbacks: report.fallbacks,
    p95Ms: report.p95Ms,
    report: path,
  }),
);
if (report.passed !== report.total) process.exitCode = 1;
