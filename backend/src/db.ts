import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Actor, Milestone, Proposal, Task, Team, StoredAiRun } from './contracts.js';

type Entity = Task | Proposal | Milestone | Team;
type Table = 'tasks' | 'proposals' | 'milestones' | 'teams';

export class Store {
  readonly db: Database.Database;
  constructor(path = ':memory:') {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.db.pragma('busy_timeout = 5000');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS teams (id TEXT PRIMARY KEY, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, role TEXT NOT NULL CHECK(role IN ('business','team')), display_name TEXT NOT NULL, team_id TEXT REFERENCES teams(id), code_hash TEXT NOT NULL UNIQUE);
      CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id), body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS proposals (id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id), team_id TEXT NOT NULL REFERENCES teams(id), body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS milestones (id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id), team_id TEXT NOT NULL REFERENCES teams(id), body TEXT NOT NULL, UNIQUE(task_id, team_id));
      CREATE TABLE IF NOT EXISTS score_events (milestone_id TEXT PRIMARY KEY REFERENCES milestones(id), team_id TEXT NOT NULL REFERENCES teams(id), points INTEGER NOT NULL CHECK(points>0), approved_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS idempotency (user_id TEXT NOT NULL REFERENCES users(id), command TEXT NOT NULL, key TEXT NOT NULL, fingerprint TEXT NOT NULL, result_id TEXT NOT NULL, PRIMARY KEY(user_id,command,key));
      CREATE INDEX IF NOT EXISTS idx_tasks_owner ON tasks(owner_id);
      CREATE INDEX IF NOT EXISTS idx_proposals_task ON proposals(task_id);
      CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);
      CREATE TABLE IF NOT EXISTS ai_runs (id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id), body TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS idx_ai_runs_task ON ai_runs(task_id);
      PRAGMA user_version = 1;
    `);
  }
  close() {
    this.db.close();
  }
  saveAiRun(run: StoredAiRun) {
    this.db
      .prepare(
        'INSERT INTO ai_runs(id,task_id,body) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body',
      )
      .run(run.id, run.taskId, JSON.stringify(run));
    // Keep local demo storage bounded; no prompts, secrets or raw outputs in this table.
    this.db
      .prepare(
        'DELETE FROM ai_runs WHERE task_id=? AND rowid NOT IN (SELECT rowid FROM ai_runs WHERE task_id=? ORDER BY rowid DESC LIMIT 100)',
      )
      .run(run.taskId, run.taskId);
  }
  aiRuns(taskId: string): StoredAiRun[] {
    return (
      this.db
        .prepare('SELECT body FROM ai_runs WHERE task_id=? ORDER BY rowid DESC LIMIT 20')
        .all(taskId) as { body: string }[]
    ).map((row) => JSON.parse(row.body) as StoredAiRun);
  }
  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }
  get<T extends Entity>(table: Table, id: string): T | undefined {
    const row = this.db.prepare(`SELECT body FROM ${table} WHERE id=?`).get(id) as
      { body: string } | undefined;
    return row ? (JSON.parse(row.body) as T) : undefined;
  }
  all<T extends Entity>(table: Table): T[] {
    return (this.db.prepare(`SELECT body FROM ${table}`).all() as { body: string }[]).map(
      (row) => JSON.parse(row.body) as T,
    );
  }
  saveTask(task: Task) {
    this.db
      .prepare(
        'INSERT INTO tasks(id,owner_id,body) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body',
      )
      .run(task.id, task.businessUserId, JSON.stringify(task));
  }
  saveProposal(item: Proposal) {
    this.saveRelated('proposals', item);
  }
  saveMilestone(item: Milestone) {
    this.saveRelated('milestones', item);
  }
  private saveRelated(table: 'proposals' | 'milestones', item: Proposal | Milestone) {
    this.db
      .prepare(
        `INSERT INTO ${table}(id,task_id,team_id,body) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body`,
      )
      .run(item.id, item.taskId, item.teamId, JSON.stringify(item));
  }
  saveTeam(team: Team) {
    this.db
      .prepare('INSERT INTO teams(id,body) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body')
      .run(team.id, JSON.stringify(team));
  }
  actor(id: string): Actor | undefined {
    return this.db
      .prepare('SELECT id,role,display_name as displayName,team_id as teamId FROM users WHERE id=?')
      .get(id) as Actor | undefined;
  }
  teamUsers(teamId: string): string[] {
    return (this.db.prepare('SELECT id FROM users WHERE team_id=?').all(teamId) as { id: string }[]).map(
      (row) => row.id,
    );
  }
  isSelected(taskId: string, teamId: string) {
    return this.all<Proposal>('proposals').some(
      (p) => p.taskId === taskId && p.teamId === teamId && p.status === 'selected',
    );
  }
  points(teamId: string): number {
    return (
      this.db
        .prepare('SELECT COALESCE(SUM(points),0) as points FROM score_events WHERE team_id=?')
        .get(teamId) as { points: number }
    ).points;
  }
  commandResult(userId: string, command: string, key: string) {
    return this.db
      .prepare(
        'SELECT fingerprint,result_id AS resultId FROM idempotency WHERE user_id=? AND command=? AND key=?',
      )
      .get(userId, command, key) as { fingerprint: string; resultId: string } | undefined;
  }
  saveCommandResult(userId: string, command: string, key: string, fingerprint: string, resultId: string) {
    this.db
      .prepare('INSERT INTO idempotency(user_id,command,key,fingerprint,result_id) VALUES(?,?,?,?,?)')
      .run(userId, command, key, fingerprint, resultId);
  }
  awardMilestone(item: Milestone & { approvedAt: string }) {
    this.db
      .prepare(
        'INSERT INTO score_events(milestone_id,team_id,points,approved_at) VALUES(?,?,?,?) ON CONFLICT(milestone_id) DO NOTHING',
      )
      .run(item.id, item.teamId, item.points, item.approvedAt);
  }
}
