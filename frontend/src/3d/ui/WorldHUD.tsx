// Minimal HUD over the 3D scene: brand top-left, online count in the center, own team top-right; hints and "All tasks" at the bottom.
import { useState, useSyncExternalStore } from 'react';
import { Link } from 'react-router-dom';
import type { PlayerPresence, WorldTask as PublicTask, WorldTeam as Team } from '../../shared/types';
import type { PresenceStore } from '../multiplayer/PresenceStore';
import type { WorldEventManager } from '../events/WorldEventManager';
import { EMOTES, EMOTE_LABEL } from '../../shared/world';
import type { Emote } from '../../shared/types';

export function usePlayers(store: PresenceStore): PlayerPresence[] {
  useSyncExternalStore((fn) => store.subscribe(fn), () => store.version);
  return store.list();
}

interface HudProps {
  store: PresenceStore;
  me: { displayName: string; role: string; teamId: string | null } | null;
  team: Team | null;
  mapMode: boolean;
  onToggleMap: () => void;
  onMyTeam: () => void;
  onList: () => void;
  onEmote: (e: Emote) => void;
  onLogout: () => void;
}

export function WorldHUD({ store, me, team, mapMode, onToggleMap, onMyTeam, onList, onEmote, onLogout }: HudProps) {
  const players = usePlayers(store);
  const [online, setOnline] = useState(false);
  const mates = team ? players.filter((p) => p.teamId === team.id && p.userId !== store.me) : [];
  return (
    <>
      <div className="hud-tl">
        <div className="hud-brand"><b>AI Sana</b> World</div>
        <nav className="hud-links">
          <Link to="/list">2D catalog</Link>
          {me?.role === 'business' && <Link to="/business">My tasks</Link>}
          <Link to="/teams">Teams</Link>
          <button className="linkish" onClick={onLogout}>Sign out</button>
        </nav>
      </div>
      <button className={`hud-online ${store.connected ? '' : 'off'}`} onClick={() => setOnline(!online)} aria-expanded={online}>
        <i /> {store.connected ? `${players.length} online` : store.error ?? 'connecting…'}
      </button>
      {online && <OnlinePanel players={players} myTeamId={team?.id ?? null} meId={store.me} onClose={() => setOnline(false)} />}
      <div className="hud-tr">
        {team ? (
          <div className="hud-team" style={{ borderColor: team.color }}>
            <div className="ht-name"><i style={{ background: team.color }}>{team.name.slice(0, 1)}</i>{team.name}</div>
            <div className="ht-meta">{mates.length} {mates.length === 1 ? 'teammate' : 'teammates'} online · ★ {team.confirmedPoints}</div>
            <button className="btn small" onClick={onMyTeam}>My team</button>
          </div>
        ) : (
          <div className="hud-team"><div className="ht-name">{me ? me.displayName : 'Guest'}</div><div className="ht-meta">{me?.role === 'business' ? 'Business · viewing the world' : 'View only'}</div></div>
        )}
      </div>
      <div className="hud-bl">
        <span><kbd>WASD</kbd> walk</span><span><kbd>Shift</kbd> faster</span><span><kbd>E</kbd> open</span>
        <span><kbd>M</kbd> {mapMode ? 'to world' : 'map'}</span>
        <span className="emotes">{EMOTES.map((e, i) => <button key={e} onClick={() => onEmote(e)} title={EMOTE_LABEL[e]}><kbd>{i + 1}</kbd>{EMOTE_LABEL[e]}</button>)}</span>
      </div>
      <div className="hud-br">
        <button className="btn ghost" onClick={onToggleMap}>{mapMode ? 'Back to world' : 'Map'}</button>
        <button className="btn" onClick={onList}>All tasks</button>
      </div>
    </>
  );
}

function OnlinePanel({ players, myTeamId, meId, onClose }: { players: PlayerPresence[]; myTeamId: string | null; meId: string | null; onClose: () => void }) {
  const mine = players.filter((p) => myTeamId && p.teamId === myTeamId);
  const others = new Map<string, { name: string; color: string; n: number }>();
  let guests = 0, biz = 0;
  for (const p of players) {
    if (myTeamId && p.teamId === myTeamId) continue;
    if (p.teamId && p.teamName) { const o = others.get(p.teamId) ?? { name: p.teamName, color: p.teamColor, n: 0 }; o.n++; others.set(p.teamId, o); }
    else if (p.role === 'business') biz++; else guests++;
  }
  return (
    <div className="online-panel" role="dialog" aria-label="Online">
      <button className="panel-close" onClick={onClose} aria-label="Close">×</button>
      <div className="op-title">ONLINE</div>
      {myTeamId && (
        <>
          <div className="op-h">My team</div>
          {mine.map((p) => <div key={p.userId} className="op-row"><span className={`np-dot`} data-p={p.presence} />{p.displayName}{p.userId === meId && <em> (you)</em>}{p.demo && <small> demo</small>}</div>)}
        </>
      )}
      <div className="op-h">Other teams</div>
      {[...others.values()].map((o) => <div key={o.name} className="op-row"><i style={{ background: o.color }} />{o.name} — {o.n} online</div>)}
      {others.size === 0 && <div className="op-row muted">nobody</div>}
      {(biz > 0 || guests > 0) && <div className="op-row muted">Business: {biz} · Guests: {guests}</div>}
      <div className="op-legend"><span className="np-dot" data-p="moving" /> walking <span className="np-dot" data-p="online" /> standing <span className="np-dot" data-p="interacting" /> viewing a task <span className="np-dot" data-p="idle" /> inactive</div>
    </div>
  );
}

export function TaskListPanel({ tasks, onPick, onClose }: { tasks: PublicTask[]; onPick: (id: string) => void; onClose: () => void }) {
  const [q, setQ] = useState('');
  const list = tasks.filter((t) => !q || (t.title + t.summary + t.industry).toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="hud-list" role="dialog" aria-label="All tasks">
      <button className="panel-close" onClick={onClose} aria-label="Close">×</button>
      <h3>All tasks ({tasks.length})</h3>
      <input placeholder="Search by title, description, industry" value={q} onChange={(e) => setQ(e.target.value)} />
      <ol>
        {list.map((t) => (
          <li key={t.id}>
            <button className={`list-item lvl-${t.score.levelKey}`} onClick={() => onPick(t.id)}>
              <b>{t.title}</b>
              <span>{t.score.level}, {t.score.total}/100 · {t.industry} · applications {t.offersCount}</span>
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function TriumphBanner({ events }: { events: WorldEventManager }) {
  const t = useSyncExternalStore((fn) => events.subscribe(fn), () => events.triumph);
  if (!t) return null;
  return (
    <div className="triumph-banner" role="status" aria-live="polite">
      <div className="tb-k">🏆 GRAND TRIUMPH</div>
      <div className="tb-m">Team “{t.teamName}”</div>
      <div className="tb-s">completed the task “{t.taskTitle}”</div>
    </div>
  );
}
