import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import { z } from 'zod';
import type { EvidenceResult, GitMaterial, GitProvider, GitSnapshot } from '../contracts.js';
import { boundedTimeout, withDeadline } from './runtime.js';

export type GitProviderOptions = {
  mode?: 'real' | 'mock';
  token?: string;
  timeoutMs?: number;
  fetch?: typeof globalThis.fetch;
};

const PRELIMINARY =
  'Метаданные Git не подтверждают выполнение критериев. Нужна ручная проверка и подтверждение владельца бизнеса.';
const MAX_FILES = 8;
const MAX_FILE_CHARACTERS = 6_000;
const MAX_TOTAL_CHARACTERS = 24_000;
const MAX_RESPONSE_BYTES = 256 * 1024;
const SCOPE =
  'Выборка ограничена README и первой страницей patch PR: до 8 материалов, 6 000 символов на материал и 24 000 всего. complete относится только к этой выборке; это не аудит репозитория и не проверка работающего кода.';
const repositorySchema = z.object({
  full_name: z.string().min(3).max(200),
  private: z.literal(false),
  visibility: z.literal('public'),
  default_branch: z.string().min(1).max(300).optional(),
});
const shaSchema = z.string().regex(/^[a-f0-9]{40,64}$/i);
const pullSchema = z.object({
  number: z.number().int().positive(),
  title: z.string().min(1).max(1000),
  state: z.enum(['open', 'closed']),
  merged: z.boolean(),
  changed_files: z.number().int().nonnegative(),
  additions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
  base: z.object({ repo: repositorySchema, sha: shaSchema }),
  head: z.object({ sha: shaSchema }),
});
const pathSchema = z
  .string()
  .min(1)
  .max(1_024)
  .refine(
    (path) =>
      !/[\x00-\x1f\x7f\\]/.test(path) &&
      !path.split('/').some((part) => !part || part === '.' || part === '..'),
  );
const readmeSchema = z.object({
  type: z.literal('file'),
  path: pathSchema,
  encoding: z.literal('base64'),
  size: z.number().int().nonnegative().max(MAX_RESPONSE_BYTES),
  content: z.string(),
});
const patchSchema = z.object({
  filename: pathSchema,
  status: z.enum(['added', 'removed', 'modified', 'renamed', 'copied', 'changed', 'unchanged']),
  patch: z.string().optional(),
  additions: z.number().int().nonnegative().optional(),
  deletions: z.number().int().nonnegative().optional(),
});

/** Bound decompressed bytes too; Content-Length alone does not bound streamed bodies. */
async function readJson(response: Response, signal: AbortSignal): Promise<unknown> {
  if (signal.aborted) {
    void response.body?.cancel().catch(() => {});
    signal.throwIfAborted();
  }
  if (Number(response.headers.get('content-length')) > MAX_RESPONSE_BYTES) {
    void response.body?.cancel().catch(() => {});
    throw new Error('GitHub response too large');
  }
  if (!response.body) throw new Error('GitHub response has no body');
  const reader = response.body.getReader();
  const cancel = () => {
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener('abort', cancel, { once: true });
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    signal.throwIfAborted();
    while (true) {
      const { value, done } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) throw new Error('GitHub response too large');
      chunks.push(value);
    }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, size)));
  } catch (error) {
    if (!signal.aborted) cancel();
    throw error;
  } finally {
    signal.removeEventListener('abort', cancel);
    reader.releaseLock();
  }
}

function sourceUrl(target: GitTarget, sha: string, path: string): string {
  return `https://github.com/${target.owner}/${target.repository}/blob/${sha}/${path.split('/').map(encodeURIComponent).join('/')}`;
}

function decodeReadme(value: unknown): { path: string; content: string } {
  const readme = readmeSchema.parse(value);
  const encoded = readme.content.replace(/[\r\n]/g, '');
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded))
    throw new Error('Invalid README encoding');
  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.length !== readme.size || bytes.toString('base64') !== encoded)
    throw new Error('Incomplete README');
  return { path: readme.path, content: new TextDecoder('utf-8', { fatal: true }).decode(bytes) };
}
type GitTarget = {
  url: string;
  owner: string;
  repository: string;
  kind: 'repository' | 'pull' | 'tree';
  reference?: string;
};

