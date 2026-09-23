// Присутствие игроков в 3D-мире. Сервер задаёт личность игрока по сессии (имя, команда, цвет, облик),
// клиент присылает только позицию/поворот/тип движения (10–15 Гц) и социальные действия.
// Ничего из этого не влияет на баллы и бизнес-данные.
import type { Server, Socket } from 'socket.io';
import type { Emote, MovementState, PlayerPresence, PlayerTick, PresenceState } from '../src/shared/types';
import { EMOTES, EMOTE_MS, NET_HZ, RUN_SPEED, WORLD_HALF, avatarFor } from '../src/shared/world';
import type { Store } from './store';

interface Entry { presence: PlayerPresence; socketId: string; lastMoveAt: number; lastActionAt: number; dirty: boolean; msgWindow: number; msgCount: number }

const GUEST_COLOR = '#9aa3b2';
const BUSINESS_COLOR = '#16324f';
const IDLE_AFTER_MS = 15000;

const finite = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

export class WorldPresence {
  private players = new Map<string, Entry>();
  private timer: NodeJS.Timeout;
  /** Для режима отладки: сколько пакетов движения принято за последнюю секунду. */
  private moveRate = 0;
  private moveCount = 0;

  constructor(private io: Server, private store: Store) {
    this.timer = setInterval(() => this.tick(), 1000 / NET_HZ);
    setInterval(() => { this.moveRate = this.moveCount; this.moveCount = 0; }, 1000).unref();
  }
  stop() { clearInterval(this.timer); }

  list(): PlayerPresence[] { return [...this.players.values()].map((e) => e.presence); }
  stats() { return { online: this.players.size, netHz: NET_HZ, movesPerSec: this.moveRate }; }

  /** Личность игрока по сессии сокета: пересчитывается при каждом входе (команда могла измениться). */
  private identity(socket: Socket): Omit<PlayerPresence, 'position' | 'rotation' | 'movementState' | 'actionState' | 'presence' | 'online'> | null {
    const sess = this.store.session(socket.handshake.auth?.token as string | undefined);
    if (!sess) return null;
    const s = this.store.read();
    const demo = socket.handshake.auth?.demo === true && process.env.DEMO_BOTS !== '0';
    if (!sess.userId) {
      const id = 'guest-' + sess.tokenHash.slice(0, 10);
      return { userId: id, displayName: sess.guestName ?? 'Гость', role: 'guest', teamId: null, teamName: null, teamColor: GUEST_COLOR, avatarPreset: avatarFor(id), demo };
    }
    const u = s.users.find((x) => x.id === sess.userId);
    if (!u) return null;
    const team = u.teamId ? s.teams.find((t) => t.id === u.teamId) ?? null : null;
    return {
      userId: u.id, displayName: u.role === 'business' ? (u.companyName ?? u.displayName) : u.displayName, role: u.role,
      teamId: team?.id ?? null, teamName: team?.name ?? null, teamColor: team?.color ?? BUSINESS_COLOR, avatarPreset: avatarFor(u.id), demo,
    };
  }

