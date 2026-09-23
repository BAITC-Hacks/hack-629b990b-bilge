// Одна команда для запуска всего проекта: `npm start` из корня репозитория.
// Ставит зависимости, готовит backend/.env (без ключа ИИ работает честный резервный режим), собирает фронтенд
// и запускает BFF, который раздаёт и API, и интерфейс на одном адресе. Показывает коды входа и ссылки.
// Флаги: --bots (демо-боты в 3D-мире), --no-open (не открывать браузер).
import { copyFileSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { BACKEND, FRONTEND, c, checkNode, install, must, readEnvFile, run, startServer, step, waitHealth } from './lib.mjs';

checkNode();
const args = new Set(process.argv.slice(2));

step('1/4 Зависимости бэкенда');
must(install(BACKEND), 'npm ci в backend/');
step('2/4 Зависимости и сборка фронтенда');
must(install(FRONTEND), 'npm install в frontend/');
must(run('npm', ['run', 'build'], FRONTEND), 'сборка фронтенда');

step('3/4 Настройки');
const envFile = path.join(BACKEND, '.env');
if (!existsSync(envFile)) {
  copyFileSync(path.join(BACKEND, '.env.example'), envFile);
  console.log('Создан backend/.env из .env.example.');
}
const env = readEnvFile(envFile);
const port = Number(process.env.PORT ?? env.PORT ?? 3001);
const host = process.env.HOST ?? env.HOST ?? '127.0.0.1';
const base = `http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${port}`;
const aiLive = (process.env.OPENAI_API_KEY ?? env.OPENAI_API_KEY) && (process.env.AI_MODE ?? env.AI_MODE) !== 'stub';
console.log(`ИИ: ${aiLive ? 'OpenAI (ключ из backend/.env)' : c.dim('резервный режим без ключа — вопросы по шаблону, всё остальное работает')}`);

step('4/4 Запуск');
let bots = null;
const server = startServer({ FRONTEND_DIST: path.join(FRONTEND, 'dist'), PORT: String(port) });
const stop = () => { server.kill('SIGINT'); bots?.kill('SIGINT'); };
process.on('SIGINT', () => { stop(); process.exit(0); });
process.on('SIGTERM', () => { stop(); process.exit(0); });
server.on('exit', (code) => { if (code) console.error(c.bad(`Сервер остановился с кодом ${code}. Возможно, порт ${port} занят — задайте другой: PORT=3005 npm start`)); process.exit(code ?? 0); });

if (!(await waitHealth(base))) {
  console.error(c.bad('Сервер не ответил за 40 секунд.'));
  stop();
  process.exit(1);
}

if (args.has('--bots')) {
  bots = spawn(process.execPath, ['--import', 'tsx', 'scripts/demo-bots.ts'], { cwd: FRONTEND, env: { ...process.env, SERVER_URL: base }, stdio: 'inherit' });
}

// коды демо-профилей — локальный файл, создаётся бэкендом при первом запуске (в git не попадает)
const accountsFile = path.join(BACKEND, 'demo-accounts.local.json');
let accounts = [];
try { accounts = JSON.parse(readFileSync(accountsFile, 'utf8')); } catch { /* нет файла */ }
const link = (a, name) => `${base}/#/login?code=${encodeURIComponent(a.code)}${name ? `&name=${encodeURIComponent(name)}` : ''}`;
console.log(`\n${c.ok('✔ AI Sana запущен')}: ${c.b(base)}   API: ${base}/api/docs\n`);
const biz = accounts.filter((a) => a.role === 'business');
const teams = accounts.filter((a) => a.role === 'team');
if (accounts.length) {
  console.log(c.b('Бизнес (создать и опубликовать задачу, выбрать команду, подтвердить этап):'));
  for (const a of biz) console.log(`  ${a.displayName.padEnd(22)} код ${a.code}   ${c.dim(link(a))}`);
  console.log(c.b('\nКоманды (отклик, этап; в 3D-мире видят друг друга):'));
  for (const [i, a] of teams.entries()) console.log(`  ${a.displayName.padEnd(22)} код ${a.code}   ${c.dim(link(a, ['Аян', 'Дана', 'Тимур', 'Асель', 'Ержан'][i % 5]))}`);
  console.log(`\nГость: ${base}/#/login?as=guest`);
  console.log(c.dim(`Коды также в ${accountsFile}. Две вкладки = две роли (сессия у каждой вкладки своя).`));
} else console.log(c.dim(`Коды входа: ${accountsFile}`));
console.log(c.dim('\nОстановить: Ctrl+C'));

if (!args.has('--no-open')) {
  const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  const oargs = process.platform === 'win32' ? ['/c', 'start', '', base] : [base];
  try { spawn(opener, oargs, { stdio: 'ignore', detached: true }).unref(); } catch { /* без браузера */ }
}