function publicUrl(input: string): URL | null {
  try {
    if (input.length > 2000) return null;
    const url = new URL(input);
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.port ||
      isIP(url.hostname.replace(/^\[|\]$/g, '')) ||
      !url.hostname.includes('.') ||
      /\.(localhost|local|internal|test|invalid)$/i.test(url.hostname)
    )
      return null;
    url.search = '';
    url.hash = '';
    return url;
  } catch {
    return null;
  }
}

function githubTarget(url: URL): GitTarget | null {
  const parts = url.pathname.replace(/\/$/, '').slice(1).split('/');
  const [owner, rawRepo, route, ...rest] = parts;
  const repository = rawRepo?.replace(/\.git$/, '');
  if (
    !owner ||
    !/^[a-z0-9][a-z0-9-]{0,38}$/i.test(owner) ||
    !repository ||
    !/^[a-z0-9_.-]{1,100}$/i.test(repository) ||
    /^\.{1,2}$/.test(repository)
  )
    return null;
  const base = { owner, repository, url: `https://github.com/${owner}/${repository}` };
  if (parts.length === 2) return { ...base, kind: 'repository' };
  if (route === 'pull' && rest.length === 1 && /^[1-9]\d{0,9}$/.test(rest[0] ?? '')) {
    return { ...base, kind: 'pull', reference: rest[0], url: `${base.url}/pull/${rest[0]}` };
  }
  if (route === 'tree' && rest.length > 0) {
    try {
      const reference = decodeURIComponent(rest.join('/'));
      if (
        !reference ||
        reference.length > 300 ||
        /[\s\x00-\x1f\x7f?#\\]/.test(reference) ||
        reference.split('/').some((part) => !part || part === '.' || part === '..')
      )
        return null;
      return {
        ...base,
        kind: 'tree',
        reference,
        url: `${base.url}/tree/${reference.split('/').map(encodeURIComponent).join('/')}`,
      };
    } catch {
      return null;
    }
  }
  return null;
}

function unavailable(url: string, provider: 'github' | 'manual', warning: string): EvidenceResult {
  return {
    provider,
    status: 'unavailable',
    url,
    title: 'Ссылка на результат',
    summary: 'Доказательства не проверены. Результат можно проверить вручную.',
    facts: [],
    warning,
  };
}

class RealGitProvider implements GitProvider {
  private readonly fetch: typeof globalThis.fetch;
  private readonly timeout: number;
  private readonly headers: Record<string, string>;

  constructor(options: GitProviderOptions) {
    this.fetch = options.fetch ?? globalThis.fetch;
    this.timeout = boundedTimeout(options.timeoutMs, 8_000);
    this.headers = {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'AI-Sana-Evidence',
    };
    if (options.token?.trim()) this.headers.Authorization = `Bearer ${options.token.trim()}`;
  }

  async inspect(input: string): Promise<EvidenceResult> {
    const url = publicUrl(input);
    if (!url)
      return unavailable(
        '',
        'manual',
        'Укажите публичную HTTPS-ссылку без логина, пароля и нестандартного порта.',
      );
    if (url.hostname !== 'github.com')
      return {
        provider: 'manual',
        status: 'manual',
        url: url.toString(),
        title: 'Ссылка для ручной проверки',
        facts: [],
        summary: 'Автоматическая проверка этого Git-хоста не поддерживается.',
        warning: PRELIMINARY,
      };
    const target = githubTarget(url);
    if (!target)
      return unavailable(
        url.toString(),
        'github',
        'Поддерживаются ссылки GitHub на репозиторий, pull request или tree/ref.',
      );
    const progress: { evidence: EvidenceResult | null } = { evidence: null };
    try {
      return await withDeadline(this.timeout, async (signal) => {
        const base = `https://api.github.com/repos/${target.owner}/${target.repository}`;
        const read = async (endpoint: string): Promise<unknown> => {
          signal.throwIfAborted();
          // Constructed endpoints only: never fetch download_url, blob_url or pagination links.
          if (!endpoint.startsWith(`${base}/`) && endpoint !== base) throw new Error('Unexpected endpoint');
          const result = await this.fetch(endpoint, { headers: this.headers, redirect: 'error', signal });
          if (!result.ok || result.redirected) {
            void result.body?.cancel().catch(() => {});
            throw new Error('GitHub unavailable');
          }
          return readJson(result, signal);
        };
        const repository = repositorySchema.parse(await read(base));
        const expectedName = `${target.owner}/${target.repository}`.toLowerCase();
        if (repository.full_name.toLowerCase() !== expectedName)
          throw new Error('Repository identity mismatch');
        const facts = [`Публичный репозиторий: ${repository.full_name}.`];
        if (repository.default_branch) facts.push(`Основная ветка: ${repository.default_branch}.`);
        let title = repository.full_name;
        let pull: z.infer<typeof pullSchema> | undefined;
        let commitSha: string | undefined;
        const validatePull = (value: unknown) => {
          const result = pullSchema.parse(value);
          if (
            String(result.number) !== target.reference ||
            result.base.repo.full_name.toLowerCase() !== expectedName
          )
            throw new Error('Pull request identity mismatch');
          return result;
        };
        if (target.kind === 'pull') {
          pull = validatePull(await read(`${base}/pulls/${target.reference}`));
          commitSha = pull.head.sha;
          title = `PR #${pull.number}: ${pull.title}`;
          facts.push(
            `PR #${pull.number}: ${pull.state === 'open' ? 'открыт' : 'закрыт'}, ${pull.merged ? 'влит' : 'не влит'}.`,
            `Изменено файлов: ${pull.changed_files}.`,
            `Добавлено строк: ${pull.additions}; удалено строк: ${pull.deletions}.`,
            `Коммит PR: ${pull.head.sha}.`,
          );
        } else if (target.kind === 'tree') {
          const commit = z
            .object({ sha: shaSchema })
            .parse(await read(`${base}/commits/${encodeURIComponent(target.reference!)}`));
          commitSha = commit.sha;
          title = `${repository.full_name} — ${target.reference}`;
          facts.push(`Ссылка на ветку, тег или коммит: ${target.reference}.`, `Коммит: ${commit.sha}.`);
        }
        const evidence: EvidenceResult = {
          provider: 'github',
          status: 'verified',
          url: target.url,
          title,
          summary: 'GitHub подтвердил публичную доступность и метаданные ссылки.',
          facts,
          warning: PRELIMINARY,
          snapshot: null,
        };
        // Only retain metadata after validating the requested target (not merely its repository).
        progress.evidence = evidence;
        if (!commitSha) {
          try {
            if (!repository.default_branch) throw new Error('Missing default branch');
            commitSha = z
              .object({ sha: shaSchema })
              .parse(await read(`${base}/commits/${encodeURIComponent(repository.default_branch)}`)).sha;
            facts.push(`Коммит: ${commitSha}.`);
          } catch {
            evidence.warning = `Не удалось зафиксировать коммит; материалы не получены. ${PRELIMINARY}`;
            return evidence;
          }
        }
        const snapshot: GitSnapshot = {
          commitSha,
          inspectedAt: new Date().toISOString(),
          coverage: 'metadata_only',
          files: [],
          warnings: [SCOPE],
        };
        evidence.snapshot = snapshot;
        const files: GitMaterial[] = [];
        const warnings: string[] = [];
        let partial = target.kind !== 'pull';
        let remaining = MAX_TOTAL_CHARACTERS;
        const addMaterial = (
          kind: GitMaterial['kind'],
          path: string,
          content: string,
          incomplete = false,
        ) => {
          if (!content.trim()) {
            partial = true;
            warnings.push(`Материал ${path} пуст; свидетельства из него не получены.`);
            return;
          }
          if (files.length >= MAX_FILES || remaining <= 0) {
            partial = true;
            warnings.push('Остальные материалы не включены из-за лимита выборки.');
            return;
          }
          let selected = content.slice(0, Math.min(MAX_FILE_CHARACTERS, remaining));
          // Avoid splitting a UTF-16 surrogate pair at the character limit.
          if (/[\uD800-\uDBFF]$/.test(selected)) selected = selected.slice(0, -1);
          const truncated = incomplete || selected.length < content.length;
          if (truncated) {
            partial = true;
            warnings.push(`Материал ${path} усечён по лимиту или содержит неполный patch GitHub.`);
          }
          files.push({
            id: createHash('sha256').update(`${commitSha}:${kind}:${path}`).digest('hex').slice(0, 24),
            path,
            kind,
            // A patch can quote removed lines, which do not exist in the head blob.
            // The pinned comparison contains both sides, including deleted/renamed files.
            sourceUrl:
              kind === 'patch' && pull
                ? `https://github.com/${target.owner}/${target.repository}/compare/${pull.base.sha}...${commitSha}`
                : sourceUrl(target, commitSha!, path),
            content: selected,
            truncated,
          });
          remaining -= selected.length;
        };
        try {
          const readme = decodeReadme(await read(`${base}/readme?ref=${commitSha}`));
          addMaterial('readme', readme.path, readme.content);
        } catch {
          partial = true;
          warnings.push(
            'README отсутствует, недоступен или превышает лимит ответа; его содержимое не проверено.',
          );
        }
        if (pull) {
          try {
            const entries = z
              .array(z.unknown())
              .parse(await read(`${base}/pulls/${target.reference}/files?per_page=${MAX_FILES}&page=1`));
            if (
              entries.length !== Math.min(pull.changed_files, MAX_FILES) ||
              pull.changed_files > MAX_FILES
            ) {
              partial = true;
              warnings.push('Получена только ограниченная часть изменённых файлов PR.');
            }
            const paths = new Set<string>();
            for (const entry of entries.slice(0, MAX_FILES)) {
              const parsed = patchSchema.safeParse(entry);
              if (!parsed.success || !parsed.data.patch || paths.has(parsed.data.filename)) {
                partial = true;
                warnings.push(
                  'Один из patch отсутствует или не прошёл проверку; бинарные файлы не анализируются.',
                );
                continue;
              }
              paths.add(parsed.data.filename);
              const lines = parsed.data.patch.split('\n');
              const additions = lines.filter((line) => line.startsWith('+')).length;
              const deletions = lines.filter((line) => line.startsWith('-')).length;
              const incomplete =
                (parsed.data.additions !== undefined && additions !== parsed.data.additions) ||
                (parsed.data.deletions !== undefined && deletions !== parsed.data.deletions);
              addMaterial('patch', parsed.data.filename, parsed.data.patch, incomplete);
            }
          } catch {
            partial = true;
            warnings.push('Patch PR недоступны или превышают лимит ответа.');
          }
          try {
            const current = validatePull(await read(`${base}/pulls/${target.reference}`));
            if (
              current.head.sha !== pull.head.sha ||
              current.base.sha !== pull.base.sha ||
              current.changed_files !== pull.changed_files
            ) {
              snapshot.warnings.push(
                'PR изменился во время получения материалов; все материалы отброшены. Метаданные отражают первоначальный запрос; повторите проверку.',
              );
              return evidence;
            }
          } catch {
            snapshot.warnings.push(
              'Не удалось подтвердить неизменность PR; все материалы отброшены. Повторите проверку.',
            );
            return evidence;
          }
        } else {
          warnings.push(
            'Проверена только доступная README на указанном коммите; исходный код репозитория не исследован.',
          );
        }
        signal.throwIfAborted();
        snapshot.files = files;
        snapshot.coverage = files.length === 0 ? 'metadata_only' : partial ? 'partial' : 'complete';
        snapshot.warnings.push(...new Set(warnings));
        return evidence;
      });
    } catch {
      if (progress.evidence) {
        // The deadline may expire during a material read after public metadata was validated.
        const evidence = progress.evidence;
        return {
          ...evidence,
          warning: `Материалы не получены полностью: превышено время ожидания или GitHub недоступен. ${PRELIMINARY}`,
          snapshot: evidence.snapshot
            ? {
                ...evidence.snapshot,
                coverage: 'metadata_only',
                files: [],
                warnings: [
                  ...evidence.snapshot.warnings,
                  'Получение материалов не завершено; повторите проверку.',
                ],
              }
            : null,
        };
      }
      return unavailable(
        target.url,
        'github',
        `GitHub не подтвердил публичные метаданные: ссылка недоступна, приватная или превышено время ожидания. ${PRELIMINARY}`,
      );
    }
  }
}

class MockGitProvider implements GitProvider {
  async inspect(input: string): Promise<EvidenceResult> {
    return {
      provider: 'mock',
      status: 'mock',
      url: publicUrl(input)?.toString() ?? '',
      title: 'Демонстрационные доказательства',
      summary: 'Имитация проверки: запрос к Git-хосту не выполнялся.',
      facts: [],
      warning: `Демонстрационный режим: внешние данные не проверены. ${PRELIMINARY}`,
    };
  }
}

export function createGitProvider(options: GitProviderOptions = {}): GitProvider {
  return options.mode === 'mock' ? new MockGitProvider() : new RealGitProvider(options);
}