  attach(socket: Socket) {
    let myId: string | null = null;
    const own = () => (myId ? this.players.get(myId) : undefined);
    const mine = (e: Entry | undefined): e is Entry => !!e && e.socketId === socket.id;
    /** Не больше 30 сообщений в секунду от одного сокета. */
    const allow = (e: Entry) => {
      const now = Date.now();
      if (now - e.msgWindow > 1000) { e.msgWindow = now; e.msgCount = 0; }
      return ++e.msgCount <= 30;
    };

    socket.on('world.player.join', (msg: { p?: unknown; r?: unknown } | undefined, ack?: (r: unknown) => void) => {
      const who = this.identity(socket);
      if (!who) { if (typeof ack === 'function') ack({ error: 'Сессия не найдена — войдите заново' }); return; }
      myId = who.userId;
      const p = Array.isArray(msg?.p) && msg!.p.length === 3 && msg!.p.every(finite) ? (msg!.p as number[]) : [0, 0, 20];
      const entry: Entry = {
        presence: {
          ...who, position: [clamp(p[0], -WORLD_HALF, WORLD_HALF), 0, clamp(p[2], -WORLD_HALF, WORLD_HALF)],
          rotation: finite(msg?.r) ? (msg!.r as number) : 0, movementState: 'idle', actionState: null, presence: 'online', online: true,
        },
        socketId: socket.id, lastMoveAt: Date.now(), lastActionAt: 0, dirty: false, msgWindow: Date.now(), msgCount: 0,
      };
      const replaced = this.players.has(who.userId); // тот же пользователь из другой вкладки — берём новую
      this.players.set(who.userId, entry);
      socket.join('world');
      if (typeof ack === 'function') ack({ you: who.userId, players: this.list(), netHz: NET_HZ });
      socket.to('world').emit(replaced ? 'world.player.update' : 'world.player.join', entry.presence);
    });

    socket.on('world.player.move', (msg: { p?: unknown; r?: unknown; m?: unknown } | undefined) => {
      const e = own();
      if (!mine(e) || !allow(e) || !msg) return;
      if (!Array.isArray(msg.p) || msg.p.length !== 3 || !msg.p.every(finite) || !finite(msg.r)) return;
      const now = Date.now();
      const [x, , z] = msg.p as number[];
      const nx = clamp(x, -WORLD_HALF, WORLD_HALF), nz = clamp(z, -WORLD_HALF, WORLD_HALF);
      // мягкая проверка скорости: слишком далёкий прыжок режется до допустимого шага
      const dt = Math.max(0.05, (now - e.lastMoveAt) / 1000);
      const [ox, , oz] = e.presence.position;
      const d = Math.hypot(nx - ox, nz - oz);
      const maxD = RUN_SPEED * 1.6 * dt + 1.5;
      const k = d > maxD ? maxD / d : 1;
      e.presence.position = [ox + (nx - ox) * k, 0, oz + (nz - oz) * k];
      e.presence.rotation = msg.r as number;
      const m = msg.m === 'walk' || msg.m === 'run' ? (msg.m as MovementState) : 'idle';
      e.presence.movementState = m;
      if (m !== 'idle') { e.lastMoveAt = now; if (e.presence.presence !== 'interacting') e.presence.presence = 'moving'; }
      e.dirty = true;
      this.moveCount++;
    });

    socket.on('world.player.action', (msg: { action?: unknown } | undefined) => {
      const e = own();
      if (!mine(e) || !allow(e)) return;
      const action = msg?.action as Emote;
      if (!EMOTES.includes(action)) return;
      const now = Date.now();
      if (now - e.lastActionAt < 800) return;
      e.lastActionAt = now;
      e.presence.actionState = action;
      this.io.to('world').emit('world.player.action', { userId: e.presence.userId, action, until: now + EMOTE_MS[action] });
      setTimeout(() => { if (e.presence.actionState === action && Date.now() - e.lastActionAt >= EMOTE_MS[action] - 50) e.presence.actionState = null; }, EMOTE_MS[action]);
    });

    socket.on('world.player.interact', (msg: { on?: unknown } | undefined) => {
      const e = own();
      if (!mine(e) || !allow(e)) return;
      e.presence.presence = msg?.on === true ? 'interacting' : 'online';
      e.dirty = true;
    });

    const leave = () => {
      const e = own();
      if (!mine(e)) return;
      this.players.delete(e.presence.userId);
      socket.leave('world');
      this.io.to('world').emit('world.player.leave', { userId: e.presence.userId });
    };
    socket.on('world.player.leave', leave);
    socket.on('disconnect', leave);
  }

  /** Пакет изменений всем в мире. */
  private tick() {
    const now = Date.now();
    const batch: PlayerTick[] = [];
    for (const e of this.players.values()) {
      const p = e.presence;
      let s: PresenceState = p.presence;
      if (s === 'moving' && p.movementState === 'idle') s = 'online';
      if (s === 'online' && now - e.lastMoveAt > IDLE_AFTER_MS) s = 'idle';
      if (s !== p.presence) { p.presence = s; e.dirty = true; }
      if (!e.dirty) continue;
      e.dirty = false;
      batch.push({ id: p.userId, p: p.position, r: p.rotation, m: p.movementState, s: p.presence });
    }
    if (batch.length) this.io.to('world').emit('world.player.state', batch);
  }

  /** Команды, названия и цвета могли измениться (сброс демо) — обновляем личность у всех. */
  refreshIdentities() {
    for (const e of this.players.values()) {
      const sock = this.io.sockets.sockets.get(e.socketId);
      if (!sock) continue;
      const who = this.identity(sock);
      if (!who) continue;
      Object.assign(e.presence, who);
      this.io.to('world').emit('world.player.update', e.presence);
    }
  }
}
