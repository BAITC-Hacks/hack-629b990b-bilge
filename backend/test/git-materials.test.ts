import { describe, expect, it, vi } from 'vitest';
import { createGitProvider } from '../src/integrations/git.js';

const sha = 'a'.repeat(40);
const baseSha = 'b'.repeat(40);
const base = 'https://api.github.com/repos/team/cafe';
const repository = { full_name: 'team/cafe', private: false, visibility: 'public', default_branch: 'main' };
const pull = {
  number: 7,
  title: 'Checkout',
  state: 'open',
  merged: false,
  changed_files: 1,
  additions: 1,
  deletions: 0,
  base: { repo: repository, sha: baseSha },
  head: { sha },
};
const patch = { filename: 'src/cart.ts', status: 'added', patch: '@@ -0,0 +1 @@\n+export const cart = [];' };
function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
}
function readme(content = '# Cafe\nCheckout demo', path = 'README.md') {
  return {
    type: 'file',
    path,
    encoding: 'base64',
    size: Buffer.byteLength(content),
    content: Buffer.from(content).toString('base64'),
  };
}
function github(overrides: Record<string, () => Response | Promise<Response>> = {}) {
  return vi.fn<typeof globalThis.fetch>(async (url) => {
    const endpoint = String(url);
    if (overrides[endpoint]) return overrides[endpoint]();
    if (endpoint === base) return json(repository);
    if (endpoint === `${base}/commits/main` || endpoint === `${base}/commits/feature%2Fcheckout`)
      return json({ sha });
    if (endpoint === `${base}/readme?ref=${sha}`) return json(readme());
    if (endpoint === `${base}/pulls/7`) return json(pull);
    if (endpoint === `${base}/pulls/7/files?per_page=8&page=1`) return json([patch]);
    throw new Error(`Unexpected endpoint: ${endpoint}`);
  });
}

