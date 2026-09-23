// Этап (GET /milestones/:id): команда отправляет ссылку на Git/PR, бизнес подтверждает (+10 один раз) или возвращает.
// Материалы Git и комментарии ИИ — предварительные сведения; решение принимает человек. Текст материалов — недоверенный, без HTML.
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, type MilestoneView } from '../api';
import { useApp } from '../state';
import { FieldError, Header } from '../components/common';

export function MilestonePage() {
  const { id = '' } = useParams();
  const { run, revision } = useApp();
  const [view, setView] = useState<MilestoneView | null>(null);
  const [ev, setEv] = useState({ evidenceUrl: '', description: '' });
  const [feedback, setFeedback] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { void run(() => api.milestone(id)).then((r) => r && setView(r.data)); }, [id, revision]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!view) return <><Header /><main className="page"><p className="muted">Загрузка этапа…</p></main></>;
  const m = view.milestone;
  const act = (aid: string) => m.actions.find((a) => a.id === aid);
  const submit = act('submit_evidence');
  const approve = act('approve');
  const ret = act('return');
  const decide = async (decision: 'approve' | 'return') => {
    setBusy(true);
    const r = await run(() => api.decideMilestone(m.id, { expectedVersion: m.version, decision, feedback }));
    setBusy(false);
    if (r) { setView(r.data); setFeedback(''); }
  };
  return (
    <>
      <Header />
      <main className="page narrow">
        <div className="kicker"><Link to={`/tasks/${m.taskId}`}>Карточка задачи</Link> · Этап команды {m.teamName}</div>
        <h1>{m.title}</h1>
        <div className="row wrap"><span className={`badge ms-${m.status}`}>{m.statusLabel}</span><span className="muted">{m.statusHint}</span></div>
        <section className="panel">
          <h3>Критерий приёмки</h3>
          <p style={{ whiteSpace: 'pre-wrap' }}>{m.acceptanceCriteria}</p>
          {m.previousFeedback && <div className="alert"><b>Последние замечания бизнеса:</b> {m.previousFeedback}</div>}
          {m.reviewNotice && <div className="ai-note">{m.reviewNotice.message}</div>}
        </section>

        {m.evidence && (
          <section className="panel">
            <h3>Результат команды</h3>
            <p><a href={m.evidenceUrl} target="_blank" rel="noreferrer noopener">{m.evidenceUrl}</a></p>
            <p style={{ whiteSpace: 'pre-wrap' }}>{m.description}</p>
            <div className="small muted">Проверка ссылки: {m.evidence.provider} · {m.evidence.status}{m.evidence.warning ? ` — ${m.evidence.warning}` : ''}</div>
            {m.evidence.facts.length > 0 && <ul className="small">{m.evidence.facts.map((f, i) => <li key={i}>{f}</li>)}</ul>}
            {m.evidence.snapshot && (
              <details><summary>Прочитанные материалы ({m.evidence.snapshot.files.length}, покрытие: {m.evidence.snapshot.coverage})</summary>
                {m.evidence.snapshot.warnings.map((w, i) => <div key={i} className="alert small">{w}</div>)}
                {m.evidence.snapshot.files.map((f) => (
                  <div key={f.id}><div className="small"><b>{f.path}</b> ({f.kind}{f.truncated ? ', усечено' : ''}) · <a href={f.sourceUrl} target="_blank" rel="noreferrer noopener">источник</a></div><pre>{f.content}</pre></div>
                ))}
              </details>
            )}
            {m.review && (
              <div className="ai-note">
                <b>Предварительный комментарий ИИ{m.review.mode === 'stub' ? ' (ручная проверка)' : ''}:</b> {m.review.summary}
                {m.review.warning && <div className="small">{m.review.warning}</div>}
                {m.review.checks.length > 0 && <ul className="small">{m.review.checks.map((c, i) => <li key={i}>{c}</li>)}</ul>}
                {m.review.criterionEvidence?.map((ce, i) => (
                  <div key={i} className="small"><b>{ce.criterion}</b> — {ce.status === 'materials_found' ? 'найдены материалы' : ce.status === 'insufficient_evidence' ? 'недостаточно материалов' : 'не оценивался'}
                    {ce.citations.map((q, k) => <blockquote key={k}>«{q.quote}» — <a href={q.sourceUrl} target="_blank" rel="noreferrer noopener">{q.path}</a></blockquote>)}
                    <div className="muted">{ce.nextStep}</div>
                  </div>
                ))}
                <div className="small muted">Цитата не доказывает выполнение критерия. Решение принимает бизнес.</div>
              </div>
            )}
          </section>
        )}

        {submit && (
          <section className="panel">
            <h3>Отправить на проверку</h3>
            <form className="form" onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              const r = await run(() => api.submitEvidence(m.id, { expectedVersion: m.version, ...ev }));
              setBusy(false);
              if (r) setView(r.data);
            }}>
              <label>Ссылка на репозиторий или PR<input value={ev.evidenceUrl} placeholder="https://github.com/…/pull/1" onChange={(e) => setEv({ ...ev, evidenceUrl: e.target.value })} /></label>
              <FieldError field="evidenceUrl" />
              <label>Что сделано<textarea rows={3} value={ev.description} onChange={(e) => setEv({ ...ev, description: e.target.value })} /></label>
              <FieldError field="description" />
              <button className="btn" type="submit" disabled={busy || !submit.enabled} title={submit.reason ?? ''}>{busy ? 'Проверяем ссылку…' : submit.label}</button>
              <p className="muted small">Проверка Git и ИИ может занять до 45 секунд. Ссылка и комментарий ИИ очков не дают — только подтверждение бизнеса.</p>
            </form>
          </section>
        )}

        {(approve || ret) && (
          <section className="panel">
            <h3>Решение по результату</h3>
            <label>Замечания команде (обязательно при возврате)<textarea rows={2} value={feedback} onChange={(e) => setFeedback(e.target.value)} /></label>
            <FieldError field="feedback" />
            <div className="row" style={{ marginTop: 8 }}>
              {approve && <button className="btn" disabled={busy || !approve.enabled} title={approve.reason ?? ''} onClick={() => decide('approve')}>{approve.label}</button>}
              {ret && <button className="btn ghost" disabled={busy || !ret.enabled} title={ret.reason ?? ''} onClick={() => decide('return')}>{ret.label}</button>}
            </div>
            <p className="muted small">Подтверждение начисляет команде ровно 10 очков один раз и запускает GRAND TRIUMPH в 3D-мире.</p>
          </section>
        )}

        {m.reviewHistory.length > 0 && (
          <details className="panel"><summary>История решений ({m.reviewHistory.length})</summary>
            <ul>{m.reviewHistory.map((h, i) => <li key={i}>{h.decision === 'approve' ? 'Подтверждено' : 'Возвращено'}{h.decidedAt ? ` · ${new Date(h.decidedAt).toLocaleString('ru')}` : ''}{h.feedback ? ` — ${h.feedback}` : ''}</li>)}</ul>
          </details>
        )}
      </main>
    </>
  );
}
