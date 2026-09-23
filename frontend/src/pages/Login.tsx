// Login with a BFF code (demo profile codes are in the local backend/demo-accounts.local.json), team creation, guest.
// The participant name is only used for the 3D-world nameplate: in the BFF the whole team signs in with one code.
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

  // Quick login via link to prepare tabs for a demo: #/login?code=…&name=…
  useEffect(() => {
    const c = params.get('code');
    if (c) void enter(c, params.get('name') ?? name);
    else if (params.get('as') === 'guest') { setToken(null); void refresh().then(() => nav('/world', { replace: true })); }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="login">
      <div className="login-hero">
        <h1>AI Sana · Task Plaza</h1>
        <p>Businesses turn a short problem description into a clear task card. Student teams walk around a 3D campus, find task buildings and submit applications.</p>
        <p className="muted small">Sign in with a code. Demo profile codes are in the local file <code>backend/demo-accounts.local.json</code>; members of one team share a code. Each tab can sign in with its own role.</p>
      </div>
      <div className="login-cols">
        <section className="panel">
          <h2>Sign in with a code</h2>
          <form className="form" onSubmit={(e) => { e.preventDefault(); void enter(code); }}>
            <label>Login code<input value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" placeholder="business or team code" /></label>
            <FieldError field="code" />
            <label>Your name in the 3D world <small className="muted">(for team members, optional)</small><input value={name} maxLength={24} onChange={(e) => setName(e.target.value)} placeholder="e.g. Ayan" /></label>
            <div className="row"><button className="btn" type="submit" disabled={busy || !code.trim()}>Sign in</button>
              <button className="btn ghost" type="button" onClick={async () => { setToken(null); await refresh(); nav('/world'); }}>Guest — view only</button></div>
          </form>
        </section>
        <section className="panel">
          <h2>New team</h2>
          {created ? (
            <div className="alert">
              <b>Team created. The login code is shown only once — save it:</b>
              <pre>{created}</pre>
              <p className="small">Other members sign in with this same code.</p>
              <button className="btn" onClick={() => nav('/world')}>To the 3D world</button>
            </div>
          ) : (
            <form className="form" onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              // No automatic retry: the server creates a new team on every request.
              const r = await run(() => api.createTeam({ name: team.name, color: team.color }));
              setBusy(false);
              if (!r) return;
              setWorldName(name);
              setToken(r.data.token);
              setCreated(r.data.code);
              await refresh();
            }}>
              <label>Team name<input value={team.name} maxLength={100} onChange={(e) => setTeam({ ...team, name: e.target.value })} /></label>
              <FieldError field="name" />
              <div className="row wrap" role="radiogroup" aria-label="Team color">
                {COLORS.map((c) => <button key={c} type="button" className={`swatch ${team.color === c ? 'on' : ''}`} style={{ background: c }} aria-label={c} aria-pressed={team.color === c} onClick={() => setTeam({ ...team, color: c })} />)}
              </div>
              <label>Your name in the 3D world<input value={name} maxLength={24} onChange={(e) => setName(e.target.value)} /></label>
              <button className="btn accent" type="submit" disabled={busy || !team.name.trim()}>Create team</button>
            </form>
          )}
        </section>
      </div>
    </div>
  );
}
