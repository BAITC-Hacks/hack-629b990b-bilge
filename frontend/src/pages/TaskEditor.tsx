// Business task builder (BFF workspace): description breakdown with quotes → one clarifying question at a time → field edits →
// "Confirm details" (official score) → "Publish". Action availability and the next step come from the server.
// Local edits are never lost: on a version conflict (409) the user is offered to load the fresh version and re-apply them.
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ApiError, api, type FieldKey, type TaskFields, type WorkspaceView } from '../api';
import { useApp } from '../state';
import { FieldError, Header, ScoreBreakdown } from '../components/common';

type Value = string | boolean;

export function TaskEditor() {
  const { id = '' } = useParams();
  const { run, toast, refresh } = useApp();
  const [ws, setWs] = useState<WorkspaceView | null>(null);
  const [edits, setEdits] = useState<Partial<Record<FieldKey, Value>>>({});
  const [answer, setAnswer] = useState<Value>('');
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [stale, setStale] = useState(false);

  const load = async () => {
    const r = await run(() => api.workspace(id));
    if (r) { setWs(r.data); setStale(false); }
  };
  useEffect(() => { void load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  const q = ws?.clarification?.nextQuestion ?? null;
  useEffect(() => { setAnswer(q ? (q.value as Value) : ''); }, [q?.field, q?.index]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setPicked(ws?.analysis?.status === 'ready' ? ws.analysis.suggestions.map((s) => s.id) : []); }, [ws?.analysis?.id, ws?.analysis?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Run an editor command: the server response replaces the screen; a version conflict keeps local edits. */
  async function cmd(name: string, fn: (v: number) => Promise<{ data: WorkspaceView }>, after?: () => void) {
    if (!ws) return;
    setBusy(name);
    try {
      const r = await run(async () => {
        try { return await fn(ws.task.version); } catch (e) {
          if (e instanceof ApiError && (e.code === 'STALE_VERSION' || e.code === 'ANALYSIS_STALE')) setStale(true);
          throw e;
        }
      });
      if (r) { setWs(r.data); after?.(); void refresh(); }
    } finally { setBusy(null); }
  }

  const fields = useMemo(() => ({ ...(ws?.draft.fields ?? {}), ...edits }) as TaskFields, [ws, edits]);
  const dirty = Object.keys(edits).length > 0;

  if (!ws) return <><Header /><main className="page"><p className="muted">Loading task builder…</p></main></>;
  const action = (aid: string) => ws.actions.find((a) => a.id === aid);
  const confirm = action('confirm');
  const publish = action('publish');
  const a = ws.analysis;
  const c = ws.clarification;

  return (
    <>
      <Header />
      <main className="page">
        <div className="page-head">
          <div>
            <div className="kicker"><Link to="/dashboard">My tasks</Link> · Task builder</div>
            <h1>{fields.title || 'New task'}</h1>
            <ol className="steps">{ws.steps.map((s) => <li key={s.id} className={s.complete ? 'done' : ''}>{s.complete ? '✓' : '○'} {s.label}</li>)}</ol>
          </div>
          <div className="row wrap">
            {ws.task.publicationStatus === 'published' && <><Link className="btn ghost" to={`/tasks/${id}`}>Public card</Link><Link className="btn" to={`/business/tasks/${id}/review`}>Compare applications</Link></>}
          </div>
        </div>
        <div className="next-step"><b>{ws.nextAction.label}.</b> {ws.nextAction.hint}</div>
        {stale && (
          <div className="alert">The card changed in another window. Your unsaved edits are kept here. <button className="btn small" onClick={() => void load()}>Load the latest version</button></div>
        )}

        <div className="editor-grid">
          <div>
            <section className="panel">
              <h3>Original description</h3>
              <blockquote>{ws.task.rawDescription}</blockquote>
              <div className="row wrap" style={{ marginTop: 10 }}>
                <button className="btn ghost" disabled={!!busy} onClick={() => cmd('analyze', (v) => api.analyzeTask(id, { expectedVersion: v }))}>{busy === 'analyze' ? 'Analyzing…' : 'Analyze description'}</button>
                <button className="btn ghost" disabled={!!busy} onClick={() => cmd('clarify', (v) => api.clarifyTask(id, { expectedVersion: v }))}>{busy === 'clarify' ? 'Preparing questions…' : c ? 'New AI questions' : 'Clarify the task with AI'}</button>
              </div>
            </section>

            {a && (
              <section className="panel">
                <h3>Suggestions from the description</h3>
                {a.warning && <div className="alert">{a.mode === 'stub' ? 'AI unavailable: ' : ''}{a.warning}</div>}
                {a.status === 'ready' && <p className="muted small">{a.notice}</p>}
                {a.status === 'empty' && <p className="muted">No suitable quotes found — fill in the fields manually or move on to clarifications.</p>}
                {a.status === 'stale' && <p className="muted">These suggestions refer to an earlier version of the card. Run the analysis again.</p>}
                {a.status === 'resolved' && <p className="muted">The suggestions have already been reviewed.</p>}
                {a.suggestions.map((s) => (
                  <label key={s.id} className="inline suggestion">
                    <input type="checkbox" disabled={!a.canApply} checked={picked.includes(s.id)} onChange={(e) => setPicked(e.target.checked ? [...picked, s.id] : picked.filter((x) => x !== s.id))} />
                    <span><b>{ws.fieldGuide.find((g) => g.field === s.field)?.label ?? s.field}:</b> “{s.source.quote}”</span>
                  </label>
                ))}
                {a.canApply && (
                  <div className="row">
                    <button className="btn" disabled={!!busy} onClick={() => cmd('apply', (v) => api.applySuggestions(id, { expectedVersion: v, analysisId: a.id, suggestionIds: picked }))}>{picked.length ? `Add selected (${picked.length})` : 'Continue without suggestions'}</button>
                  </div>
                )}
              </section>
            )}

            {c && (
              <section className="panel">
                <h3>Clarifications {c.mode === 'stub' && <span className="badge">local questions</span>}</h3>
                {c.warning && <div className="alert">{c.warning}</div>}
                <div className="q-progress">Answered {c.progress.answered} of {c.progress.total}{c.progress.skipped ? `, skipped ${c.progress.skipped}` : ''}</div>
                {q ? (
                  <form className="q-card form" onSubmit={(e) => { e.preventDefault(); void cmd('answer', (v) => api.applyAnswers(id, { expectedVersion: v, answers: [{ field: q.field, value: answer }] })); }}>
                    <div className="q-field">Question {q.index}</div>
                    <div className="q-text">{q.text}</div>
                    {q.input === 'select' ? (
                      <select value={String(answer)} onChange={(e) => setAnswer(e.target.value)}>{q.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
                    ) : q.input === 'checkbox' ? (
                      <label className="inline"><input type="checkbox" checked={answer === true} onChange={(e) => setAnswer(e.target.checked)} /> Yes</label>
                    ) : (
                      <textarea rows={3} value={String(answer)} onChange={(e) => setAnswer(e.target.value)} />
                    )}
                    <FieldError field={`answers.0.value`} />
                    <div className="row"><button className="btn" type="submit" disabled={!!busy}>Answer</button><span className="muted small">The answer is copied into the card verbatim. "Not sure yet" is also an answer.</span></div>
                  </form>
                ) : <p className="muted">All questions done. Review the card and confirm the details.</p>}
                <details><summary>All questions</summary><ol>{c.questions.map((qq) => <li key={qq.index} className={qq.answered ? 'ok' : ''}>{qq.answered ? '✓ ' : qq.skipped ? '— ' : ''}{qq.text}</li>)}</ol></details>
              </section>
            )}

            <section className="panel">
              <h3>Task card</h3>
              {ws.quality.warnings.map((w) => <div key={w.id} className="ai-note">{w.message}</div>)}
              <div className="form">
                {ws.fieldGuide.map((g) => {
                  const v = fields[g.field];
                  const set = (val: Value) => setEdits({ ...edits, [g.field]: val });
                  return (
                    <div key={g.field}>
                      {g.input === 'checkbox' ? (
                        <label className="inline"><input type="checkbox" checked={v === true} onChange={(e) => set(e.target.checked)} /> {g.label}</label>
                      ) : g.input === 'select' ? (
                        <label>{g.label}<select value={String(v)} onChange={(e) => set(e.target.value)}>{g.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></label>
                      ) : (
                        <label className={g.missing ? 'is-missing' : ''}>{g.label}{g.missing && <small className="muted"> — not filled in</small>}
                          {['title', 'industry', 'successMetric', 'successTarget', 'contact'].includes(g.field)
                            ? <input value={String(v ?? '')} onChange={(e) => set(e.target.value)} />
                            : <textarea rows={2} value={String(v ?? '')} onChange={(e) => set(e.target.value)} />}
                        </label>
                      )}
                      <FieldError field={g.field} />
                    </div>
                  );
                })}
              </div>
              <div className="row sticky-actions">
                <button className="btn ghost" disabled={!dirty || !!busy} onClick={() => cmd('save', (v) => api.saveDraft(id, { expectedVersion: v, fields: edits as Partial<TaskFields> }), () => setEdits({}))}>Save draft</button>
                <button className="btn" disabled={!!busy || dirty || !confirm?.enabled} title={dirty ? 'Save the draft first' : confirm?.reason ?? ''} onClick={() => cmd('confirm', (v) => api.confirmTask(id, { expectedVersion: v }))}>{confirm?.label ?? 'Confirm details'}</button>
                <button className="btn accent" disabled={!!busy || dirty || !publish?.enabled} title={publish?.reason ?? ''} onClick={() => cmd('publish', (v) => api.publishTask(id, { expectedVersion: v }))}>{publish?.label ?? 'Publish'}</button>
              </div>
              {dirty && <p className="muted small">You have unsaved edits. Save the draft, then confirm the details.</p>}
            </section>
          </div>

          <aside className="editor-side">
            {ws.officialScore ? <ScoreBreakdown score={ws.officialScore} title="Official score" /> : <div className="breakdown"><b>No official score yet</b><p className="muted small">It appears after "Confirm details".</p></div>}
            <ScoreBreakdown score={ws.forecast} title={`Draft forecast (${ws.forecast.delta >= 0 ? '+' : ''}${ws.forecast.delta})`} forecast />
            {ws.aiRuns.length > 0 && (
              <details className="ai-trace"><summary>How the AI worked ({ws.aiRuns.length})</summary>
                <ul className="small">{ws.aiRuns.map((r) => <li key={r.id}>{r.operation} · {r.mode}{r.model ? ` (${r.model})` : ''} · {r.durationMs} ms · {r.outcome}{r.fallbackReason ? ` — ${r.fallbackReason}` : ''}</li>)}</ul>
              </details>
            )}
            <button className="btn ghost small" onClick={() => toast('The draft is saved only with the "Save draft" button.', 'info')}>How does this work?</button>
          </aside>
        </div>
      </main>
    </>
  );
}
