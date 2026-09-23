// Dashboard for the current role (GET /dashboard): business — own tasks and the next step; team — applications, selection and milestones.
import { useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, type DashboardView } from '../api';
import { useApp } from '../state';
import { FieldError, Header, LevelBadge } from '../components/common';

export function Dashboard() {
  const { snap } = useApp();
  const d = snap?.dashboard;
  return (
    <>
      <Header />
      <main className="page">
        {!d && <p className="muted">Sign in to open your dashboard. <Link to="/login">Sign in</Link></p>}
        {d?.screen === 'business-dashboard' && <BusinessDashboard d={d} />}
        {d?.screen === 'team-dashboard' && <TeamDashboard d={d} />}
      </main>
    </>
  );
}

type Biz = Extract<DashboardView, { screen: 'business-dashboard' }>;
type TeamD = Extract<DashboardView, { screen: 'team-dashboard' }>;

function BusinessDashboard({ d }: { d: Biz }) {
  const { run } = useApp();
  const nav = useNavigate();
  const [form, setForm] = useState({ rawDescription: '', title: '', industry: '' });
  const [busy, setBusy] = useState(false);
  const key = useRef(crypto.randomUUID());
  const go = (id: string, taskId: string) => nav(id === 'review' ? `/business/tasks/${taskId}/review` : `/business/tasks/${taskId}`);
  return (
    <div className="grid2 top">
      <section className="panel">
        <h2>Describe a new task</h2>
        <form className="form" onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          const input = { rawDescription: form.rawDescription, ...(form.title.trim() ? { title: form.title } : {}), ...(form.industry.trim() ? { industry: form.industry } : {}) };
          const r = await run(() => api.startTask(input, { idempotencyKey: key.current }));
          setBusy(false);
          if (r) { key.current = crypto.randomUUID(); nav(`/business/tasks/${r.data.task.id}`); }
        }}>
          <label>What is happening and what do you want to change<textarea rows={4} value={form.rawDescription} onChange={(e) => setForm({ ...form, rawDescription: e.target.value })} placeholder="For example: every evening our cafe has unsold dishes left over…" /></label>
          <FieldError field="rawDescription" />
          <div className="grid2">
            <label>Title (optional for now)<input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></label>
            <label>Industry (optional for now)<input value={form.industry} onChange={(e) => setForm({ ...form, industry: e.target.value })} placeholder="Food service, Retail, IT…" /></label>
          </div>
          <button className="btn" type="submit" disabled={busy || !form.rawDescription.trim()}>Save description</button>
          <p className="muted small">Next, AI will help break down the description and ask clarifying questions. The official score changes only after you confirm.</p>
        </form>
      </section>
      <section className="panel">
        <h2>My tasks</h2>
        {d.tasks.length === 0 && <p className="muted">No tasks yet.</p>}
        <ul className="catalog">
          {d.tasks.map((t) => (
            <li key={t.id} className={`citem ${'lvl-' + t.readiness.level}`}>
              <div className="cbody">
                <b>{t.title || 'Untitled'}</b>
                <span className="row wrap small">
                  <LevelBadge value={t.readiness.value} level={t.readiness.level} label={t.readiness.label} />
                  <span className={`badge ${t.publicationStatus === 'published' ? 'pub' : ''}`}>{t.publicationStatus === 'published' ? 'Published' : 'Draft'}</span>
                  {t.hasUnconfirmedChanges && <span className="badge pending">Unconfirmed edits</span>}
                  {t.pendingProposals > 0 && <span className="badge">New applications: {t.pendingProposals}</span>}
                  {t.pendingReviews > 0 && <span className="badge pending">In review: {t.pendingReviews}</span>}
                </span>
                <span className="muted small">{t.nextAction.hint}</span>
              </div>
              <button className="btn small" onClick={() => go(t.nextAction.id, t.nextAction.taskId)}>{t.nextAction.label}</button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function TeamDashboard({ d }: { d: TeamD }) {
  const nav = useNavigate();
  const act = (a: { id: string; taskId: string; milestoneId: string | null }) =>
    nav(a.id === 'open_milestone' && a.milestoneId ? `/milestones/${a.milestoneId}` : a.id === 'open_dashboard' ? '/dashboard' : `/tasks/${a.taskId}`);
  return (
    <>
      <div className="page-head">
        <div><div className="kicker">Team dashboard</div><h1 className="row"><i className="team-dot" style={{ background: d.team.color }} />{d.team.name}</h1></div>
        <div className="row"><span className="pts big">★ {d.team.confirmedPoints}</span><Link className="btn" to="/world">To the 3D world</Link></div>
      </div>
      <div className="grid2 top">
        <section className="panel">
          <h2>Selected tasks</h2>
          {d.selectedTasks.length === 0 && <p className="muted">When a business selects your application, the task will appear here.</p>}
          {d.selectedTasks.map((t) => (
            <div key={t.id} className="prop st-selected">
              <b>{t.title}</b>
              <div className="muted small">{t.nextAction.hint}</div>
              <button className="btn small" onClick={() => act(t.nextAction)}>{t.nextAction.label}</button>
            </div>
          ))}
          <h2>Milestones</h2>
          {d.milestones.length === 0 && <p className="muted">No milestones yet.</p>}
          {d.milestones.map((m) => (
            <div key={m.id} className="milestone">
              <Link to={`/milestones/${m.id}`}><b>{m.title}</b></Link> — <span className={`badge ms-${m.status}`}>{m.statusLabel}</span>
              <div className="muted small">{m.statusHint}</div>
            </div>
          ))}
        </section>
        <section className="panel">
          <h2>My applications</h2>
          {d.proposals.length === 0 && <p className="muted">No applications yet. <Link to="/world">Find a task in the world</Link> or in the <Link to="/list">catalog</Link>.</p>}
          {d.proposals.map((p) => (
            <div key={p.id} className={`prop st-${p.status}`}>
              <Link to={`/tasks/${p.taskId}`}><b>{p.taskTitle}</b></Link> · <span className={`badge st-${p.status}`}>{p.statusLabel}</span>
              <div className="muted small">{p.statusHint}</div>
              {p.decisionNote && <div className="small">Business comment: {p.decisionNote}</div>}
            </div>
          ))}
        </section>
      </div>
    </>
  );
}
