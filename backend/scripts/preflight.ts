import OpenAI from 'openai';
import { readConfig } from '../src/config.js';
import { createGitProvider } from '../src/integrations/git.js';

const config = readConfig();
if (!config.OPENAI_API_KEY) throw new Error('Set OPENAI_API_KEY in backend/.env');
const client = new OpenAI({ apiKey: config.OPENAI_API_KEY, timeout: 15000, maxRetries: 0 });
try {
  const model = await client.models.retrieve(config.OPENAI_MODEL);
  console.log(JSON.stringify({ openai: 'available', model: model.id }));
} catch (error) {
  console.log(
    JSON.stringify({ openai: 'unavailable', status: error instanceof OpenAI.APIError ? error.status : null }),
  );
  process.exitCode = 1;
}
const git = createGitProvider({ mode: 'real', token: config.GITHUB_TOKEN, timeoutMs: config.GIT_TIMEOUT_MS });
const repositoryUrl = 'https://github.com/openai/openai-node';
const repository = await git.inspect(repositoryUrl);
console.log(
  JSON.stringify({
    github: repository.status,
    tokenConfigured: !!config.GITHUB_TOKEN,
    sha: repository.snapshot?.commitSha,
    coverage: repository.snapshot?.coverage,
    materials: repository.snapshot?.files.length ?? 0,
  }),
);
if (repository.status !== 'verified' || !repository.snapshot?.files.length) process.exitCode = 1;
// Discover a public PR; this request remains on GitHub's fixed API host, never a user-supplied endpoint.
try {
  const res = await fetch('https://api.github.com/repos/openai/openai-node/pulls?state=closed&per_page=1', {
    redirect: 'error',
    signal: AbortSignal.timeout(config.GIT_TIMEOUT_MS),
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'AI-Sana-Preflight',
      ...(config.GITHUB_TOKEN ? { Authorization: `Bearer ${config.GITHUB_TOKEN}` } : {}),
    },
  });
  if (!res.ok) throw new Error('GitHub API unavailable');
  const prs: unknown = await res.json();
  const number = Array.isArray(prs) ? prs[0]?.number : undefined;
  if (!Number.isSafeInteger(number) || number < 1) throw new Error('No public PR');
  const pr = await git.inspect(`${repositoryUrl}/pull/${number}`);
  console.log(
    JSON.stringify({
      pullRequest: pr.url,
      status: pr.status,
      sha: pr.snapshot?.commitSha,
      coverage: pr.snapshot?.coverage,
      materials: pr.snapshot?.files.length ?? 0,
      warnings: pr.snapshot?.warnings,
    }),
  );
  if (pr.status !== 'verified' || !pr.snapshot?.files.some((file) => file.kind === 'patch'))
    process.exitCode = 1;
} catch {
  console.log(JSON.stringify({ pullRequest: 'unavailable; check connectivity or GitHub quota' }));
  process.exitCode = 1;
}
