// Конструктор бизнеса: исходный текст → вопросы ИИ по одному → редактируемая карточка →
// «Подтвердить сведения» (официальный балл) → «Опубликовать». Затем отклики и проверка этапов.
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api';
import { useApp } from '../state';
import { CardView, FieldError, Header, LevelBadge, ScoreBreakdown } from '../components/common';
import { calculateScore } from '../shared/scoring';
import { AI_FIELD_LABELS } from '../shared/clarify';
import type { Card } from '../shared/types';

const STATUS: Record<string, string> = { pending: 'На рассмотрении', selected: 'Выбрана', rejected: 'Отклонена' };

export function TaskEditor() {
  const { id } = useParams();
  const { snap, run, toast } = useApp();
  const task = snap?.ownTasks.find((t) => t.id === id);
  const [draft, setDraft] = useState<Card | null>(null);
  const [dirty, setDirty] = useState(false);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [qi, setQi] = useState(0);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(false);

  // Подтягиваем серверную рабочую копию, пока пользователь не начал править (не затираем ввод).
  useEffect(() => {
    if (task && !dirty) setDraft(task.draft);
  }, [task?.draft, dirty]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (task) setAnswers((a) => (Object.keys(a).length ? a : task.answers));
  }, [task?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const forecast = useMemo(() => (draft ? calculateScore(draft) : null), [draft]);
  if (!snap) return null;
  if (!task || !draft || !forecast) return (<><Header /><main className="page"><Link to="/business">← Мои задачи</Link><p>Задача не найдена или принадлежит другой компании.</p></main></>);

  const set = <K extends keyof Card>(k: K, v: Card[K]) => { setDraft({ ...draft, [k]: v }); setDirty(true); };
  const unconfirmed = !task.confirmed || JSON.stringify(task.confirmed) !== JSON.stringify(draft);
  const props = snap.ownProposals.filter((p) => p.taskId === task.id);
  const milestones = snap.milestones.filter((m) => m.taskId === task.id);
  const questions = task.clarify?.questions ?? [];
  const isDemo = task.rawDescription.trim() === api.demoExample.raw;

  async function save() {
    const r = await run(() => api.saveDraft(task!.id, draft!, answers), 'Черновик сохранён');
    if (r !== undefined) setDirty(false);
  }
  async function confirmCard() {
    const saved = await run(() => api.saveDraft(task!.id, draft!, answers));
    if (saved === undefined) return;
    const r = await run(() => api.confirm(task!.id));
    if (r) {
      setDirty(false);
      toast(r.before === null ? `Сведения подтверждены: ${r.after}/100` : `Балл ${r.before} → ${r.after}`, 'ok');
    }
  }

  return (
    <>
      <Header />
      <main className="page editor-page">
        <Link to="/business">← Мои задачи</Link>
        <div className="page-head">
          <div>
            <h1>{task.confirmed?.title || draft.title || 'Новая задача'}</h1>
            <div className="row wrap">
              {task.publicationStatus === 'published' ? <span className="badge pub">Опубликована</span> : <span className="badge">Черновик — в каталоге не виден</span>}
              {task.score ? <LevelBadge score={task.score} /> : <span className="badge">Официальный балл появится после подтверждения</span>}
            </div>
          </div>
        </div>

        <div className="editor-grid">
          <div className="editor-main">
            <section className="panel">
              <h2>1. Исходное описание</h2>
              <blockquote>{task.rawDescription}</blockquote>
            </section>

            <section className="panel">
              <h2>2. Уточнения ИИ</h2>
              {!task.clarify ? (
                <>
                  <p className="muted">ИИ найдёт недостающие сведения и задаст 3–5 вопросов. Он не придумывает факты: ответы пишете вы.</p>
                  <button className="btn" disabled={busy} onClick={async () => { setBusy(true); await run(() => api.clarify(task.id)); setBusy(false); setQi(0); }}>{busy ? 'Анализирую…' : 'Найти пробелы и задать вопросы'}</button>
                </>
              ) : (
                <>
                  <div className="q-progress">Вопрос {Math.min(qi, questions.length - 1) + 1} из {questions.length} · режим: {task.clarify.mode === 'stub' ? 'локальные вопросы (stub)' : 'OpenAI'}</div>
                  {questions[qi] && (
                    <div className="q-card">
                      <div className="q-field">{AI_FIELD_LABELS[questions[qi].field]}</div>
                      <label className="q-text">{questions[qi].text}
                        <textarea rows={3} value={answers[questions[qi].field] ?? ''} onChange={(e) => setAnswers({ ...answers, [questions[qi].field]: e.target.value })} placeholder="Ваш ответ (можно пропустить)" />
                      </label>
                    </div>
                  )}
                  <div className="row wrap">
                    <button className="btn ghost" disabled={qi === 0} onClick={() => setQi(qi - 1)}>← Назад</button>
                    {qi < questions.length - 1 ? (
                      <button className="btn ghost" onClick={() => setQi(qi + 1)}>Следующий вопрос →</button>
                    ) : (
                      <button className="btn" onClick={async () => { setDirty(false); await run(() => api.applyAnswers(task.id, answers), 'Ответы перенесены в карточку — проверьте и подтвердите'); }}>Перенести ответы в карточку</button>
                    )}
                    {isDemo && <button className="btn ghost" onClick={() => setAnswers({ ...api.demoExample.answers })}>Заполнить демо-ответами</button>}
                  </div>
                  <details className="ai-trace">
                    <summary>Как работает ИИ: промпт, вход, выход</summary>
                    {task.clarify.trace.fallbackReason && <p className="muted small">{task.clarify.trace.fallbackReason}</p>}
                    <h4>Инструкция модели</h4><pre>{task.clarify.trace.prompt}</pre>
                    <h4>Вход</h4><pre>{JSON.stringify(task.clarify.trace.input, null, 2)}</pre>
                    <h4>Выход (после проверки схемы)</h4><pre>{JSON.stringify({ missingFields: task.clarify.missingFields, questions: task.clarify.questions }, null, 2)}</pre>
                    <p className="muted small">Некорректный ответ модели (не JSON, неизвестное поле, меньше 3 или больше 5 вопросов, повторы) отклоняется, после 2 попыток используется локальный набор по реально отсутствующим категориям.</p>
                  </details>
                </>
              )}
            </section>

            <section className="panel">
              <div className="row between"><h2>3. Карточка (рабочая копия)</h2><label className="inline"><input type="checkbox" checked={preview} onChange={(e) => setPreview(e.target.checked)} /> глазами студента</label></div>
              {preview ? (
                <div className="student-preview"><LevelBadge score={forecast} /> <span className="muted small">(прогноз)</span><h3>{draft.title}</h3><CardView card={draft} /></div>
              ) : (
                <div className="form card-form">
                  <label>Название<input value={draft.title} maxLength={120} onChange={(e) => set('title', e.target.value)} /></label>
                  <FieldError field="title" />
                  <label>Контекст — что происходит сейчас<textarea rows={2} value={draft.context} onChange={(e) => set('context', e.target.value)} /></label>
                  <label>Потребность — что нужно изменить<textarea rows={2} value={draft.need} onChange={(e) => set('need', e.target.value)} /></label>
                  <label>Пользователи решения<input value={draft.users} onChange={(e) => set('users', e.target.value)} /></label>
                  <fieldset>
                    <legend>Данные и материалы</legend>
                    <div className="radio-row">
                      {([['yes', 'Есть'], ['no', 'Данных нет'], ['unknown', 'Не знаю']] as const).map(([v, l]) => (
                        <label key={v} className="inline"><input type="radio" name="avail" checked={draft.dataAvailability === v} onChange={() => set('dataAvailability', v)} /> {l}</label>
                      ))}
                    </div>
                    <label>Источник, пример или материал{draft.dataAvailability !== 'yes' && <span className="muted small"> — засчитывается, если данные есть</span>}<input value={draft.dataSource} onChange={(e) => set('dataSource', e.target.value)} /></label>
                  </fieldset>
                  <label>Ожидаемый результат работы команды<textarea rows={2} value={draft.expectedResult} onChange={(e) => set('expectedResult', e.target.value)} /></label>
                  <fieldset>
                    <legend>Критерий успеха — показатель с целевым значением или условие приёмки</legend>
                    <div className="grid2">
                      <label>Показатель<input value={draft.successMetric} placeholder="например, списания" onChange={(e) => set('successMetric', e.target.value)} /></label>
                      <label>Целевое значение<input value={draft.successTarget} placeholder="например, −20% за месяц" onChange={(e) => set('successTarget', e.target.value)} /></label>
                    </div>
                    <label>или проверяемое условие приёмки<input value={draft.acceptanceItem} onChange={(e) => set('acceptanceItem', e.target.value)} /></label>
                  </fieldset>
                  <fieldset>
                    <legend>Ограничения</legend>
                    <label className="inline"><input type="checkbox" checked={draft.noKnownConstraints} onChange={(e) => set('noKnownConstraints', e.target.checked)} /> Известных ограничений нет</label>
                    {!draft.noKnownConstraints && <input value={draft.constraints} placeholder="сроки, доступы, технологии" onChange={(e) => set('constraints', e.target.value)} />}
                  </fieldset>
                  <div className="grid2">
                    <label>Канал связи<input value={draft.contactChannel} placeholder="e-mail, телефон, @telegram" onChange={(e) => set('contactChannel', e.target.value)} /></label>
                    <label>Формат консультаций<input value={draft.interactionFormat} onChange={(e) => set('interactionFormat', e.target.value)} /></label>
                  </div>
                </div>
              )}
              {unconfirmed && task.confirmed && <div className="alert">Подтвердите изменения, чтобы обновить балл. До подтверждения каталог показывает действующую версию.</div>}
              <div className="row wrap sticky-actions">
                <button className="btn ghost" onClick={save}>Сохранить черновик</button>
                <button className="btn" onClick={confirmCard}>Подтвердить сведения</button>
                {task.publicationStatus !== 'published' && (
                  <button className="btn accent" disabled={!task.confirmed || dirty} title={!task.confirmed ? 'Сначала подтвердите сведения' : ''} onClick={() => run(() => api.publish(task.id), 'Опубликовано: задача видна всем командам в 2D и 3D')}>Опубликовать</button>
                )}
              </div>
            </section>

            {task.publicationStatus === 'published' && (
              <section className="panel">
                <h2>4. Предложения команд ({props.length})</h2>
                <p className="muted small">Вы решаете по каждому предложению отдельно: можно выбрать одну, несколько или ни одной команды. Система никого не назначает.</p>
                {props.length === 0 && <p className="muted">Предложений пока нет. Задача уже видна командам.</p>}
                {props.map((p) => (
                  <div key={p.id} className={`prop st-${p.status}`}>
                    <div className="row between"><b><i className="dot" style={{ background: p.teamColor }} /> {p.teamName}</b><span className={`badge st-${p.status}`}>{STATUS[p.status]}</span></div>
                    <dl><dt>Идея</dt><dd>{p.idea}</dd><dt>План</dt><dd>{p.plan}</dd><dt>Срок</dt><dd>{p.estimatedTime}</dd><dt>Прототип</dt><dd><a href={p.prototypeUrl} target="_blank" rel="noopener noreferrer">{p.prototypeUrl}</a></dd></dl>
                    <div className="row">
                      <button className="btn small" disabled={p.status === 'selected'} onClick={() => run(() => api.decide(p.id, 'select'), `Команда «${p.teamName}» выбрана`)}>Выбрать</button>
                      <button className="btn ghost small" disabled={p.status === 'rejected'} onClick={() => run(() => api.decide(p.id, 'reject'), 'Предложение отклонено')}>Отклонить</button>
                    </div>
                  </div>
                ))}
                {milestones.length > 0 && <h3>Этапы выбранных команд</h3>}
                {milestones.map((m) => (
                  <div key={m.id} className="milestone">
                    <div><b>{m.teamName}: {m.title}</b> — <span className={`badge ms-${m.status}`}>{{ planned: 'Запланирован', in_review: 'Ожидает вашей проверки', rework: 'На доработке', approved: 'Этап подтверждён' }[m.status]}</span></div>
                    <div className="muted small">Критерий приёмки: {m.acceptanceCriteria}</div>
                    {m.evidenceUrl && <div className="small">Результат: <a href={m.evidenceUrl} target="_blank" rel="noopener noreferrer">{m.evidenceUrl}</a> — {m.evidenceNote}</div>}
                    {m.aiSummary && <div className="ai-note">Предварительный комментарий: {m.aiSummary}</div>}
                    {m.status === 'in_review' && (
                      <div className="row">
                        <button className="btn small" onClick={() => run(() => api.decideMilestone(m.id, 'approve'), `Этап подтверждён: команде «${m.teamName}» +${m.points}`)}>Подтвердить результат</button>
                        <button className="btn ghost small" onClick={() => run(() => api.decideMilestone(m.id, 'rework'), 'Этап возвращён на доработку')}>Вернуть на доработку</button>
                      </div>
                    )}
                  </div>
                ))}
              </section>
            )}
          </div>

          <aside className="editor-side">
            {task.score ? <ScoreBreakdown score={task.score} title="Официальный балл (подтверждённая версия)" /> : <div className="panel muted">Официальный балл появится после «Подтвердить сведения».</div>}
            {unconfirmed && <ScoreBreakdown score={forecast} title="Прогноз по рабочей копии" forecast />}
          </aside>
        </div>
      </main>
    </>
  );
}
