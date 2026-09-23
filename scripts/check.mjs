// A single check command for the organizers: `npm run check` from the repository root.
// Backend: types + tests (vitest). Frontend: types + tests + build. Then a smoke run of the built application
// on a temporary database (AI and Git in stub/mock mode, no external calls or spend):
// health, UI, catalog, world data, code login, presence of two players in the 3D world.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { BACKEND, FRONTEND, c, checkNode, ensureRolldown, install, must, run, startServer, step, waitHealth } from './lib.mjs';

checkNode();
const results = [];
const record = (name, ok, note = '') => { results.push({ name, ok, note }); console.log(`${ok ? c.ok('✔') : c.bad('✖')} ${name}${note ? c.dim(' — ' + note) : ''}`); };

step('Dependencies');
must(install(BACKEND), 'npm ci in backend/');
must(ensureRolldown(BACKEND), 'rolldown native module for vitest');
must(install(FRONTEND), 'npm install in frontend/');

step('Backend: types and tests');
record('backend: tsc', run('npm', ['run', 'check'], BACKEND) === 0);
{
  // realtime tests wait up to 1 s for events — on a heavily loaded machine we allow one retry and report it
  const first = run('npm', ['test'], BACKEND) === 0;
  const ok = first || run('npm', ['test'], BACKEND) === 0;
  record('backend: tests (vitest)', ok, first ? '' : ok ? 'passed on the second attempt' : '');
}

step('Frontend: types, tests, build');
record('frontend: tsc', run('npm', ['run', 'typecheck'], FRONTEND) === 0);
record('frontend: tests', run('npm', ['test'], FRONTEND) === 0);
record('frontend: build', run('npm', ['run', 'build'], FRONTEND) === 0);

step('Smoke run (temporary database, AI stub, Git mock)');
const tmp = mkdtempSync(path.join(os.tmpdir(), 'ai-sana-check-'));
const port = 3000 + 100 + Math.floor(Math.random() * 800);
const base = `http://127.0.0.1:${port}`;
const server = startServer(
  { PORT: String(port), HOST: '127.0.0.1', DATABASE_PATH: path.join(tmp, 'check.db'), AI_MODE: 'stub', GIT_MODE: 'mock', OPENAI_API_KEY: '', FRONTEND_DIST: path.join(FRONTEND, 'dist') },
  { quiet: true, cwd: tmp },
);
// the server runs in a temporary folder: temporary database codes are written there, the real file is untouched, .env is not read
const accountsFile = path.join(tmp, 'demo-accounts.local.json');
const before = 0;
try {
  const up = await waitHealth(base);
  record('server responds on /api/v1/health', up);
  if (up) {
    const get = async (p) => (await fetch(base + p)).json();
    const html = await (await fetch(base + '/')).text();
    record('UI is served by the server', html.includes('<div id="root"'));
    const catalog = (await get('/api/v1/catalog?pageSize=50')).data;
    record('task catalog', catalog.cards.length > 0, `cards: ${catalog.cards.length}`);
    const world = (await get('/api/v1/world')).data;
    record('3D world data (/world)', world.teams.length > 0, `teams: ${world.teams.length}`);
    const accounts = JSON.parse(readFileSync(accountsFile, 'utf8')).slice(before);
    const team = accounts.find((a) => a.role === 'team');
    const login = team ? await fetch(base + '/api/v1/session/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: team.code }) }) : null;
    const session = login?.ok ? (await login.json()).data : null;
    record('login with a team code', !!session);
    const { io } = createRequire(path.join(FRONTEND, 'package.json'))('socket.io-client');
    const presence = await new Promise((resolve) => {
      const a = io(base, { transports: ['websocket'], auth: session ? { token: session.token } : {} });
      const b = io(base, { transports: ['websocket'] });
      const t = setTimeout(() => { a.close(); b.close(); resolve(false); }, 6000);
      a.on('connect', () => a.emit('world.player.join', { p: [0, 0, 27], name: 'Check' }, () => {
        a.once('world.player.join', (p) => { clearTimeout(t); a.close(); b.close(); resolve(p.role === 'guest'); });
        b.on('connect', () => b.emit('world.player.join', { p: [2, 0, 27] }, () => {}));
        if (b.connected) b.emit('world.player.join', { p: [2, 0, 27] }, () => {});
      }));
    });
    record('multiplayer: players see each other', presence);
  }
} catch (e) {
  record('smoke run', false, e instanceof Error ? e.message : String(e));
} finally {
  server.kill('SIGINT');
  await new Promise((r) => setTimeout(r, 400));
  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* temporary folder */ }
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${c.b('Summary')}`);
for (const r of results) console.log(`  ${r.ok ? c.ok('PASS') : c.bad('FAIL')}  ${r.name}${r.note ? c.dim(' — ' + r.note) : ''}`);
console.log(failed.length ? c.bad(`\n${failed.length} of ${results.length} checks failed.`) : c.ok(`\nAll ${results.length} checks passed.`));
process.exit(failed.length ? 1 : 0);
