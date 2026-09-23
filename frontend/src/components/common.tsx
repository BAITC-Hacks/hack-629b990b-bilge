import { Link, NavLink, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useApp } from '../state';
import type { Card, PublicTask, Score } from '../shared/types';
import { LEVELS } from '../shared/scoring';

export function Header() {
  const { snap } = useApp();
  const nav = useNavigate();
  const me = snap?.me;
  const team = me?.teamId ? snap?.teams.find((t) => t.id === me.teamId) : null;
  return (
    <header className="topbar">
      <Link to="/" className="brand">AI Sana · <b>Площадь задач</b></Link>
      <nav className="topnav">
        {me?.role === 'business' && <NavLink to="/business" end>Мои задачи</NavLink>}
        <NavLink to="/world">3D-мир</NavLink>
        <NavLink to="/list">Все задачи</NavLink>
        <NavLink to="/teams">Таблица команд</NavLink>
      </nav>
      <div className="who">
        {me ? (
          <>
            {team && <span className="team-dot" style={{ background: team.color }} aria-hidden />}
            <span>{me.displayName}</span>
            {team && <span className="pts" title="Очки прогресса команды — только за этапы, подтверждённые бизнесом">★ {team.confirmedPoints}</span>}
          </>
        ) : (
          <span className="muted">Гость (только просмотр)</span>
        )}
        <button className="btn ghost small" onClick={async () => { await api.logout(); nav('/login'); }}>Выйти</button>
      </div>
    </header>
  );
}

export function levelClass(key: string) {
  return `lvl-${key}`;
}

/** «Рабочая, 55/100» — статус всегда словами и числом, не только цветом (ТЗ 5.3). */
export function LevelBadge({ score }: { score: Score }) {
  return <span className={`badge ${levelClass(score.levelKey)}`}>{score.level}, {score.total}/100</span>;
}

export function ScoreBreakdown({ score, title, forecast }: { score: Score; title?: string; forecast?: boolean }) {
  return (
    <div className={`breakdown ${forecast ? 'is-forecast' : ''}`}>
      <div className="bd-head">
        <div>
          <div className="bd-title">{title ?? 'Готовность задачи'}</div>
          {forecast && <div className="forecast-note">Прогноз по рабочей копии — официальный балл изменится только после подтверждения</div>}
        </div>
        <div className={`bd-total ${levelClass(score.levelKey)}`}>
          {score.total}<small>/100</small>
          <span>{score.level}</span>
        </div>
      </div>
      <div className="meter" aria-hidden>
        <div className={`meter-fill ${levelClass(score.levelKey)}`} style={{ width: `${score.total}%` }} />
        {[40, 70, 90].map((m) => <i key={m} style={{ left: `${m}%` }} />)}
      </div>
      <div className="meter-legend">{[...LEVELS].reverse().map((l) => <span key={l.key}>{l.min} {l.label.toLowerCase()}</span>)}</div>
      <ul className="bd-cats">
        {score.categories.map((c) => (
          <li key={c.key}>
            <div className="bd-cat"><span>{c.label}</span><b>{c.got}/{c.max}</b></div>
            <ul>
              {c.items.map((i) => (
                <li key={i.key} className={i.earned ? 'ok' : 'miss'}>
                  <span aria-hidden>{i.earned ? '✓' : '○'}</span> {i.label} <em>{i.earned}/{i.points}</em>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
      {score.next ? (
        <div className="next-step"><b>Ближайшее улучшение{forecast ? ' (прогноз)' : ''}: +{score.next.points}</b> — {score.next.text}</div>
      ) : (
        <div className="next-step done">Все сведения заполнены.</div>
      )}
    </div>
  );
}

const AVAIL: Record<string, string> = { yes: 'Есть', no: 'Данных нет', unknown: 'Не знаю', '': '' };

export function CardView({ card }: { card: Card }) {
  const rows: [string, string][] = [
    ['Контекст', card.context],
    ['Потребность', card.need],
    ['Пользователи', card.users],
    ['Данные и материалы', [AVAIL[card.dataAvailability], card.dataSource].filter(Boolean).join(' — ')],
    ['Ожидаемый результат', card.expectedResult],
    ['Критерий успеха', [card.successMetric && card.successTarget ? `${card.successMetric}: ${card.successTarget}` : '', card.acceptanceItem].filter(Boolean).join('; ')],
    ['Ограничения', card.noKnownConstraints ? 'Известных ограничений нет' : card.constraints],
    ['Контакт', card.contactChannel],
    ['Формат взаимодействия', card.interactionFormat],
  ];
  return (
    <dl className="cardview">
      {rows.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{v?.trim() ? v : <span className="missing">не указано</span>}</dd>
        </div>
      ))}
    </dl>
  );
}

export function TaskMeta({ task }: { task: PublicTask }) {
  return (
    <div className="task-meta">
      <span>{task.companyName} · {task.industry}</span>
      <span>Предложений: {task.offersCount}</span>
      {task.selectedTeams.length > 0 && <span>Выбрана команда: {task.selectedTeams.map((t) => t.name).join(', ')}</span>}
      {task.inReview && <span className="badge pending">Ожидает решения бизнеса</span>}
    </div>
  );
}

export function FieldError({ field }: { field: string }) {
  const { fieldError } = useApp();
  if (!fieldError || fieldError.field !== field) return null;
  return <div className="field-error" role="alert">{fieldError.text}</div>;
}
