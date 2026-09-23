import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useApp } from '../state';
import { FieldError, Header, LevelBadge } from '../components/common';

export function BusinessHome() {
  const { snap, run } = useApp();
  const nav = useNavigate();
  const [raw, setRaw] = useState('');
  const [industry, setIndustry] = useState('HoReCa');
  if (!snap) return null;
  const pendingByTask = (id: string) => snap.ownProposals.filter((p) => p.taskId === id && p.status === 'pending').length;
  const reviewByTask = (id: string) => snap.milestones.filter((m) => m.taskId === id && m.status === 'in_review').length;
  return (
    <>
      <Header />
      <main className="page">
        <h1>{snap.me?.companyName}</h1>
        <div className="grid2 top">
          <section className="panel">
            <h2>Новая задача</h2>
            <p className="muted">Опишите проблему своими словами — ИИ найдёт пробелы и задаст уточняющие вопросы.</p>
            <form
              className="form"
              onSubmit={async (e) => {
                e.preventDefault();
                const id = await run(() => api.createTask(raw, industry), 'Черновик сохранён');
                if (id) nav(`/business/tasks/${id}`);
              }}
            >
              <label>Описание<textarea rows={3} value={raw} onChange={(e) => setRaw(e.target.value)} placeholder="Например: в кафе остаётся много непроданной еды." /></label>
              <FieldError field="rawDescription" />
              <label>Отрасль<select value={industry} onChange={(e) => setIndustry(e.target.value)}>{snap.industries.map((i) => <option key={i}>{i}</option>)}</select></label>
              <div className="row">
                <button className="btn" type="submit">Создать черновик</button>
                <button className="btn ghost" type="button" onClick={() => { setRaw(api.demoExample.raw); setIndustry(api.demoExample.industry); }}>Пример: кафе</button>
              </div>
            </form>
          </section>
          <section className="panel">
            <h2>Два вида баллов</h2>
            <p><b className="teal">Готовность задачи 0–100</b> — за заполненные и подтверждённые вами сведения. Влияет на уровень, место в каталоге и вид павильона на 3D-площади.</p>
            <p><b className="amber">Очки прогресса команды</b> — только за этап работы, который подтвердили вы. К готовности задачи не прибавляются.</p>
          </section>
        </div>
        <section className="panel">
          <h2>Мои задачи</h2>
          <table className="tbl">
            <thead><tr><th>Задача</th><th>Статус</th><th>Готовность (официальная)</th><th>Отклики</th></tr></thead>
            <tbody>
              {snap.ownTasks.map((t) => (
                <tr key={t.id} onClick={() => nav(`/business/tasks/${t.id}`)} className="clickable">
                  <td><Link to={`/business/tasks/${t.id}`}>{t.confirmed?.title || t.draft.title || t.rawDescription.slice(0, 60)}</Link><div className="muted small">{t.industry}</div></td>
                  <td>{t.publicationStatus === 'published' ? <span className="badge pub">Опубликована</span> : <span className="badge">Черновик, не в каталоге</span>}{t.draftDirty && t.confirmed && <div className="muted small">есть неподтверждённые правки</div>}</td>
                  <td>{t.score ? <LevelBadge score={t.score} /> : <span className="muted">не подтверждена</span>}</td>
                  <td>{snap.ownProposals.filter((p) => p.taskId === t.id).length}{pendingByTask(t.id) > 0 && <span className="badge pending">{pendingByTask(t.id)} новых</span>}{reviewByTask(t.id) > 0 && <span className="badge pending">этап на проверке</span>}</td>
                </tr>
              ))}
              {snap.ownTasks.length === 0 && <tr><td colSpan={4} className="muted">Задач пока нет — создайте первую.</td></tr>}
            </tbody>
          </table>
        </section>
      </main>
    </>
  );
}
