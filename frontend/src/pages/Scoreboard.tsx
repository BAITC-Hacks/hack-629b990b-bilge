// Team leaderboard (GET /scoreboard): only the name and points for milestones confirmed by the business.
import { useApp } from '../state';
import { Header } from '../components/common';

export function Scoreboard() {
  const { snap, world } = useApp();
  const color = (name: string) => world?.teams.find((t) => t.name === name)?.color;
  return (
    <>
      <Header />
      <main className="page narrow">
        <h1>Team leaderboard</h1>
        <p className="muted">Points are awarded only for milestones confirmed by the business: 10 per milestone, exactly once. Applications, walking around the world and commit links don't earn points.</p>
        <table className="tbl">
          <thead><tr><th>#</th><th>Team</th><th>Points</th></tr></thead>
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
            <h3>Hall of Achievements</h3>
            {world.achievements.map((a) => <div key={a.id}><i className="team-dot" style={{ background: a.teamColor }} /> <b>{a.teamName}</b> completed the task “{a.taskTitle}” · {new Date(a.at).toLocaleDateString('en')}</div>)}
          </section>
        )}
      </main>
    </>
  );
}
