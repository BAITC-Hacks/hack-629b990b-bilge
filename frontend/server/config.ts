// Настройки сервера из переменных окружения (.env в рабочей папке сервера; секреты не попадают в клиент и git).
import { existsSync } from 'node:fs';
import path from 'node:path';

if (existsSync('.env') && typeof process.loadEnvFile === 'function' && process.env.NODE_ENV !== 'test') process.loadEnvFile('.env');

const num = (v: string | undefined, d: number) => (v && Number.isFinite(Number(v)) ? Number(v) : d);

export const config = {
  port: num(process.env.PORT, 3001),
  host: process.env.HOST || '127.0.0.1',
  databasePath: path.resolve(process.env.DATABASE_PATH || './data/ai-sana.db'),
  allowedOrigins: (process.env.ALLOWED_ORIGINS || 'http://localhost:5173,http://127.0.0.1:5173').split(',').map((s) => s.trim()).filter(Boolean),
  sessionTtlMs: num(process.env.SESSION_TTL_HOURS, 24) * 3600e3,
  frontendDist: process.env.FRONTEND_DIST ? path.resolve(process.env.FRONTEND_DIST) : null,
  ai: {
    mode: (['auto', 'stub', 'openai'].includes(process.env.AI_MODE ?? '') ? process.env.AI_MODE : 'auto') as 'auto' | 'stub' | 'openai',
    model: process.env.OPENAI_MODEL || 'gpt-4.1-mini',
    timeoutMs: num(process.env.AI_TIMEOUT_MS, 30000),
    maxOutputTokens: num(process.env.AI_MAX_OUTPUT_TOKENS, 4096),
    /** Ключ читается только здесь и никогда не отдаётся клиенту. */
    hasKey: () => !!process.env.OPENAI_API_KEY,
  },
};
