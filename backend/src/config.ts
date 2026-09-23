import 'dotenv/config';
import { z } from 'zod';
const schema = z.object({
  PORT: z.coerce.number().int().min(0).max(65535).default(3001),
  HOST: z.string().default('127.0.0.1'),
  DATABASE_PATH: z.string().default('./data/ai-sana.db'),
  ALLOWED_ORIGINS: z.string().default('http://localhost:5173,http://127.0.0.1:5173'),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default('gpt-4o-mini'),
  AI_MODE: z.enum(['auto', 'openai', 'stub']).default('auto'),
  AI_TIMEOUT_MS: z.coerce.number().int().min(100).max(60000).default(15000),
  GIT_MODE: z.enum(['real', 'mock']).default('real'),
  GITHUB_TOKEN: z.string().optional(),
  SESSION_TTL_HOURS: z.coerce.number().min(0.01).max(168).default(24),
  FRONTEND_DIST: z.string().optional(),
});
export function readConfig() {
  return schema.parse(process.env);
}
