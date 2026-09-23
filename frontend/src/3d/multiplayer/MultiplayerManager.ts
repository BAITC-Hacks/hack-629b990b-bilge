// World network layer: join, sending movement at 12 Hz (only on change + a rare "heartbeat"), emotes, leave,
// receiving other players' state and the server's GRAND TRIUMPH event.
import type { Socket } from 'socket.io-client';
import { getSocket, getWorldName } from '../../api';
import type { Emote, MovementState, PlayerPresence, PlayerTick, TriumphInfo } from '../../shared/types';
import { NET_HZ } from '../../shared/world';
import { PresenceStore } from './PresenceStore';

export interface LocalMotion { x: number; z: number; r: number; m: MovementState }

export class MultiplayerManager {
  store = new PresenceStore();
  private socket: Socket;
  private timer: ReturnType<typeof setInterval> | null = null;
  private last = { x: NaN, z: NaN, r: NaN, m: 'idle' as MovementState, at: 0 };
  private getMotion: () => LocalMotion;
  onTriumph: ((t: TriumphInfo) => void) | null = null;
  sentPerSec = 0;
  private sentCount = 0;
  private statTimer: ReturnType<typeof setInterval>;

  constructor(getMotion: () => LocalMotion) {
    this.getMotion = getMotion;
    this.socket = getSocket();
    this.statTimer = setInterval(() => { this.sentPerSec = this.sentCount; this.sentCount = 0; }, 1000);
    this.socket.on('connect', this.join);
    this.socket.on('disconnect', this.onDisconnect);
    this.socket.on('world.player.join', this.onJoin);
    this.socket.on('world.player.update', this.onJoin);
    this.socket.on('world.player.leave', this.onLeave);
    this.socket.on('world.player.state', this.onState);
    this.socket.on('world.player.action', this.onAction);
    this.socket.on('world.triumph', this.onTriumphMsg);
    if (this.socket.connected) this.join();
    this.timer = setInterval(this.sendMove, 1000 / NET_HZ);
  }

  private join = () => {
    const m = this.getMotion();
    this.socket.emit('world.player.join', { p: [m.x, 0, m.z], r: m.r, name: getWorldName() }, (res: { you?: string; players?: PlayerPresence[]; netHz?: number; error?: string }) => {
      if (!res || res.error || !res.you) { this.store.setConnection(false, res?.error ?? 'No response from server'); return; }
      this.store.netHz = res.netHz ?? NET_HZ;
      this.store.reset(res.you, res.players ?? []);
      this.store.setConnection(true);
    });
  };
  private onDisconnect = () => this.store.setConnection(false, 'Connection to server lost, reconnecting…');
  private onJoin = (p: PlayerPresence) => this.store.upsert(p);
  private onLeave = (m: { userId: string }) => this.store.remove(m.userId);
  private onState = (batch: PlayerTick[]) => this.store.applyTicks(batch);
  private onAction = (m: { userId: string; action: Emote; until: number }) => this.store.action(m.userId, m.action, m.until);
  private onTriumphMsg = (t: TriumphInfo) => this.onTriumph?.(t);

  /** Not every frame: 12 times per second and only if something changed (plus a "heartbeat" every 2 s). */
  private sendMove = () => {
    if (!this.socket.connected || !this.store.connected) return;
    const m = this.getMotion();
    const now = performance.now();
    const moved = Math.hypot(m.x - this.last.x, m.z - this.last.z) > 0.02 || Math.abs(m.r - this.last.r) > 0.02 || m.m !== this.last.m;
    if (!moved && now - this.last.at < 2000) return;
    this.socket.volatile.emit('world.player.move', { p: [round(m.x), 0, round(m.z)], r: round(m.r), m: m.m });
    this.last = { ...m, at: now };
    this.sentCount++;
  };

  emote(action: Emote) { this.socket.emit('world.player.action', { action }); }
  interacting(on: boolean) { this.socket.emit('world.player.interact', { on }); }

  dispose() {
    this.socket.emit('world.player.leave');
    if (this.timer) clearInterval(this.timer);
    clearInterval(this.statTimer);
    this.socket.off('connect', this.join);
    this.socket.off('disconnect', this.onDisconnect);
    this.socket.off('world.player.join', this.onJoin);
    this.socket.off('world.player.update', this.onJoin);
    this.socket.off('world.player.leave', this.onLeave);
    this.socket.off('world.player.state', this.onState);
    this.socket.off('world.player.action', this.onAction);
    this.socket.off('world.triumph', this.onTriumphMsg);
    this.store.dispose();
  }
}

const round = (v: number) => Math.round(v * 100) / 100;
