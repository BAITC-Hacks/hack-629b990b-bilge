// SQLite-хранилище (встроенный node:sqlite). Состояние платформы хранится одним JSON-документом
// с номером ревизии: запись идёт в транзакции, событие рассылается только после успешной записи.
// Для прототипа это проще нормализованной схемы и сохраняет те же правила (src/shared/domain.ts).
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import path from 'node:path';
import { seedState, upgradeState, type State } from '../src/shared/domain';

export interface Session { tokenHash: string; userId: string | null; guestName: string | null; expiresAt: number }

const hash = (t: string) => createHash('sha256').update(t).digest('hex');

export class Store {
  private db: DatabaseSync;
  private state: State;

  constructor(file: string, private sessionTtlMs = 24 * 3600e3) {
    if (file !== ':memory:') mkdirSync(path.dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS app_state (id INTEGER PRIMARY KEY CHECK (id = 1), revision INTEGER NOT NULL, doc TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id TEXT, guest_name TEXT, expires_at INTEGER NOT NULL);
    `);
    const row = this.db.prepare('SELECT doc FROM app_state WHERE id = 1').get() as { doc: string } | undefined;
    let s: State | null = null;
    try { s = row ? (JSON.parse(row.doc) as State) : null; } catch { s = null; }
    if (!s || !Array.isArray(s.tasks)) { s = seedState(); this.persist(s); }
    else if (upgradeState(s)) this.persist(s);
    this.state = s;
  }

  read(): State { return this.state; }

  /**
   * Изменение состояния: правила применяются к копии; при ошибке исходное состояние не меняется.
   * Возвращает результат операции и новую ревизию.
   */
  mutate<T>(fn: (s: State) => T): { result: T; revision: number } {
    const draft = structuredClone(this.state);
    const result = fn(draft);
    draft.revision++;
    this.persist(draft);
    this.state = draft;
    return { result, revision: draft.revision };
  }

  reset(): number {
    const s = seedState();
    s.revision = this.state.revision + 1;
    this.persist(s);
    this.state = s;
    return s.revision;
  }

  private persist(s: State) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare('INSERT INTO app_state (id, revision, doc, updated_at) VALUES (1, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET revision = excluded.revision, doc = excluded.doc, updated_at = excluded.updated_at')
        .run(s.revision, JSON.stringify(s), new Date().toISOString());
      this.db.exec('COMMIT');
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }

  // ---- сессии (демо-вход без пароля; в БД хранится только хэш токена) ----
  createSession(userId: string | null): string {
    const token = randomBytes(24).toString('base64url');
    const guestName = userId ? null : `Гость ${token.slice(0, 3).toUpperCase()}`;
    this.db.prepare('INSERT INTO sessions (token_hash, user_id, guest_name, expires_at) VALUES (?, ?, ?, ?)').run(hash(token), userId, guestName, Date.now() + this.sessionTtlMs);
    return token;
  }
  session(token: string | undefined | null): Session | null {
    if (!token || token.length > 100) return null;
    const row = this.db.prepare('SELECT token_hash, user_id, guest_name, expires_at FROM sessions WHERE token_hash = ?').get(hash(token)) as
      { token_hash: string; user_id: string | null; guest_name: string | null; expires_at: number } | undefined;
    if (!row || row.expires_at < Date.now()) return null;
    return { tokenHash: row.token_hash, userId: row.user_id, guestName: row.guest_name, expiresAt: row.expires_at };
  }
  deleteSession(token: string) { this.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hash(token)); }
}
