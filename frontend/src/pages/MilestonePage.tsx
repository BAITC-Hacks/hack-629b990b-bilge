// Milestone (GET /milestones/:id): the team submits a Git/PR link, the business confirms (+10 once) or returns it.
// Git materials and AI comments are preliminary information; a human makes the decision. Material text is untrusted, no HTML.
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
  if (!view) return <><Header /><main className="page"><p className="muted">Loading milestone…</p></main></>;
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
        <div className="kicker"><Link to={`/tasks/${m.taskId}`}>Task card</Link> · Milestone of team {m.teamName}</div>
        <h1>{m.title}</h1>
        <div className="row wrap"><span className={`badge ms-${m.status}`}>{m.statusLabel}</span><span className="muted">{m.statusHint}</span></div>
        <section className="panel">
          <h3>Acceptance criterion</h3>
          <p style={{ whiteSpace: 'pre-wrap' }}>{m.acceptanceCriteria}</p>
          {m.previousFeedback && <div className="alert"><b>Latest business feedback:</b> {m.previousFeedback}</div>}
          {m.reviewNotice && <div className="ai-note">{m.reviewNotice.message}</div>}
        </section>

        {m.evidence && (
          <section className="panel">
            <h3>Team result</h3>
            <p><a href={m.evidenceUrl} target="_blank" rel="noreferrer noopener">{m.evidenceUrl}</a></p>
            <p style={{ whiteSpace: 'pre-wrap' }}>{m.description}</p>
            <div className="small muted">Link check: {m.evidence.provider} · {m.evidence.status}{m.evidence.warning ? ` — ${m.evidence.warning}` : ''}</div>
            {m.evidence.facts.length > 0 && <ul className="small">{m.evidence.facts.map((f, i) => <li key={i}>{f}</li>)}</ul>}
            {m.evidence.snapshot && (
              <details><summary>Materials read ({m.evidence.snapshot.files.length}, coverage: {m.evidence.snapshot.coverage})</summary>
                {m.evidence.snapshot.warnings.map((w, i) => <div key={i} className="alert small">{w}</div>)}
                {m.evidence.snapshot.files.map((f) => (
                  <div key={f.id}><div className="small"><b>{f.path}</b> ({f.kind}{f.truncated ? ', truncated' : ''}) · <a href={f.sourceUrl} target="_blank" rel="noreferrer noopener">source</a></div><pre>{f.content}</pre></div>
                ))}
              </details>
            )}
            {m.review && (
              <div className="ai-note">
                <b>Preliminary AI comment{m.review.mode === 'stub' ? ' (manual review)' : ''}:</b> {m.review.summary}
                {m.review.warning && <div className="small">{m.review.warning}</div>}
                {m.review.checks.length > 0 && <ul className="small">{m.review.checks.map((c, i) => <li key={i}>{c}</li>)}</ul>}
                {m.review.criterionEvidence?.map((ce, i) => (
                  <div key={i} className="small"><b>{ce.criterion}</b> — {ce.status === 'materials_found' ? 'materials found' : ce.status === 'insufficient_evidence' ? 'insufficient materials' : 'not assessed'}
                    {ce.citations.map((q, k) => <blockquote key={k}>“{q.quote}” — <a href={q.sourceUrl} target="_blank" rel="noreferrer noopener">{q.path}</a></blockquote>)}
                    <div className="muted">{ce.nextStep}</div>
                  </div>
                ))}
                <div className="small muted">A quote does not prove the criterion is met. The business makes the decision.</div>
              </div>
            )}
          </section>
        )}

        {submit && (
          <section className="panel">
            <h3>Submit for review</h3>
            <form className="form" onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              const r = await run(() => api.submitEvidence(m.id, { expectedVersion: m.version, ...ev }));
              setBusy(false);
              if (r) setView(r.data);
            }}>
              <label>Repository or PR link<input value={ev.evidenceUrl} placeholder="https://github.com/…/pull/1" onChange={(e) => setEv({ ...ev, evidenceUrl: e.target.value })} /></label>
              <FieldError field="evidenceUrl" />
              <label>What was done<textarea rows={3} value={ev.description} onChange={(e) => setEv({ ...ev, description: e.target.value })} /></label>
              <FieldError field="description" />
              <button className="btn" type="submit" disabled={busy || !submit.enabled} title={submit.reason ?? ''}>{busy ? 'Checking link…' : submit.label}</button>
              <p className="muted small">The Git and AI check can take up to 45 seconds. The link and the AI comment don't award points — only business confirmation does.</p>
            </form>
          </section>
        )}

        {(approve || ret) && (
          <section className="panel">
            <h3>Decision on the result</h3>
            <label>Feedback for the team (required when returning)<textarea rows={2} value={feedback} onChange={(e) => setFeedback(e.target.value)} /></label>
            <FieldError field="feedback" />
            <div className="row" style={{ marginTop: 8 }}>
              {approve && <button className="btn" disabled={busy || !approve.enabled} title={approve.reason ?? ''} onClick={() => decide('approve')}>{approve.label}</button>}
              {ret && <button className="btn ghost" disabled={busy || !ret.enabled} title={ret.reason ?? ''} onClick={() => decide('return')}>{ret.label}</button>}
            </div>
            <p className="muted small">Confirmation awards the team exactly 10 points once and launches GRAND TRIUMPH in the 3D world.</p>
          </section>
        )}

        {m.reviewHistory.length > 0 && (
          <details className="panel"><summary>Decision history ({m.reviewHistory.length})</summary>
            <ul>{m.reviewHistory.map((h, i) => <li key={i}>{h.decision === 'approve' ? 'Confirmed' : 'Returned'}{h.decidedAt ? ` · ${new Date(h.decidedAt).toLocaleString('en')}` : ''}{h.feedback ? ` — ${h.feedback}` : ''}</li>)}</ul>
          </details>
        )}
      </main>
    </>
  );
}
