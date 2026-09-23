// Вход по коду BFF (коды демо-профилей — в локальном backend/demo-accounts.local.json), создание команды, гость.
// Имя участника нужно только для таблички в 3D-мире: в BFF вся команда входит под одним кодом.
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, getWorldName, setToken, setWorldName } from '../api';
import { useApp } from '../state';
import { FieldError } from '../components/common';

const COLORS = ['#6366f1', '#059669', '#d97706', '#0891b2', '#db2777', '#7c3aed', '#16a34a', '#e11d48'];

export function Login() {
  const nav = useNavigate();
  const { run, refresh } = useApp();
  const [params] = useSearchParams();
  const [code, setCode] = useState('');
  const [name, setName] = useState(getWorldName());
  const [team, setTeam] = useState({ name: '', color: COLORS[0] });
  const [created, setCreated] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function enter(c: string, n = name) {
    setBusy(true);
    const r = await run(() => api.startSession({ code: c.trim() }));
    setBusy(false);
    if (!r) return;
    setWorldName(n);
    setToken(r.data.token);
    await refresh();
    const next = params.get('next');
    nav(next && next.startsWith('/') && !next.startsWith('//') ? next : r.data.actor.role === 'business' ? '/dashboard' : '/world', { replace: true });
  }

  // Быстрый вход по ссылке для подготовки вкладок к показу: #/login?code=…&name=…
  useEffect(() => {
    const c = params.get('code');
    if (c) void enter(c, params.get('name') ?? name);
    else if (params.get('as') === 'guest') { setToken(null); void refresh().then(() => nav('/world', { replace: true })); }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="login">
      <div className="login-hero">
        <h1>AI Sana · Площадь задач</h1>
        <p>Бизнес превращает короткое описание проблемы в понятную карточку задачи. Студенческие команды гуляют по 3D-кампусу, находят задачи-здания и отправляют предложения.</p>
        <p className="muted small">Вход по коду. Коды демо-профилей лежат в локальном файле <code>backend/demo-accounts.local.json</code>; участники одной команды входят по общему коду. Каждая вкладка может войти своей ролью.</p>
      </div>
      <div className="login-cols">
        <section className="panel">
          <h2>Войти по коду</h2>
          <form className="form" onSubmit={(e) => { e.preventDefault(); void enter(code); }}>
            <label>Код входа<input value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" placeholder="код бизнеса или команды" /></label>
            <FieldError field="code" />
            <label>Ваше имя в 3D-мире <small className="muted">(для участников команды, необязательно)</small><input value={name} maxLength={24} onChange={(e) => setName(e.target.value)} placeholder="например, Аян" /></label>
            <div className="row"><button className="btn" type="submit" disabled={busy || !code.trim()}>Войти</button>
              <button className="btn ghost" type="button" onClick={async () => { setToken(null); await refresh(); nav('/world'); }}>Гость — только просмотр</button></div>
          </form>
        </section>
        <section className="panel">
          <h2>Новая команда</h2>
          {created ? (
            <div className="alert">
              <b>Команда создана. Код входа показывается один раз — сохраните его:</b>
              <pre>{created}</pre>
              <p className="small">Остальные участники входят по этому же коду.</p>
              <button className="btn" onClick={() => nav('/world')}>В 3D-мир</button>
            </div>
          ) : (
            <form className="form" onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              // Не повторяем автоматически: сервер создаёт новую команду на каждый запрос.
              const r = await run(() => api.createTeam({ name: team.name, color: team.color }));
              setBusy(false);
              if (!r) return;
              setWorldName(name);
              setToken(r.data.token);
              setCreated(r.data.code);
              await refresh();
            }}>
              <label>Название команды<input value={team.name} maxLength={100} onChange={(e) => setTeam({ ...team, name: e.target.value })} /></label>
              <FieldError field="name" />
              <div className="row wrap" role="radiogroup" aria-label="Цвет команды">
                {COLORS.map((c) => <button key={c} type="button" className={`swatch ${team.color === c ? 'on' : ''}`} style={{ background: c }} aria-label={c} aria-pressed={team.color === c} onClick={() => setTeam({ ...team, color: c })} />)}
              </div>
              <label>Ваше имя в 3D-мире<input value={name} maxLength={24} onChange={(e) => setName(e.target.value)} /></label>
              <button className="btn accent" type="submit" disabled={busy || !team.name.trim()}>Создать команду</button>
            </form>
          )}
        </section>
      </div>
    </div>
  );
}
