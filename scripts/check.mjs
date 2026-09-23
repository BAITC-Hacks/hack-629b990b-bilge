// Одна команда проверки для организаторов: `npm run check` из корня репозитория.
// Бэкенд: типы + тесты (vitest). Фронтенд: типы + тесты + сборка. Затем дымовой запуск собранного приложения
// во временной базе (ИИ и Git — в режиме stub/mock, без внешних вызовов и расходов):
// health, интерфейс, каталог, данные мира, вход по коду, присутствие двух игроков в 3D-мире.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { BACKEND, FRONTEND, c, checkNode, ensureRolldown, install, must, run, startServer, step, waitHealth } from './lib.mjs';

checkNode();
const results = [];
const record = (name, ok, note = '') => { results.push({ name, ok, note }); console.log(`${ok ? c.ok('✔') : c.bad('✖')} ${name}${note ? c.dim(' — ' + note) : ''}`); };

step('Зависимости');
must(install(BACKEND), 'npm ci в backend/');
must(ensureRolldown(BACKEND), 'нативный модуль rolldown для vitest');
must(install(FRONTEND), 'npm install в frontend/');

step('Бэкенд: типы и тесты');
record('backend: tsc', run('npm', ['run', 'check'], BACKEND) === 0);
record('backend: тесты (vitest)', run('npm', ['test'], BACKEND) === 0);

step('Фронтенд: типы, тесты, сборка');
record('frontend: tsc', run('npm', ['run', 'typecheck'], FRONTEND) === 0);
record('frontend: тесты', run('npm', ['test'], FRONTEND) === 0);
record('frontend: сборка', run('npm', ['run', 'build'], FRONTEND) === 0);

step('Дымовой запуск (временная база, ИИ stub, Git mock)');
const tmp = mkdtempSync(path.join(os.tmpdir(), 'ai-sana-check-'));
const port = 3000 + 100 + Math.floor(Math.random() * 800);
const base = `http://127.0.0.1:${port}`;
const server = startServer(
  { PORT: String(port), HOST: '127.0.0.1', DATABASE_PATH: path.join(tmp, 'check.db'), AI_MODE: 'stub', GIT_MODE: 'mock', OPENAI_API_KEY: '', FRONTEND_DIST: path.join(FRONTEND, 'dist') },
  { quiet: true, cwd: tmp },
);
// сервер запущен во временной папке: коды временной базы пишутся туда, настоящий файл не меняется, .env не читается
const accountsFile = path.join(tmp, 'demo-accounts.local.json');
const before = 0;
try {
  const up = await waitHealth(base);
  record('сервер отвечает /api/v1/health', up);
  if (up) {
    const get = async (p) => (await fetch(base + p)).json();
    const html = await (await fetch(base + '/')).text();
    record('интерфейс раздаётся сервером', html.includes('<div id="root"'));
    const catalog = (await get('/api/v1/catalog?pageSize=50')).data;
    record('каталог задач', catalog.cards.length > 0, `карточек: ${catalog.cards.length}`);
    const world = (await get('/api/v1/world')).data;
    record('данные 3D-мира (/world)', world.teams.length > 0, `команд: ${world.teams.length}`);
    const accounts = JSON.parse(readFileSync(accountsFile, 'utf8')).slice(before);
    const team = accounts.find((a) => a.role === 'team');
    const login = team ? await fetch(base + '/api/v1/session/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: team.code }) }) : null;
    const session = login?.ok ? (await login.json()).data : null;
    record('вход по коду команды', !!session);
    const { io } = createRequire(path.join(FRONTEND, 'package.json'))('socket.io-client');
    const presence = await new Promise((resolve) => {
      const a = io(base, { transports: ['websocket'], auth: session ? { token: session.token } : {} });
      const b = io(base, { transports: ['websocket'] });
      const t = setTimeout(() => { a.close(); b.close(); resolve(false); }, 6000);
      a.on('connect', () => a.emit('world.player.join', { p: [0, 0, 27], name: 'Проверка' }, () => {
        a.once('world.player.join', (p) => { clearTimeout(t); a.close(); b.close(); resolve(p.role === 'guest'); });
        b.on('connect', () => b.emit('world.player.join', { p: [2, 0, 27] }, () => {}));
        if (b.connected) b.emit('world.player.join', { p: [2, 0, 27] }, () => {});
      }));
    });
    record('мультиплеер: игроки видят друг друга', presence);
  }
} catch (e) {
  record('дымовой запуск', false, e instanceof Error ? e.message : String(e));
} finally {
  server.kill('SIGINT');
  await new Promise((r) => setTimeout(r, 400));
  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* временная папка */ }
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${c.b('Итог')}`);
for (const r of results) console.log(`  ${r.ok ? c.ok('PASS') : c.bad('FAIL')}  ${r.name}${r.note ? c.dim(' — ' + r.note) : ''}`);
console.log(failed.length ? c.bad(`\n${failed.length} из ${results.length} проверок не прошли.`) : c.ok(`\nВсе ${results.length} проверок прошли.`));
process.exit(failed.length ? 1 : 0);
