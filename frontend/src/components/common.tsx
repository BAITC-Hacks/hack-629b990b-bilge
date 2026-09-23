// Общие элементы 2D-экранов поверх моделей BFF: шапка, уровень, разбор балла, карточка полей, ошибки полей.
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
      <Link to="/" className="brand">AI Sana · <b>Площадь задач</b></Link>
      <nav className="topnav">
        {actor && <NavLink to="/dashboard" end>{actor.role === 'business' ? 'Мои задачи' : 'Кабинет команды'}</NavLink>}
        <NavLink to="/world">3D-мир</NavLink>
        <NavLink to="/list">Все задачи</NavLink>
        <NavLink to="/teams">Рейтинг команд</NavLink>
      </nav>
      <div className="who">
        {actor ? (
          <>
            {team && <span className="team-dot" style={{ background: team.color }} aria-hidden />}
            <span>{actor.displayName}</span>
            {team && <span className="pts" title="Очки команды — только за этапы, подтверждённые бизнесом">★ {team.confirmedPoints}</span>}
            <button className="btn ghost small" onClick={async () => { await api.endSession().catch(() => undefined); setToken(null); await refresh(); nav('/login'); }}>Выйти</button>
          </>
        ) : (
          <><span className="muted">Гость (только просмотр)</span><Link className="btn ghost small" to="/login">Войти</Link></>
        )}
      </div>
    </header>
  );
}

export const levelClass = (level: string) => `lvl-${LEVEL_FROM_BFF[level] ?? level}`;

/** «Рабочая, 55/100» — уровень всегда словами и числом, не только цветом. */
export function LevelBadge({ value, level, label }: { value: number; level: string; label: string }) {
  return <span className={`badge ${levelClass(level)}`}>{label}, {value}/100</span>;
}

export function ScoreBreakdown({ score, title, forecast }: { score: Score; title?: string; forecast?: boolean }) {
  return (
    <div className={`breakdown ${forecast ? 'is-forecast' : ''}`}>
      <div className="bd-head">
        <div>
          <div className="bd-title">{title ?? 'Готовность задачи'}</div>
          {forecast && <div className="forecast-note">Прогноз по черновику — официальный балл изменится только после подтверждения</div>}
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
        <div className="next-step"><b>Ближайшее улучшение: +{score.nextImprovement.possiblePoints}</b> — {score.nextImprovement.message}</div>
      ) : (
        <div className="next-step done">Все сведения заполнены.</div>
      )}
    </div>
  );
}

const AVAIL: Record<string, string> = { available: 'Данные есть', none: 'Данных пока нет', unknown: 'Пока не знаю' };

export function CardView({ fields }: { fields: TaskFields }) {
  const rows: [string, string][] = [
    ['Отрасль', fields.industry],
    ['Что происходит сейчас', fields.context],
    ['Что нужно изменить', fields.need],
    ['Будущие пользователи', fields.users],
    ['Данные и материалы', [AVAIL[fields.dataAvailability], fields.dataSource].filter(Boolean).join(' — ')],
    ['Ожидаемый результат', fields.expectedResult],
    ['Критерий успеха', [fields.successMetric && fields.successTarget ? `${fields.successMetric}: ${fields.successTarget}` : '', fields.acceptanceCriteria].filter(Boolean).join('; ')],
    ['Ограничения', fields.noConstraints ? 'Известных ограничений нет' : fields.constraints],
    ['Канал связи', fields.contact],
    ['Формат консультаций', fields.interactionFormat],
  ];
  return (
    <dl className="cardview">
      {rows.map(([k, v]) => (
        <div key={k}><dt>{k}</dt><dd>{v?.trim() ? v : <span className="missing">не указано</span>}</dd></div>
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
