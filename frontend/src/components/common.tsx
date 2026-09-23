// Shared 2D-screen elements on top of BFF models: header, level, score breakdown, field card, field errors.
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { api, setToken, type Score, type TaskFields } from '../api';
import { useApp, useFieldError } from '../state';
import { LEVEL_FROM_BFF } from '../shared/types';

export function Header() {
  const { snap, world, refresh } = useApp();
  const nav = useNavigate();
  const actor = snap?.bootstrap.actor ?? null;
  const team = actor?.teamId ? world?.teams.find((t) => t.id === actor.teamId) : null;
  return (
    <header className="topbar">
      <Link to="/" className="brand">AI Sana · <b>Task Plaza</b></Link>
      <nav className="topnav">
        {actor && <NavLink to="/dashboard" end>{actor.role === 'business' ? 'My tasks' : 'Team dashboard'}</NavLink>}
        <NavLink to="/world">3D world</NavLink>
        <NavLink to="/list">All tasks</NavLink>
        <NavLink to="/teams">Team leaderboard</NavLink>
      </nav>
      <div className="who">
        {actor ? (
          <>
            {team && <span className="team-dot" style={{ background: team.color }} aria-hidden />}
            <span>{actor.displayName}</span>
            {team && <span className="pts" title="Team points — only for milestones confirmed by the business">★ {team.confirmedPoints}</span>}
            <button className="btn ghost small" onClick={async () => { await api.endSession().catch(() => undefined); setToken(null); await refresh(); nav('/login'); }}>Sign out</button>
          </>
        ) : (
          <><span className="muted">Guest (view only)</span><Link className="btn ghost small" to="/login">Sign in</Link></>
        )}
      </div>
    </header>
  );
}

export const levelClass = (level: string) => `lvl-${LEVEL_FROM_BFF[level] ?? level}`;

/** "In progress, 55/100" — the level is always shown in words and a number, not only by color. */
export function LevelBadge({ value, level, label }: { value: number; level: string; label: string }) {
  return <span className={`badge ${levelClass(level)}`}>{label}, {value}/100</span>;
}

export function ScoreBreakdown({ score, title, forecast }: { score: Score; title?: string; forecast?: boolean }) {
  return (
    <div className={`breakdown ${forecast ? 'is-forecast' : ''}`}>
      <div className="bd-head">
        <div>
          <div className="bd-title">{title ?? 'Task readiness'}</div>
          {forecast && <div className="forecast-note">Draft forecast — the official score changes only after confirmation</div>}
        </div>
        <div className={`bd-total ${levelClass(score.level)}`}>{score.value}<small>/100</small><span>{score.label}</span></div>
      </div>
      <div className="meter" aria-hidden>
        <div className={`meter-fill ${levelClass(score.level)}`} style={{ width: `${score.value}%` }} />
        {[40, 70, 90].map((m) => <i key={m} style={{ left: `${m}%` }} />)}
      </div>
      <ul className="bd-cats">
        {score.breakdown.map((c) => (
          <li key={c.key}>
            <div className="bd-cat"><span>{c.earned === c.max ? '✓' : '○'} {c.label}</span><b>{c.earned}/{c.max}</b></div>
            {c.earned < c.max && c.hint && <div className="muted small">{c.hint}</div>}
          </li>
        ))}
      </ul>
      {score.nextImprovement ? (
        <div className="next-step"><b>Next improvement: +{score.nextImprovement.possiblePoints}</b> — {score.nextImprovement.message}</div>
      ) : (
        <div className="next-step done">All details are filled in.</div>
      )}
    </div>
  );
}

const AVAIL: Record<string, string> = { available: 'Data available', none: 'No data yet', unknown: 'Not sure yet' };

export function CardView({ fields }: { fields: TaskFields }) {
  const rows: [string, string][] = [
    ['Industry', fields.industry],
    ['What happens now', fields.context],
    ['What needs to change', fields.need],
    ['Future users', fields.users],
    ['Data and materials', [AVAIL[fields.dataAvailability], fields.dataSource].filter(Boolean).join(' — ')],
    ['Expected result', fields.expectedResult],
    ['Success criterion', [fields.successMetric && fields.successTarget ? `${fields.successMetric}: ${fields.successTarget}` : '', fields.acceptanceCriteria].filter(Boolean).join('; ')],
    ['Constraints', fields.noConstraints ? 'No known constraints' : fields.constraints],
    ['Contact channel', fields.contact],
    ['Consultation format', fields.interactionFormat],
  ];
  return (
    <dl className="cardview">
      {rows.map(([k, v]) => (
        <div key={k}><dt>{k}</dt><dd>{v?.trim() ? v : <span className="missing">not specified</span>}</dd></div>
      ))}
    </dl>
  );
}

export function FieldError({ field }: { field: string }) {
  const text = useFieldError(field);
  return text ? <div className="field-error" role="alert">{text}</div> : null;
}

export function Feedback({ kind = 'info', children }: { kind?: 'info' | 'warn'; children: React.ReactNode }) {
  return <div className={kind === 'warn' ? 'alert' : 'ai-note'}>{children}</div>;
}
