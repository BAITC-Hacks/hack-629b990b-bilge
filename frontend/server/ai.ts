// Уточняющие вопросы ИИ (ТЗ 4.3) на сервере: вызов OpenAI с проверкой схемы и откатом на локальные вопросы.
// Ключ — только из переменной окружения OPENAI_API_KEY; AI_MODE=stub отключает вызовы модели.
// Вызов делается только когда бизнес нажимает «Уточнить с ИИ». Живой вызов с реальным ключом агентом не проверялся.
import type { Card, ClarifyResult } from '../src/shared/types';
import { AI_FIELDS } from '../src/shared/types';
import { PROMPT, stubQuestions, validateClarify } from '../src/shared/clarify';
import { config } from './config';

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['missingFields', 'questions'],
  properties: {
    missingFields: { type: 'array', items: { type: 'string', enum: [...AI_FIELDS] } },
    questions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['field', 'text'],
        properties: { field: { type: 'string', enum: [...AI_FIELDS] }, text: { type: 'string' } },
      },
    },
  },
};

export async function clarify(raw: string, card: Card, deps: { apiKey?: string; model?: string; fetchImpl?: typeof fetch; mode?: 'auto' | 'stub' | 'openai' } = {}): Promise<ClarifyResult> {
  const input = { rawDescription: raw, knownFields: card };
  const trace: ClarifyResult['trace'] = { prompt: PROMPT, input, attempts: [], fallbackReason: null };
  const mode = deps.mode ?? config.ai.mode;
  const key = deps.apiKey ?? process.env.OPENAI_API_KEY;
  if (mode === 'stub') {
    trace.fallbackReason = 'AI_MODE=stub — используется локальный набор вопросов';
    return { mode: 'stub', ...stubQuestions(raw, card), trace };
  }
  if (!key) {
    trace.fallbackReason = 'Ключ OpenAI не задан на сервере — используется локальный набор вопросов';
    return { mode: 'stub', ...stubQuestions(raw, card), trace };
  }
  const f = deps.fetchImpl ?? fetch;
  const model = deps.model ?? config.ai.model;
  for (let attempt = 1; attempt <= 2; attempt++) {
    let out = '';
    try {
      const res = await f('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(config.ai.timeoutMs),
        body: JSON.stringify({
          model,
          max_completion_tokens: config.ai.maxOutputTokens,
          response_format: { type: 'json_schema', json_schema: { name: 'clarify', strict: true, schema: SCHEMA } },
          messages: [{ role: 'system', content: PROMPT }, { role: 'user', content: JSON.stringify(input) }],
        }),
      });
      out = await res.text();
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${safeError(out)}`);
      const content = JSON.parse(out)?.choices?.[0]?.message?.content;
      if (typeof content !== 'string') throw new Error('пустой ответ модели');
      out = content;
      const parsed = validateClarify(JSON.parse(content));
      trace.attempts.push({ raw: out.slice(0, 4000), error: null });
      return { mode: 'openai', ...parsed, trace };
    } catch (e) {
      trace.attempts.push({ raw: out.slice(0, 1000), error: (e as Error).message });
    }
  }
  trace.fallbackReason = `Модель ${model} не дала корректного ответа за 2 попытки — используется локальный набор вопросов`;
  return { mode: 'stub', ...stubQuestions(raw, card), trace };
}

/** Сообщение об ошибке провайдера без лишних подробностей (ключ в ответах OpenAI не возвращается, но режем на всякий случай). */
function safeError(body: string): string {
  try { return String(JSON.parse(body)?.error?.message ?? '').replace(/sk-[A-Za-z0-9_-]+/g, 'sk-***').slice(0, 200); } catch { return ''; }
}
