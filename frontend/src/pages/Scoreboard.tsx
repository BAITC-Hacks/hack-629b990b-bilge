// Рейтинг команд (GET /scoreboard): только название и очки за подтверждённые бизнесом этапы.
import { useApp } from '../state';
import { Header } from '../components/common';

export function Scoreboard() {
  const { snap, world } = useApp();
  const color = (name: string) => world?.teams.find((t) => t.name === name)?.color;
  return (
    <>
      <Header />
      <main className="page narrow">
        <h1>Рейтинг команд</h1>
        <p className="muted">Очки начисляются только за этапы, подтверждённые бизнесом: 10 за этап, ровно один раз. Отклики, ходьба в мире и ссылки на коммиты очков не дают.</p>
        <table className="tbl">
          <thead><tr><th>#</th><th>Команда</th><th>Очки</th></tr></thead>
          <tbody>
            {snap?.scoreboard.teams.map((t) => (
              <tr key={t.name} className={snap.dashboard?.screen === 'team-dashboard' && snap.dashboard.team.name === t.name ? 'me' : ''}>
                <td>{t.rank}</td><td><span className="team-dot" style={{ background: color(t.name) }} /> {t.name}</td><td>★ {t.confirmedPoints}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {world && world.achievements.length > 0 && (
          <section className="panel" style={{ marginTop: 16 }}>
            <h3>Зал достижений</h3>
            {world.achievements.map((a) => <div key={a.id}><i className="team-dot" style={{ background: a.teamColor }} /> <b>{a.teamName}</b> завершила задачу «{a.taskTitle}» · {new Date(a.at).toLocaleDateString('ru')}</div>)}
          </section>
        )}
      </main>
    </>
  );
}
