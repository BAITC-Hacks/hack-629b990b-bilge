import { randomUUID } from 'node:crypto';
import OpenAI from 'openai';
import { zodTextFormat } from 'openai/helpers/zod';
import { z } from 'zod';
import type { AiOperation, AiRun } from '../contracts.js';
import { boundedTimeout, withDeadline } from './runtime.js';

export type AiProviderOptions = {
  apiKey?: string;
  model?: string;
  mode?: 'auto' | 'openai' | 'stub';
  timeoutMs?: number;
  maxOutputTokens?: number;
  fetch?: typeof globalThis.fetch;
};
export const PROMPT_VERSIONS: Record<AiOperation, string> = {
  analyze: 'extract-quotes-v1',
  clarify: 'neutral-questions-v2',
  review_evidence: 'cited-materials-v2',
};
export function newRun(operation: AiOperation, model: string | null): AiRun {
  return {
    id: randomUUID(),
    operation,
    model,
    promptVersion: PROMPT_VERSIONS[operation],
    startedAt: new Date().toISOString(),
    durationMs: 0,
    mode: 'openai',
    outcome: 'completed',
    fallbackReason: null,
    inputTokens: null,
    outputTokens: null,
    validation: 'not_run',
  };
}
export function stubRun(operation: AiOperation, reason: AiRun['fallbackReason'] = 'disabled'): AiRun {
  return { ...newRun(operation, null), mode: 'stub', outcome: 'fallback', fallbackReason: reason };
}
function failureReason(error: unknown): NonNullable<AiRun['fallbackReason']> {
  if (error instanceof Error && /timeout|timed out|abort/i.test(error.message)) return 'timeout';
  if (error instanceof OpenAI.APIError) return error.status === 429 ? 'rate_limit' : 'provider_error';
  if (error instanceof OpenAI.APIConnectionError) return 'provider_error';
  return 'invalid_output';
}

/** One runtime per provider, all request metadata is local to the call (safe for concurrency). */
export class AiRuntime {
  private readonly client: OpenAI;
  private readonly timeout: number;
  readonly model: string;
  private readonly maxOutputTokens: number;
  constructor(options: AiProviderOptions & { apiKey: string }) {
    this.model = options.model?.trim() || 'gpt-6-luna';
    this.timeout = boundedTimeout(options.timeoutMs, 30_000);
    this.maxOutputTokens = Math.max(1024, Math.min(8192, options.maxOutputTokens ?? 4096));
    this.client = new OpenAI({
      apiKey: options.apiKey,
      fetch: options.fetch,
      timeout: this.timeout,
      maxRetries: 0,
    });
  }
  async execute<T>(
    operation: AiOperation,
    work: (
      parse: <R>(schema: z.ZodType<R>, name: string, instructions: string, input: unknown) => Promise<R>,
    ) => Promise<T>,
    fallback: () => Promise<T>,
  ): Promise<T & { run: AiRun }> {
    const run = newRun(operation, this.model);
    const started = performance.now();
    const parse = async <R>(
      schema: z.ZodType<R>,
      name: string,
      instructions: string,
      input: unknown,
    ): Promise<R> => {
      const response = await withDeadline(this.timeout, (signal) =>
        this.client.responses.parse(
          {
            model: this.model,
            instructions,
            input: [{ role: 'user', content: JSON.stringify(input) }],
            text: { format: zodTextFormat(schema, name) },
            ...(this.model.startsWith('gpt-6') || this.model.startsWith('gpt-5')
              ? { reasoning: { effort: 'low' as const } }
              : {}),
            store: false,
            max_output_tokens: this.maxOutputTokens,
          },
          { signal },
        ),
      );
      run.inputTokens = response.usage?.input_tokens ?? null;
      run.outputTokens = response.usage?.output_tokens ?? null;
      if (response.status !== 'completed') throw new Error('Incomplete AI response');
      return schema.parse(response.output_parsed);
    };
    try {
      const result = await work(parse);
      run.validation = 'passed';
      return { ...result, run };
    } catch (error) {
      run.mode = 'stub';
      run.outcome = 'fallback';
      run.fallbackReason = failureReason(error);
      run.validation = run.fallbackReason === 'invalid_output' ? 'failed' : 'not_run';
      return { ...(await fallback()), run };
    } finally {
      run.durationMs = Math.round(performance.now() - started);
    }
  }
}
