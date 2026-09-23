// One command to launch the whole project: `npm start` from the repository root.
// Installs dependencies, prepares backend/.env (without an AI key an honest fallback mode is used), builds the frontend
// and starts the BFF, which serves both the API and the UI on a single address. Prints login codes and links.
// Flags: --bots (demo bots in the 3D world), --no-open (do not open the browser).
import { copyFileSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { BACKEND, FRONTEND, c, checkNode, install, must, readEnvFile, run, startServer, step, waitHealth } from './lib.mjs';

checkNode();
const args = new Set(process.argv.slice(2));

step('1/4 Backend dependencies');
must(install(BACKEND), 'npm ci in backend/');
step('2/4 Frontend dependencies and build');
must(install(FRONTEND), 'npm install in frontend/');
must(run('npm', ['run', 'build'], FRONTEND), 'frontend build');

step('3/4 Settings');
const envFile = path.join(BACKEND, '.env');
if (!existsSync(envFile)) {
  copyFileSync(path.join(BACKEND, '.env.example'), envFile);
  console.log('Created backend/.env from .env.example.');
}
const env = readEnvFile(envFile);
const port = Number(process.env.PORT ?? env.PORT ?? 3001);
const host = process.env.HOST ?? env.HOST ?? '127.0.0.1';
const base = `http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${port}`;
const aiLive = (process.env.OPENAI_API_KEY ?? env.OPENAI_API_KEY) && (process.env.AI_MODE ?? env.AI_MODE) !== 'stub';
console.log(`AI: ${aiLive ? 'OpenAI (key from backend/.env)' : c.dim('fallback mode without a key — template questions, everything else works')}`);

step('4/4 Launch');
let bots = null;
const server = startServer({ FRONTEND_DIST: path.join(FRONTEND, 'dist'), PORT: String(port) });
const stop = () => { server.kill('SIGINT'); bots?.kill('SIGINT'); };
process.on('SIGINT', () => { stop(); process.exit(0); });
process.on('SIGTERM', () => { stop(); process.exit(0); });
server.on('exit', (code) => { if (code) console.error(c.bad(`The server stopped with code ${code}. Port ${port} may be busy — set another one: PORT=3005 npm start`)); process.exit(code ?? 0); });

if (!(await waitHealth(base))) {
  console.error(c.bad('The server did not respond within 40 seconds.'));
  stop();
  process.exit(1);
}

if (args.has('--bots')) {
  bots = spawn(process.execPath, ['--import', 'tsx', 'scripts/demo-bots.ts'], { cwd: FRONTEND, env: { ...process.env, SERVER_URL: base }, stdio: 'inherit' });
}

// demo profile codes — a local file created by the backend on first launch (not committed to git)
const accountsFile = path.join(BACKEND, 'demo-accounts.local.json');
let accounts = [];
try { accounts = JSON.parse(readFileSync(accountsFile, 'utf8')); } catch { /* no file */ }
const link = (a, name) => `${base}/#/login?code=${encodeURIComponent(a.code)}${name ? `&name=${encodeURIComponent(name)}` : ''}`;
console.log(`\n${c.ok('✔ AI Sana is running')}: ${c.b(base)}   API: ${base}/api/docs\n`);
const biz = accounts.filter((a) => a.role === 'business');
const teams = accounts.filter((a) => a.role === 'team');
if (accounts.length) {
  console.log(c.b('Businesses (create and publish a task, select a team, confirm a milestone):'));
  for (const a of biz) console.log(`  ${a.displayName.padEnd(22)} code ${a.code}   ${c.dim(link(a))}`);
  console.log(c.b('\nTeams (proposal, milestone; they see each other in the 3D world):'));
  for (const [i, a] of teams.entries()) console.log(`  ${a.displayName.padEnd(22)} code ${a.code}   ${c.dim(link(a, ['Ayan', 'Dana', 'Timur', 'Assel', 'Yerzhan'][i % 5]))}`);
  console.log(`\nGuest: ${base}/#/login?as=guest`);
  console.log(c.dim(`Codes are also in ${accountsFile}. Two tabs = two roles (each tab has its own session).`));
} else console.log(c.dim(`Login codes: ${accountsFile}`));
console.log(c.dim('\nStop: Ctrl+C'));

if (!args.has('--no-open')) {
  const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  const oargs = process.platform === 'win32' ? ['/c', 'start', '', base] : [base];
  try { spawn(opener, oargs, { stdio: 'ignore', detached: true }).unref(); } catch { /* no browser */ }
}
