// Таблица команд: только название и очки за подтверждённые бизнесом этапы (ТЗ 10, приватность).
import { useApp } from '../state';
import { Header } from '../components/common';
import { AvatarBadge } from '../world/AvatarBadge';

export function Scoreboard() {
  const { snap } = useApp();
  if (!snap) return null;
  const teams = [...snap.teams].sort((a, b) => b.confirmedPoints - a.confirmedPoints || a.name.localeCompare(b.name));
  return (
    <>
      <Header />
      <main className="page narrow">
        <h1>Таблица команд</h1>
        <p className="muted">Очки прогресса начисляются только за этап, подтверждённый бизнесом. Отклики, коммиты и клики очков не приносят. Очки команды не влияют на готовность задач.</p>
        <table className="tbl">
          <thead><tr><th>#</th><th>Команда</th><th>Очки прогресса</th></tr></thead>
          <tbody>
            {teams.map((t, i) => (
              <tr key={t.id} className={t.id === snap.me?.teamId ? 'me' : ''}>
                <td>{i + 1}</td>
                <td><span className="row"><AvatarBadge preset={t.avatarPreset} color={t.color} /> {t.name}</span></td>
                <td><b className="amber">★ {t.confirmedPoints}</b></td>
              </tr>
            ))}
          </tbody>
        </table>
      </main>
    </>
  );
}
