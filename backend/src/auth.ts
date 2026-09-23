import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Actor, Team } from './contracts.js';
import { AppError } from './errors.js';
import { Store } from './db.js';

export const hashSecret = (value: string) => createHash('sha256').update(value).digest('hex');
export const newCode = () => randomBytes(12).toString('base64url');

export class Auth {
  constructor(
    private store: Store,
    private ttlHours = 24,
  ) {}
  addUser(actor: Actor, code: string) {
    this.store.db
      .prepare('INSERT INTO users(id,role,display_name,team_id,code_hash) VALUES(?,?,?,?,?)')
      .run(actor.id, actor.role, actor.displayName, actor.teamId, hashSecret(code));
  }
  login(code: string) {
    const row = this.store.db.prepare('SELECT id FROM users WHERE code_hash=?').get(hashSecret(code)) as
      { id: string } | undefined;
    if (!row)
      throw new AppError(401, 'INVALID_CODE', 'Sign-in code not found. Check the code with the demo organizer.', {
        code: ['Invalid sign-in code'],
      });
    return this.issue(row.id);
  }
  issue(userId: string) {
    const token = randomBytes(32).toString('base64url');
    const expiresAt = Date.now() + this.ttlHours * 3600_000;
    this.store.db.prepare('DELETE FROM sessions WHERE expires_at<=?').run(Date.now());
    this.store.db
      .prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)')
      .run(hashSecret(token), userId, expiresAt);
    return { token, expiresAt: new Date(expiresAt).toISOString(), actor: this.store.actor(userId)! };
  }
  resolve(token?: string): Actor | null {
    if (!token) return null;
    const row = this.store.db
      .prepare('SELECT user_id FROM sessions WHERE token_hash=? AND expires_at>?')
      .get(hashSecret(token), Date.now()) as { user_id: string } | undefined;
    if (!row) throw new AppError(401, 'SESSION_EXPIRED', 'Session ended. Please sign in again.', {}, 'sign_in');
    return this.store.actor(row.user_id) ?? null;
  }
  logout(token: string) {
    this.store.db.prepare('DELETE FROM sessions WHERE token_hash=?').run(hashSecret(token));
  }
  createTeam(input: Omit<Team, 'id' | 'confirmedPoints'>) {
    return this.store.transaction(() => {
      const team: Team = { ...input, id: randomUUID(), confirmedPoints: 0 };
      this.store.saveTeam(team);
      const code = newCode();
      const actor: Actor = { id: randomUUID(), role: 'team', displayName: team.name, teamId: team.id };
      this.addUser(actor, code);
      return { ...this.issue(actor.id), team, code };
    });
  }
}
