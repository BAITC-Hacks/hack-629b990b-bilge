// Карточка задачи с теми же данными и действиями в 3D и 2D (FR-10): просмотр, отклик команды, этап (P1).
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useApp } from '../state';
import type { PublicTask } from '../shared/types';
import { CardView, FieldError, LevelBadge, ScoreBreakdown, TaskMeta } from './common';

const STATUS: Record<string, string> = { pending: 'На рассмотрении', selected: 'Команда выбрана', rejected: 'Отклонено' };
const MS_STATUS: Record<string, string> = { planned: 'Запланирован', in_review: 'Ожидает проверки бизнеса', rework: 'Возвращён на доработку', approved: 'Этап подтверждён' };

export function TaskPanel({ task, onClose, compact }: { task: PublicTask; onClose?: () => void; compact?: boolean }) {
  const { snap, run } = useApp();
  const me = snap?.me;
  const [tab, setTab] = useState<'card' | 'score'>('card');
  const myProposals = snap?.ownProposals.filter((p) => p.taskId === task.id && me?.role === 'team') ?? [];
  const selected = myProposals.some((p) => p.status === 'selected');
  const myMilestone = snap?.milestones.find((m) => m.taskId === task.id && m.teamId === me?.teamId);

  const [form, setForm] = useState({ idea: '', plan: '', estimatedTime: '', prototypeUrl: '' });
  const [ms, setMs] = useState({ title: '', acceptanceCriteria: '' });
  const [ev, setEv] = useState({ evidenceUrl: '', evidenceNote: '' });

  return (
    <div className={`task-panel ${compact ? 'compact' : ''}`}>
      {onClose && <button className="panel-close" onClick={onClose} aria-label="Закрыть карточку">×</button>}
      <div className="kicker">Задача</div>
      <h2>{task.title}</h2>
      <div className="row wrap"><LevelBadge score={task.score} />{task.score.levelKey === 'draft' && <span className="badge lvl-draft">Нужны уточнения</span>}</div>
      <TaskMeta task={task} />
      {task.selectedTeams.length > 0 && (
        <div className="progress-teams">
          {task.selectedTeams.map((t) => (
            <span key={t.id} className="team-progress"><i style={{ background: t.color }} />{t.name}: этапов подтверждено {t.approvedMilestones}</span>
          ))}
        </div>
      )}

      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'card'} className={tab === 'card' ? 'on' : ''} onClick={() => setTab('card')}>Карточка</button>
        <button role="tab" aria-selected={tab === 'score'} className={tab === 'score' ? 'on' : ''} onClick={() => setTab('score')}>Почему {task.score.total} баллов</button>
      </div>
      {tab === 'card' ? <CardView card={task.card} /> : <ScoreBreakdown score={task.score} />}

      <section className="panel-section" id="proposal">
        <h3>Предложение команды</h3>
        {!me && <p className="muted">Гость видит задачи, но для отклика нужен командный профиль. <Link to="/login">Войти командой</Link></p>}
        {me?.role === 'business' && <p className="muted">Отклики отправляют студенческие команды.</p>}
        {me?.role === 'team' && (
          <>
            {myProposals.map((p) => (
              <div key={p.id} className={`my-prop st-${p.status}`}>Ваш отклик: <b>{STATUS[p.status]}</b> · {p.estimatedTime}</div>
            ))}
            <form
              className="form"
              onSubmit={async (e) => {
                e.preventDefault();
                const ok = await run(() => api.createProposal(task.id, form), 'Предложение отправлено');
                if (ok !== undefined) setForm({ idea: '', plan: '', estimatedTime: '', prototypeUrl: '' });
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
                <button className="btn" type="submit">Отправить предложение</button>
                <button className="btn ghost" type="button" onClick={() => setForm({ idea: 'Соберём дашборд по данным задачи и проверим гипотезы вместе с бизнесом.', plan: 'Неделя 1: разбор данных; 2–4: прототип; 5: проверка с бизнесом; 6: отчёт.', estimatedTime: '6 недель', prototypeUrl: 'https://github.com/example/prototype' })}>Заполнить пример</button>
              </div>
              <p className="muted small">Низкий рейтинг задачи не мешает отклику. Число откликов не ограничено. Команду выбирает только бизнес.</p>
            </form>
          </>
        )}
      </section>

      {me?.role === 'team' && selected && (
        <section className="panel-section">
          <h3>Этап работы</h3>
          {!myMilestone && (
            <form className="form" onSubmit={async (e) => { e.preventDefault(); await run(() => api.createMilestone(task.id, ms), 'Этап создан'); }}>
              <label>Что сделаете в этапе<input value={ms.title} onChange={(e) => setMs({ ...ms, title: e.target.value })} /></label>
              <FieldError field="title" />
              <label>Критерий приёмки<input value={ms.acceptanceCriteria} onChange={(e) => setMs({ ...ms, acceptanceCriteria: e.target.value })} /></label>
              <FieldError field="acceptanceCriteria" />
              <button className="btn" type="submit">Создать этап (10 очков после подтверждения бизнесом)</button>
            </form>
          )}
          {myMilestone && (
            <div className="milestone">
              <div><b>{myMilestone.title}</b> — <span className={`badge ms-${myMilestone.status}`}>{MS_STATUS[myMilestone.status]}</span></div>
              <div className="muted small">Критерий: {myMilestone.acceptanceCriteria}</div>
              {myMilestone.aiSummary && <div className="ai-note">Предварительный комментарий: {myMilestone.aiSummary}</div>}
              {(myMilestone.status === 'planned' || myMilestone.status === 'rework') && (
                <form className="form" onSubmit={async (e) => { e.preventDefault(); await run(() => api.submitEvidence(myMilestone.id, ev), 'Отправлено на проверку'); }}>
                  <label>Ссылка на репозиторий или PR<input value={ev.evidenceUrl} placeholder="https://github.com/…/pull/1" onChange={(e) => setEv({ ...ev, evidenceUrl: e.target.value })} /></label>
                  <FieldError field="evidenceUrl" />
                  <label>Что сделано<textarea rows={2} value={ev.evidenceNote} onChange={(e) => setEv({ ...ev, evidenceNote: e.target.value })} /></label>
                  <FieldError field="evidenceNote" />
                  <button className="btn" type="submit">Отправить на проверку</button>
                  <p className="muted small">Ссылка и комментарий ИИ не начисляют очков — только подтверждение бизнеса.</p>
                </form>
              )}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