describe('bounded GitHub materials', () => {
  it.each(['', '/tree/feature/checkout'])(
    'pins README and source links to the resolved commit for %s',
    async (suffix) => {
      const fetch = github();
      const result = await createGitProvider({ fetch }).inspect(`https://github.com/team/cafe${suffix}`);
      expect(result.status).toBe('verified');
      expect(result.snapshot).toMatchObject({
        commitSha: sha,
        coverage: 'partial',
        files: [
          {
            id: expect.any(String),
            path: 'README.md',
            kind: 'readme',
            content: '# Cafe\nCheckout demo',
            sourceUrl: `https://github.com/team/cafe/blob/${sha}/README.md`,
            truncated: false,
          },
        ],
      });
      expect(Number.isNaN(Date.parse(result.snapshot!.inspectedAt))).toBe(false);
      expect(result.snapshot?.warnings.join(' ')).toMatch(/аудит/i);
      expect(fetch.mock.calls.map(([url]) => url)).toContain(`${base}/readme?ref=${sha}`);
      expect(fetch.mock.calls.map(([url]) => url)).not.toContain(`${base}/readme?ref=main`);
    },
  );

  it('retains metadata and SHA when README is absent or rate limited', async () => {
    for (const status of [404, 403, 429]) {
      const fetch = github({ [`${base}/readme?ref=${sha}`]: () => json({}, status) });
      const result = await createGitProvider({ fetch }).inspect('https://github.com/team/cafe');
      expect(result).toMatchObject({
        status: 'verified',
        snapshot: { commitSha: sha, coverage: 'metadata_only', files: [] },
      });
      expect(result.snapshot?.warnings.join(' ')).toMatch(/README/);
    }
  });

  it('retains repository metadata without inventing a SHA when the default ref cannot be resolved', async () => {
    const fetch = github({ [`${base}/commits/main`]: () => json({}, 409) });
    const result = await createGitProvider({ fetch }).inspect('https://github.com/team/cafe');
    expect(result).toMatchObject({ status: 'verified', snapshot: null });
    expect(result.warning).toMatch(/коммит/i);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('bounds README content and marks the snapshot partial', async () => {
    const fetch = github({ [`${base}/readme?ref=${sha}`]: () => json(readme('x'.repeat(8_000))) });
    const result = await createGitProvider({ fetch }).inspect('https://github.com/team/cafe');
    expect(result.snapshot?.coverage).toBe('partial');
    expect(result.snapshot?.files[0]).toMatchObject({ content: 'x'.repeat(6_000), truncated: true });
  });

  it('retrieves a bounded PR page and only publishes patches after checking the same head again', async () => {
    const fetch = github();
    const result = await createGitProvider({ fetch }).inspect('https://github.com/team/cafe/pull/7');
    expect(result.snapshot).toMatchObject({ commitSha: sha, coverage: 'complete' });
    expect(result.snapshot?.files.find((file) => file.kind === 'patch')).toMatchObject({
      path: patch.filename,
      content: patch.patch,
      truncated: false,
    });
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      base,
      `${base}/pulls/7`,
      `${base}/readme?ref=${sha}`,
      `${base}/pulls/7/files?per_page=8&page=1`,
      `${base}/pulls/7`,
    ]);
  });

  it('discards every material if the PR head changes during retrieval', async () => {
    let reads = 0;
    const fetch = github({
      [`${base}/pulls/7`]: () => json(++reads === 1 ? pull : { ...pull, head: { sha: 'b'.repeat(40) } }),
    });
    const result = await createGitProvider({ fetch }).inspect('https://github.com/team/cafe/pull/7');
    expect(result).toMatchObject({
      status: 'verified',
      snapshot: { commitSha: sha, coverage: 'metadata_only', files: [] },
    });
    expect(result.snapshot?.warnings.join(' ')).toMatch(/изменил/i);
  });

  it('discards materials if the final PR validation fails', async () => {
    let reads = 0;
    const fetch = github({ [`${base}/pulls/7`]: () => (++reads === 1 ? json(pull) : json({}, 429)) });
    const result = await createGitProvider({ fetch }).inspect('https://github.com/team/cafe/pull/7');
    expect(result.snapshot).toMatchObject({ coverage: 'metadata_only', files: [] });
    expect(result.snapshot?.warnings.join(' ')).toMatch(/неизменност/i);
  });

  it.each(['base', 'count'])(
    'discards materials when the PR %s changes with the same head',
    async (change) => {
      let reads = 0;
      const updated =
        change === 'base'
          ? { ...pull, base: { repo: repository, sha: 'c'.repeat(40) } }
          : { ...pull, changed_files: 2 };
      const fetch = github({ [`${base}/pulls/7`]: () => json(++reads === 1 ? pull : updated) });
      const result = await createGitProvider({ fetch }).inspect('https://github.com/team/cafe/pull/7');
      expect(result.snapshot).toMatchObject({ coverage: 'metadata_only', files: [] });
      expect(result.snapshot?.warnings.join(' ')).toMatch(/изменил/i);
    },
  );

  it('pins deleted and renamed source paths to the correct commit side', async () => {
    const fetch = github({
      [`${base}/pulls/7`]: () => json({ ...pull, changed_files: 2 }),
      [`${base}/pulls/7/files?per_page=8&page=1`]: () =>
        json([
          { filename: 'old file.ts', status: 'removed', patch: '@@ -1 +0,0 @@\n-old' },
          {
            filename: 'new.ts',
            previous_filename: 'old.ts',
            status: 'renamed',
            patch: '@@ -1 +1 @@\n-old\n+new',
          },
        ]),
    });
    const result = await createGitProvider({ fetch }).inspect('https://github.com/team/cafe/pull/7');
    expect(
      result.snapshot?.files.filter((file) => file.kind === 'patch').map((file) => file.sourceUrl),
    ).toEqual([
      `https://github.com/team/cafe/compare/${baseSha}...${sha}`,
      `https://github.com/team/cafe/compare/${baseSha}...${sha}`,
    ]);
  });

  it('limits total characters, characters per material, and total materials even for a large PR', async () => {
    const fetch = github({
      [`${base}/pulls/7`]: () => json({ ...pull, changed_files: 40 }),
      [`${base}/pulls/7/files?per_page=8&page=1`]: () =>
        json(
          Array.from({ length: 8 }, (_, index) => ({
            filename: `${index}.ts`,
            status: 'added',
            patch: '+'.repeat(7_000),
          })),
        ),
    });
    const result = await createGitProvider({ fetch }).inspect('https://github.com/team/cafe/pull/7');
    expect(result.snapshot?.coverage).toBe('partial');
    expect(result.snapshot!.files.length).toBeLessThanOrEqual(8);
    expect(
      result.snapshot!.files.reduce((total, file) => total + file.content.length, 0),
    ).toBeLessThanOrEqual(24_000);
    expect(result.snapshot!.files.every((file) => file.content.length <= 6_000)).toBe(true);
    expect(result.snapshot!.files.some((file) => file.truncated)).toBe(true);
    expect(fetch.mock.calls.some(([url]) => String(url).includes('page=2'))).toBe(false);
  });

  it('counts README against the eight-material output budget', async () => {
    const fetch = github({
      [`${base}/pulls/7`]: () => json({ ...pull, changed_files: 8 }),
      [`${base}/pulls/7/files?per_page=8&page=1`]: () =>
        json(
          Array.from({ length: 8 }, (_, index) => ({
            filename: `${index}.ts`,
            status: 'added',
            patch: '+line',
          })),
        ),
    });
    const result = await createGitProvider({ fetch }).inspect('https://github.com/team/cafe/pull/7');
    expect(result.snapshot?.files).toHaveLength(8);
    expect(result.snapshot?.coverage).toBe('partial');
  });

  it('marks a patch incomplete when GitHub omits changed lines', async () => {
    const fetch = github({
      [`${base}/pulls/7/files?per_page=8&page=1`]: () => json([{ ...patch, additions: 5, deletions: 0 }]),
    });
    const result = await createGitProvider({ fetch }).inspect('https://github.com/team/cafe/pull/7');
    expect(result.snapshot?.coverage).toBe('partial');
    expect(result.snapshot?.files.find((file) => file.kind === 'patch')?.truncated).toBe(true);
  });

  it('rejects oversized metadata before treating a repository as public', async () => {
    const fetch = github({ [base]: () => json({ ...repository, description: 'x'.repeat(300_000) }) });
    const result = await createGitProvider({ fetch }).inspect('https://github.com/team/cafe');
    expect(result.status).toBe('unavailable');
    expect(result.facts).toEqual([]);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('keeps README as partial when the bounded patch response exceeds byte limits', async () => {
    const fetch = github({
      [`${base}/pulls/7/files?per_page=8&page=1`]: () => json([{ ...patch, patch: '+'.repeat(300_000) }]),
    });
    const result = await createGitProvider({ fetch }).inspect('https://github.com/team/cafe/pull/7');
    expect(result.snapshot).toMatchObject({ coverage: 'partial', files: [{ kind: 'readme' }] });
    expect(fetch.mock.calls.at(-1)?.[0]).toBe(`${base}/pulls/7`);
  });

  it('does not follow a README redirect or use remote source URLs', async () => {
    const fetch = github({
      [`${base}/readme?ref=${sha}`]: () =>
        new Response(null, { status: 302, headers: { location: 'https://attacker.example/' } }),
    });
    const result = await createGitProvider({ fetch, token: 'secret-token' }).inspect(
      'https://github.com/team/cafe/pull/7',
    );
    expect(result.snapshot).toMatchObject({ coverage: 'partial', files: [{ kind: 'patch' }] });
    expect(
      fetch.mock.calls.every(
        ([url, init]) =>
          new URL(String(url)).origin === 'https://api.github.com' && init?.redirect === 'error',
      ),
    ).toBe(true);
    expect(JSON.stringify(result)).not.toContain('secret-token');
  });

  it('never publishes staged PR patches when the final head check stalls', async () => {
    let reads = 0;
    const fetch = github({ [`${base}/pulls/7`]: () => (++reads === 1 ? json(pull) : new Promise(() => {})) });
    const result = await createGitProvider({ fetch, timeoutMs: 30 }).inspect(
      'https://github.com/team/cafe/pull/7',
    );
    expect(result).toMatchObject({ status: 'verified', snapshot: { coverage: 'metadata_only', files: [] } });
    expect(result.snapshot?.warnings.length).toBeGreaterThan(1);
  });

  it('keeps readable material while reporting binary or missing patches as partial', async () => {
    const fetch = github({
      [`${base}/pulls/7/files?per_page=8&page=1`]: () => json([{ filename: 'logo.png' }]),
    });
    const result = await createGitProvider({ fetch }).inspect('https://github.com/team/cafe/pull/7');
    expect(result.snapshot).toMatchObject({ coverage: 'partial', files: [{ kind: 'readme' }] });
    expect(result.snapshot?.warnings.join(' ')).toMatch(/patch/i);
  });

  it('rejects invalid README encoding and forged paths without following supplied URLs', async () => {
    for (const material of [
      { ...readme(), content: 'not base64!' },
      { ...readme(), path: '../../secret' },
      { ...readme(), size: 1 },
    ]) {
      const fetch = github({
        [`${base}/readme?ref=${sha}`]: () =>
          json({
            ...material,
            download_url: 'https://attacker.example/secret',
            html_url: 'javascript:alert(1)',
          }),
      });
      const result = await createGitProvider({ fetch, token: 'secret-token' }).inspect(
        'https://github.com/team/cafe',
      );
      expect(result.snapshot).toMatchObject({ coverage: 'metadata_only', files: [] });
      expect(fetch.mock.calls.every(([url]) => new URL(String(url)).hostname === 'api.github.com')).toBe(
        true,
      );
      expect(JSON.stringify(result)).not.toContain('secret-token');
    }
  });

  it('does not guess a source commit side when a patch status is missing', async () => {
    const fetch = github({
      [`${base}/pulls/7/files?per_page=8&page=1`]: () => json([{ filename: 'deleted.ts', patch: '-line' }]),
    });
    const result = await createGitProvider({ fetch }).inspect('https://github.com/team/cafe/pull/7');
    expect(result.snapshot).toMatchObject({ coverage: 'partial', files: [{ kind: 'readme' }] });
  });

  it('cancels oversized streamed bodies even without Content-Length', async () => {
    const cancel = vi.fn();
    const fetch = github({
      [`${base}/readme?ref=${sha}`]: () =>
        new Response(
          new ReadableStream({
            pull(controller) {
              controller.enqueue(new Uint8Array(64 * 1024).fill(32));
            },
            cancel,
          }),
        ),
    });
    const result = await createGitProvider({ fetch }).inspect('https://github.com/team/cafe');
    expect(result.snapshot).toMatchObject({ coverage: 'metadata_only', files: [] });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('rejects excessive declared body size before reading it', async () => {
    const cancel = vi.fn();
    const fetch = github({
      [`${base}/readme?ref=${sha}`]: () =>
        new Response(new ReadableStream({ cancel }), { headers: { 'content-length': '1000000000' } }),
    });
    const result = await createGitProvider({ fetch }).inspect('https://github.com/team/cafe');
    expect(result.snapshot?.coverage).toBe('metadata_only');
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('retains validated metadata and cancels a stalled body at the operation deadline', async () => {
    const cancel = vi.fn();
    const fetch = github({
      [`${base}/readme?ref=${sha}`]: () => new Response(new ReadableStream({ cancel })),
    });
    const start = Date.now();
    const result = await createGitProvider({ fetch, timeoutMs: 30 }).inspect('https://github.com/team/cafe');
    expect(result).toMatchObject({ status: 'verified', snapshot: { coverage: 'metadata_only', files: [] } });
    expect(Date.now() - start).toBeLessThan(1000);
    expect(cancel).toHaveBeenCalledOnce();
    expect(fetch.mock.calls.every(([, init]) => init?.signal?.aborted)).toBe(true);
  });

  it('cancels bodies returned by a fetch implementation after the deadline has expired', async () => {
    const cancel = vi.fn();
    let finishRead: ((response: Response) => void) | undefined;
    const fetch = github({
      [`${base}/readme?ref=${sha}`]: () =>
        new Promise((resolve) => {
          finishRead = resolve;
        }),
    });
    const result = await createGitProvider({ fetch, timeoutMs: 30 }).inspect('https://github.com/team/cafe');
    expect(result.snapshot?.coverage).toBe('metadata_only');
    finishRead!(new Response(new ReadableStream({ cancel })));
    await vi.waitFor(() => expect(cancel).toHaveBeenCalledOnce());
    expect(result.snapshot?.files).toEqual([]);
  });

  it('never follows a redirect or exposes private metadata with the optional token', async () => {
    for (const result of [
      () => json({ ...repository, private: true }),
      () => new Response(null, { status: 302, headers: { location: 'https://attacker.example/' } }),
    ]) {
      const fetch = github({ [base]: result });
      const evidence = await createGitProvider({ fetch, token: 'secret-token' }).inspect(
        'https://github.com/team/cafe',
      );
      expect(evidence).toMatchObject({ status: 'unavailable', facts: [] });
      expect(evidence.snapshot).toBeFalsy();
      expect(fetch).toHaveBeenCalledOnce();
      expect(fetch.mock.calls[0]?.[1]?.redirect).toBe('error');
      expect(JSON.stringify(evidence)).not.toContain('secret-token');
    }
  });

  it('does not invent materials in mock mode', async () => {
    const fetch = github();
    const result = await createGitProvider({ mode: 'mock', fetch }).inspect('https://github.com/team/cafe');
    expect(result.status).toBe('mock');
    expect(result.snapshot).toBeFalsy();
    expect(fetch).not.toHaveBeenCalled();
  });
});
