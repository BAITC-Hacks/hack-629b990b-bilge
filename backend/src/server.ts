import { createApp } from './app.js';
import { readConfig } from './config.js';
import { Store } from './db.js';
import { createAiProvider } from './integrations/ai.js';
import { createGitProvider } from './integrations/git.js';
import { seedWithAccounts } from './seed-cli.js';

const config = readConfig();
const store = new Store(config.DATABASE_PATH);
const seeded = seedWithAccounts(store);
const localOrigin = `http://${config.HOST}:${config.PORT}`;
const allowedOrigins = [
  ...new Set([
    ...config.ALLOWED_ORIGINS.split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    localOrigin,
    `http://localhost:${config.PORT}`,
    `http://127.0.0.1:${config.PORT}`,
  ]),
];
const runtime = createApp({
  store,
  allowedOrigins,
  sessionTtlHours: config.SESSION_TTL_HOURS,
  frontendDist: config.FRONTEND_DIST,
  ai: createAiProvider({
    apiKey: config.OPENAI_API_KEY,
    model: config.OPENAI_MODEL,
    mode: config.AI_MODE,
    timeoutMs: config.AI_TIMEOUT_MS,
  }),
  git: createGitProvider({ mode: config.GIT_MODE, token: config.GITHUB_TOKEN }),
});
runtime.httpServer.listen(config.PORT, config.HOST, () => {
  console.log(`AI Sana backend: ${localOrigin}/api/v1/health`);
  console.log(`Interactive API: ${localOrigin}/api/docs`);
  console.log(`Demo login codes: ${seeded.accountFile}`);
  console.log(
    `AI: ${config.AI_MODE === 'stub' || !config.OPENAI_API_KEY ? 'stub (local questions)' : `OpenAI / ${config.OPENAI_MODEL}`}; Git: ${config.GIT_MODE}`,
  );
});
let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  await runtime.close();
  store.close();
}
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
runtime.httpServer.on('error', (error) => {
  console.error(error.message);
  void shutdown().finally(() => {
    process.exitCode = 1;
  });
});
