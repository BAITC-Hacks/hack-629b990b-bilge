// Карточка опубликованной задачи (GET /tasks/:id) — одинаково в 2D и в боковой панели 3D-мира.
// Статус участия, следующее действие и доступность кнопок приходят от BFF (participation, actions).
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
  // Ключ идемпотентности сохраняется до отправки: повтор после потери ответа не создаст второй отклик.
  const proposeKey = useRef(crypto.randomUUID());
  const milestoneKey = useRef(crypto.randomUUID());
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    let alive = true;
    api.task(taskId).then((r) => { if (alive) { setDetail(r.data); setMissing(false); } }).catch(() => { if (alive) setMissing(true); });
    return () => { alive = false; };
  }, [taskId, revision]);

  if (missing) return <div className="task-panel">{onClose && <button className="panel-close" onClick={onClose} aria-label="Закрыть">×</button>}<p>Задача не найдена или снята с публикации.</p></div>;
  if (!detail) return <div className="task-panel"><p className="muted">Загрузка карточки…</p></div>;

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
      {onClose && <button className="panel-close" onClick={onClose} aria-label="Закрыть карточку">×</button>}
      <div className="kicker">Задача · {c.industry}</div>
      <h2>{c.title}</h2>
      <div className="row wrap">
        <LevelBadge value={c.readinessScore} level={c.readinessLevel} label={c.readinessLabel} />
        {c.needsClarification && <span className="badge lvl-draft">Нужны уточнения</span>}
        {c.pendingMilestones > 0 && <span className="badge pending">Этап на проверке</span>}
      </div>
      <div className="task-meta"><span>Предложений: {c.offersCount}</span>{c.approvedMilestones > 0 && <span>Подтверждённых этапов: {c.approvedMilestones}</span>}</div>
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
        <div className="drawer-cta">Это ваша задача.
          <span className="row"><Link className="btn small ghost" to={`/business/tasks/${c.id}`}>Улучшить карточку</Link><Link className="btn small" to={`/business/tasks/${c.id}/review`}>Сравнить отклики</Link></span>
        </div>
      )}

      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'card'} className={tab === 'card' ? 'on' : ''} onClick={() => setTab('card')}>Карточка</button>
        <button role="tab" aria-selected={tab === 'score'} className={tab === 'score' ? 'on' : ''} onClick={() => setTab('score')}>Почему {c.readinessScore} баллов</button>
      </div>
      {tab === 'card' ? <CardView fields={c.fields} /> : <ScoreBreakdown score={c.score} />}

      <section className="panel-section" id="proposal">
        <h3>Предложение команды</h3>
        {!actor && <p className="muted">Гость видит задачи; для отклика войдите кодом команды. <Link to="/login">Войти</Link></p>}
        {actor?.role === 'business' && !isOwner && <p className="muted">Отклики отправляют студенческие команды.</p>}
        {detail.myProposals.map((mp) => (
          <div key={mp.id} className={`my-prop st-${mp.status}`}>
            <b>{mp.statusLabel}</b> · {mp.estimatedTime}
            <div className="muted small">{mp.statusHint}</div>
            {mp.decisionNote && <div className="small">Комментарий бизнеса: {mp.decisionNote}</div>}
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
            <label>Идея решения<textarea rows={2} value={form.idea} onChange={(e) => setForm({ ...form, idea: e.target.value })} /></label>
            <FieldError field="idea" />
            <label>План<textarea rows={2} value={form.plan} onChange={(e) => setForm({ ...form, plan: e.target.value })} /></label>
            <FieldError field="plan" />
            <div className="grid2">
              <label>Срок<input value={form.estimatedTime} placeholder="например, 6 недель" onChange={(e) => setForm({ ...form, estimatedTime: e.target.value })} /></label>
              <label>Ссылка на прототип<input value={form.prototypeUrl} placeholder="https://…" onChange={(e) => setForm({ ...form, prototypeUrl: e.target.value })} /></label>
            </div>
            <FieldError field="estimatedTime" />
            <FieldError field="prototypeUrl" />
            <div className="row">
              <button className="btn" type="submit" disabled={busy}>{canPropose.label}</button>
            </div>
            <p className="muted small">Низкий рейтинг задачи не мешает отклику. Команду выбирает только бизнес.</p>
          </form>
        )}
      </section>

      {p?.nextAction.id === 'create_milestone' && (
        <section className="panel-section" id="milestone-form">
          <h3>Этап работы</h3>
          <form className="form" onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            const r = await run(() => api.createMilestone(taskId, ms, { idempotencyKey: milestoneKey.current }));
            setBusy(false);
            if (r) { milestoneKey.current = crypto.randomUUID(); nav(`/milestones/${r.data.milestone.id}`); }
          }}>
            <label>Что сделаете в этапе<input value={ms.title} onChange={(e) => setMs({ ...ms, title: e.target.value })} /></label>
            <FieldError field="title" />
            <label>Критерий приёмки<textarea rows={2} value={ms.acceptanceCriteria} onChange={(e) => setMs({ ...ms, acceptanceCriteria: e.target.value })} /></label>
            <FieldError field="acceptanceCriteria" />
            <button className="btn" type="submit" disabled={busy}>Создать этап (10 очков после подтверждения бизнесом)</button>
          </form>
        </section>
      )}
    </div>
  );
}
