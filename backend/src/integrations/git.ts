import { isIP } from 'node:net';
import { z } from 'zod';
import type { EvidenceResult, GitProvider } from '../contracts.js';
import { boundedTimeout, withDeadline } from './runtime.js';

export type GitProviderOptions = {
  mode?: 'real' | 'mock';
  token?: string;
  timeoutMs?: number;
  fetch?: typeof globalThis.fetch;
};

const PRELIMINARY =
  'Метаданные Git не подтверждают выполнение критериев. Нужна ручная проверка и подтверждение владельца бизнеса.';
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
  base: z.object({ repo: repositorySchema }),
  head: z.object({ sha: shaSchema }),
});
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
    try {
      return await withDeadline(this.timeout, async (signal) => {
        const base = `https://api.github.com/repos/${target.owner}/${target.repository}`;
        const read = async (endpoint: string): Promise<unknown> => {
          const result = await this.fetch(endpoint, { headers: this.headers, redirect: 'error', signal });
          if (!result.ok || result.redirected) throw new Error('GitHub unavailable');
          return result.json();
        };
        const repository = repositorySchema.parse(await read(base));
        const expectedName = `${target.owner}/${target.repository}`.toLowerCase();
        if (repository.full_name.toLowerCase() !== expectedName)
          throw new Error('Repository identity mismatch');
        const facts = [`Публичный репозиторий: ${repository.full_name}.`];
        if (repository.default_branch) facts.push(`Основная ветка: ${repository.default_branch}.`);
        let title = repository.full_name;
        if (target.kind === 'pull') {
          const pull = pullSchema.parse(await read(`${base}/pulls/${target.reference}`));
          if (
            String(pull.number) !== target.reference ||
            pull.base.repo.full_name.toLowerCase() !== expectedName
          )
            throw new Error('Pull request identity mismatch');
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
          title = `${repository.full_name} — ${target.reference}`;
          facts.push(`Ссылка на ветку, тег или коммит: ${target.reference}.`, `Коммит: ${commit.sha}.`);
        }
        return {
          provider: 'github',
          status: 'verified',
          url: target.url,
          title,
          summary: 'GitHub подтвердил публичную доступность и метаданные ссылки.',
          facts,
          warning: PRELIMINARY,
        };
      });
    } catch {
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
