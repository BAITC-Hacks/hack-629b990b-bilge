// Общие помощники скриптов запуска/проверки (без внешних зависимостей, Node >= 22.12, macOS/Linux/Windows).
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const BACKEND = path.join(ROOT, 'backend');
export const FRONTEND = path.join(ROOT, 'frontend');
const isWin = process.platform === 'win32';
const npm = isWin ? 'npm.cmd' : 'npm';

export const c = {
  ok: (s) => `\x1b[32m${s}\x1b[0m`,
  bad: (s) => `\x1b[31m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  b: (s) => `\x1b[1m${s}\x1b[0m`,
};

export function step(title) {
  console.log(`\n${c.b('▶ ' + title)}`);
}

export function checkNode() {
  const [maj, min] = process.versions.node.split('.').map(Number);
  if (maj < 22 || (maj === 22 && min < 12)) {
    console.error(c.bad(`Нужен Node.js 22.12 или новее (сейчас ${process.versions.node}). https://nodejs.org`));
    process.exit(1);
  }
}

/** Запуск команды с выводом в консоль; возвращает код выхода. */
export function run(cmd, args, cwd, env = {}) {
  const exe = cmd === 'npm' ? npm : cmd;
  const r = spawnSync(exe, args, { cwd, stdio: 'inherit', env: { ...process.env, ...env }, shell: isWin });
  return r.status ?? 1;
}
export function must(code, what) {
  if (code !== 0) {
    console.error(c.bad(`\n✖ Не удалось: ${what}`));
    process.exit(code || 1);
  }
}

/** Установка зависимостей по lock-файлу (один раз). */
export function install(dir) {
  if (existsSync(path.join(dir, 'node_modules', '.package-lock.json'))) return 0;
  const lock = existsSync(path.join(dir, 'package-lock.json'));
  return run('npm', [lock ? 'ci' : 'install', '--no-audit', '--no-fund'], dir);
}

/**
 * Lock-файл бэкенда собран на Windows: на macOS/Linux npm не ставит нативный модуль rolldown (нужен vitest).
 * Доустанавливаем его для текущей платформы без изменения package.json/package-lock.
 */
export function ensureRolldown(dir) {
  const pkg = path.join(dir, 'node_modules', 'rolldown', 'package.json');
  if (!existsSync(pkg)) return 0;
  const version = JSON.parse(readFileSync(pkg, 'utf8')).version;
  const suffix = process.platform === 'linux' ? '-gnu' : process.platform === 'win32' ? '-msvc' : '';
  const name = `@rolldown/binding-${process.platform}-${process.arch}${suffix}`;
  if (existsSync(path.join(dir, 'node_modules', ...name.split('/')))) return 0;
  return run('npm', ['i', '--no-save', '--no-audit', '--no-fund', `${name}@${version}`], dir);
}

/** Фоновый процесс сервера. */
export function startServer(env, { quiet = false, cwd = BACKEND } = {}) {
  const tsx = path.join(BACKEND, 'node_modules', '.bin', isWin ? 'tsx.cmd' : 'tsx');
  return spawn(tsx, [path.join(BACKEND, 'src', 'server.ts')], {
    cwd,
    env: { ...process.env, ...env },
    stdio: quiet ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    shell: isWin,
  });
}

export async function waitHealth(base, timeoutMs = 40000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    try {
      const r = await fetch(`${base}/api/v1/health`);
      if (r.ok) return true;
    } catch {
      /* ещё стартует */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

export function readEnvFile(file) {
  const out = {};
  if (!existsSync(file)) return out;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
}
