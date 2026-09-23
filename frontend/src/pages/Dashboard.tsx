// Кабинет текущей роли (GET /dashboard): бизнес — свои задачи и следующий шаг; команда — отклики, выбор и этапы.
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
        {!d && <p className="muted">Войдите, чтобы открыть кабинет. <Link to="/login">Войти</Link></p>}
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
        <h2>Описать новую задачу</h2>
        <form className="form" onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          const input = { rawDescription: form.rawDescription, ...(form.title.trim() ? { title: form.title } : {}), ...(form.industry.trim() ? { industry: form.industry } : {}) };
          const r = await run(() => api.startTask(input, { idempotencyKey: key.current }));
          setBusy(false);
          if (r) { key.current = crypto.randomUUID(); nav(`/business/tasks/${r.data.task.id}`); }
        }}>
          <label>Что происходит и что хотите изменить<textarea rows={4} value={form.rawDescription} onChange={(e) => setForm({ ...form, rawDescription: e.target.value })} placeholder="Например: каждый вечер в кафе остаются непроданные блюда…" /></label>
          <FieldError field="rawDescription" />
          <div className="grid2">
            <label>Название (можно позже)<input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></label>
            <label>Отрасль (можно позже)<input value={form.industry} onChange={(e) => setForm({ ...form, industry: e.target.value })} placeholder="Общепит, Торговля, IT…" /></label>
          </div>
          <button className="btn" type="submit" disabled={busy || !form.rawDescription.trim()}>Сохранить описание</button>
          <p className="muted small">Дальше ИИ поможет разобрать описание и задаст уточняющие вопросы. Официальный балл меняется только после вашего подтверждения.</p>
        </form>
      </section>
      <section className="panel">
        <h2>Мои задачи</h2>
        {d.tasks.length === 0 && <p className="muted">Задач пока нет.</p>}
        <ul className="catalog">
          {d.tasks.map((t) => (
            <li key={t.id} className={`citem ${'lvl-' + t.readiness.level}`}>
              <div className="cbody">
                <b>{t.title || 'Без названия'}</b>
                <span className="row wrap small">
                  <LevelBadge value={t.readiness.value} level={t.readiness.level} label={t.readiness.label} />
                  <span className={`badge ${t.publicationStatus === 'published' ? 'pub' : ''}`}>{t.publicationStatus === 'published' ? 'Опубликована' : 'Черновик'}</span>
                  {t.hasUnconfirmedChanges && <span className="badge pending">Есть неподтверждённые правки</span>}
                  {t.pendingProposals > 0 && <span className="badge">Новых откликов: {t.pendingProposals}</span>}
                  {t.pendingReviews > 0 && <span className="badge pending">На проверке: {t.pendingReviews}</span>}
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
        <div><div className="kicker">Кабинет команды</div><h1 className="row"><i className="team-dot" style={{ background: d.team.color }} />{d.team.name}</h1></div>
        <div className="row"><span className="pts big">★ {d.team.confirmedPoints}</span><Link className="btn" to="/world">В 3D-мир</Link></div>
      </div>
      <div className="grid2 top">
        <section className="panel">
          <h2>Выбранные задачи</h2>
          {d.selectedTasks.length === 0 && <p className="muted">Когда бизнес выберет ваш отклик, задача появится здесь.</p>}
          {d.selectedTasks.map((t) => (
            <div key={t.id} className="prop st-selected">
              <b>{t.title}</b>
              <div className="muted small">{t.nextAction.hint}</div>
              <button className="btn small" onClick={() => act(t.nextAction)}>{t.nextAction.label}</button>
            </div>
          ))}
          <h2>Этапы</h2>
          {d.milestones.length === 0 && <p className="muted">Этапов пока нет.</p>}
          {d.milestones.map((m) => (
            <div key={m.id} className="milestone">
              <Link to={`/milestones/${m.id}`}><b>{m.title}</b></Link> — <span className={`badge ms-${m.status}`}>{m.statusLabel}</span>
              <div className="muted small">{m.statusHint}</div>
            </div>
          ))}
        </section>
        <section className="panel">
          <h2>Мои отклики</h2>
          {d.proposals.length === 0 && <p className="muted">Откликов пока нет. <Link to="/world">Найдите задачу в мире</Link> или в <Link to="/list">каталоге</Link>.</p>}
          {d.proposals.map((p) => (
            <div key={p.id} className={`prop st-${p.status}`}>
              <Link to={`/tasks/${p.taskId}`}><b>{p.taskTitle}</b></Link> · <span className={`badge st-${p.status}`}>{p.statusLabel}</span>
              <div className="muted small">{p.statusHint}</div>
              {p.decisionNote && <div className="small">Комментарий бизнеса: {p.decisionNote}</div>}
            </div>
          ))}
        </section>
      </div>
    </>
  );
}
