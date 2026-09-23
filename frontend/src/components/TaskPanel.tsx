// Published task card (GET /tasks/:id) — identical in 2D and in the 3D world's side panel.
// Participation status, next action and button availability come from the BFF (participation, actions).
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, type DetailView } from '../api';
import { useApp } from '../state';
import { CardView, FieldError, LevelBadge, ScoreBreakdown } from './common';

export function TaskPanel({ taskId, onClose }: { taskId: string; onClose?: () => void }) {
  const { run, revision, snap } = useApp();
  const nav = useNavigate();
  const [detail, setDetail] = useState<DetailView | null>(null);
  const [missing, setMissing] = useState(false);
  const [tab, setTab] = useState<'card' | 'score'>('card');
  const [form, setForm] = useState({ idea: '', plan: '', estimatedTime: '', prototypeUrl: '' });
  const [ms, setMs] = useState({ title: '', acceptanceCriteria: '' });
  const [busy, setBusy] = useState(false);
  // The idempotency key is kept until sent: a retry after a lost response won't create a second application.
  const proposeKey = useRef(crypto.randomUUID());
  const milestoneKey = useRef(crypto.randomUUID());
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    let alive = true;
    api.task(taskId).then((r) => { if (alive) { setDetail(r.data); setMissing(false); } }).catch(() => { if (alive) setMissing(true); });
    return () => { alive = false; };
  }, [taskId, revision]);

  if (missing) return <div className="task-panel">{onClose && <button className="panel-close" onClick={onClose} aria-label="Close">×</button>}<p>Task not found or unpublished.</p></div>;
  if (!detail) return <div className="task-panel"><p className="muted">Loading card…</p></div>;

  const actor = snap?.bootstrap.actor ?? null;
  const c = detail.card;
  const p = detail.participation;
  const canPropose = detail.actions.find((a) => a.id === 'propose');
  const isOwner = detail.actions.some((a) => a.id === 'review');

  const doAction = (id: string, milestoneId?: string | null) => {
    if (id === 'propose') formRef.current?.scrollIntoView({ behavior: 'smooth' });
    else if (id === 'open_dashboard') nav('/dashboard');
    else if (id === 'open_milestone' && milestoneId) nav(`/milestones/${milestoneId}`);
    else if (id === 'create_milestone') document.getElementById('milestone-form')?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <div className="task-panel">
      {onClose && <button className="panel-close" onClick={onClose} aria-label="Close card">×</button>}
      <div className="kicker">Task · {c.industry}</div>
      <h2>{c.title}</h2>
      <div className="row wrap">
        <LevelBadge value={c.readinessScore} level={c.readinessLevel} label={c.readinessLabel} />
        {c.needsClarification && <span className="badge lvl-draft">Needs clarification</span>}
        {c.pendingMilestones > 0 && <span className="badge pending">Milestone in review</span>}
      </div>
      <div className="task-meta"><span>Applications: {c.offersCount}</span>{c.approvedMilestones > 0 && <span>Confirmed milestones: {c.approvedMilestones}</span>}</div>
      {detail.teamProgress.length > 0 && (
        <div className="progress-teams">
          {detail.teamProgress.map((t) => {
            const color = c.selectedTeams.find((s) => s.id === t.teamId)?.color;
            return <span key={t.teamId} className="team-progress"><i style={{ background: color }} />{t.name}: {t.statusLabel}</span>;
          })}
        </div>
      )}

      {p && (
        <div className={`participation st-${p.status}`}>
          <b>{p.statusLabel}</b>
          <div className="muted small">{p.statusHint}</div>
          {p.nextAction.id !== 'propose' && <button className="btn small" onClick={() => doAction(p.nextAction.id, p.nextAction.milestoneId)}>{p.nextAction.label}</button>}
        </div>
      )}
      {isOwner && (
        <div className="drawer-cta">This is your task.
          <span className="row"><Link className="btn small ghost" to={`/business/tasks/${c.id}`}>Improve card</Link><Link className="btn small" to={`/business/tasks/${c.id}/review`}>Compare applications</Link></span>
        </div>
      )}

      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'card'} className={tab === 'card' ? 'on' : ''} onClick={() => setTab('card')}>Card</button>
        <button role="tab" aria-selected={tab === 'score'} className={tab === 'score' ? 'on' : ''} onClick={() => setTab('score')}>Why {c.readinessScore} points</button>
      </div>
      {tab === 'card' ? <CardView fields={c.fields} /> : <ScoreBreakdown score={c.score} />}

      <section className="panel-section" id="proposal">
        <h3>Team application</h3>
        {!actor && <p className="muted">Guests can view tasks; sign in with a team code to apply. <Link to="/login">Sign in</Link></p>}
        {actor?.role === 'business' && !isOwner && <p className="muted">Applications are submitted by student teams.</p>}
        {detail.myProposals.map((mp) => (
          <div key={mp.id} className={`my-prop st-${mp.status}`}>
            <b>{mp.statusLabel}</b> · {mp.estimatedTime}
            <div className="muted small">{mp.statusHint}</div>
            {mp.decisionNote && <div className="small">Business comment: {mp.decisionNote}</div>}
          </div>
        ))}
        {actor?.role === 'team' && canPropose && (
          <form
            ref={formRef}
            className="form"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              const r = await run(() => api.propose(taskId, form, { idempotencyKey: proposeKey.current }));
              setBusy(false);
              if (r) { setDetail(r.data); setForm({ idea: '', plan: '', estimatedTime: '', prototypeUrl: '' }); proposeKey.current = crypto.randomUUID(); }
            }}
          >
            <label>Solution idea<textarea rows={2} value={form.idea} onChange={(e) => setForm({ ...form, idea: e.target.value })} /></label>
            <FieldError field="idea" />
            <label>Plan<textarea rows={2} value={form.plan} onChange={(e) => setForm({ ...form, plan: e.target.value })} /></label>
            <FieldError field="plan" />
            <div className="grid2">
              <label>Timeline<input value={form.estimatedTime} placeholder="e.g. 6 weeks" onChange={(e) => setForm({ ...form, estimatedTime: e.target.value })} /></label>
              <label>Prototype link<input value={form.prototypeUrl} placeholder="https://…" onChange={(e) => setForm({ ...form, prototypeUrl: e.target.value })} /></label>
            </div>
            <FieldError field="estimatedTime" />
            <FieldError field="prototypeUrl" />
            <div className="row">
              <button className="btn" type="submit" disabled={busy}>{canPropose.label}</button>
            </div>
            <p className="muted small">A low task score doesn't prevent applying. Only the business selects the team.</p>
          </form>
        )}
      </section>

      {p?.nextAction.id === 'create_milestone' && (
        <section className="panel-section" id="milestone-form">
          <h3>Work milestone</h3>
          <form className="form" onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            const r = await run(() => api.createMilestone(taskId, ms, { idempotencyKey: milestoneKey.current }));
            setBusy(false);
            if (r) { milestoneKey.current = crypto.randomUUID(); nav(`/milestones/${r.data.milestone.id}`); }
          }}>
            <label>What you'll deliver in this milestone<input value={ms.title} onChange={(e) => setMs({ ...ms, title: e.target.value })} /></label>
            <FieldError field="title" />
            <label>Acceptance criterion<textarea rows={2} value={ms.acceptanceCriteria} onChange={(e) => setMs({ ...ms, acceptanceCriteria: e.target.value })} /></label>
            <FieldError field="acceptanceCriteria" />
            <button className="btn" type="submit" disabled={busy}>Create milestone (10 points after business confirmation)</button>
          </form>
        </section>
      )}
    </div>
  );
}
