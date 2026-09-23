// Application and result comparison (GET /tasks/:id/review): the business manually selects or rejects teams.
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, type ReviewView } from '../api';
import { useApp } from '../state';
import { Header } from '../components/common';

export function ReviewDesk() {
  const { id = '' } = useParams();
  const { run, revision } = useApp();
  const [view, setView] = useState<ReviewView | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  useEffect(() => { void run(() => api.reviewDesk(id)).then((r) => r && setView(r.data)); }, [id, revision]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!view) return <><Header /><main className="page"><p className="muted">Loading applications…</p></main></>;
  return (
    <>
      <Header />
      <main className="page">
        <div className="kicker"><Link to="/dashboard">My tasks</Link> · <Link to={`/business/tasks/${id}`}>Task builder</Link></div>
        <h1>{view.task.title}</h1>
        <p className="muted">{view.selectionPolicy}</p>
        <div className="grid2 top">
          <section>
            <h2>Applications ({view.proposals.length})</h2>
            {view.proposals.length === 0 && <p className="muted">No applications yet.</p>}
            {view.proposals.map((p) => (
              <div key={p.id} className={`prop st-${p.status}`}>
                <div className="row between"><b className="row"><i className="team-dot" style={{ background: p.team.color }} />{p.team.name}</b><span className={`badge st-${p.status}`}>{p.statusLabel}</span></div>
                <dl>
                  {view.comparison.columns.map((col) => (
                    <div key={col.key} style={{ display: 'contents' }}>
                      <dt>{col.label}</dt>
                      <dd>{col.key === 'prototypeUrl' ? <a href={p.prototypeUrl} target="_blank" rel="noreferrer noopener">{p.prototypeUrl}</a> : String(p[col.key as keyof typeof p] ?? '')}</dd>
                    </div>
                  ))}
                </dl>
                {p.decisionNote && <div className="small muted">Your comment: {p.decisionNote}</div>}
                <input placeholder="Comment for the team (optional)" value={notes[p.id] ?? ''} onChange={(e) => setNotes({ ...notes, [p.id]: e.target.value })} />
                <div className="row" style={{ marginTop: 6 }}>
                  {p.actions.map((a) => (
                    <button key={a.id} className={`btn small ${a.id === 'reject' ? 'ghost' : ''}`} disabled={!a.enabled} title={a.reason ?? ''}
                      onClick={async () => { const r = await run(() => api.decideProposal(p.id, { expectedVersion: p.version, decision: a.id as 'select' | 'reject', note: notes[p.id] ?? '' })); if (r) setView(r.data); }}>
                      {a.label}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </section>
          <section>
            <h2>Team milestones</h2>
            {view.milestones.length === 0 && <p className="muted">Selected teams haven't created milestones yet.</p>}
            {view.milestones.map((m) => (
              <div key={m.id} className="milestone">
                <Link to={`/milestones/${m.id}`}><b>{m.teamName}: {m.title}</b></Link> — <span className={`badge ms-${m.status}`}>{m.statusLabel}</span>
                <div className="muted small">{m.statusHint}</div>
              </div>
            ))}
          </section>
        </div>
      </main>
    </>
  );
}
