// Клиент серверного API: REST для действий, Socket.IO для оповещений об изменениях.
// Сессия (токен) — в sessionStorage, поэтому каждая вкладка может войти под своей ролью.
import { io, type Socket } from 'socket.io-client';
import type { Card, ClarifyResult, PublicUser, Snapshot, Team } from '../shared/types';
import { DEMO_EXAMPLE } from './seed';

export class ApiError extends Error {
  constructor(message: string, public status = 400, public field?: string) { super(message); }
}
export interface DemoAccount { id: string; role: 'business' | 'team'; displayName: string; companyName: string | null; team: Team | null }

const SESSION = 'sana-platform-token';
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

function getToken(): string | null {
  try { return sessionStorage.getItem(SESSION); } catch { return null; }
}
function setToken(t: string | null) {
  try { if (t) sessionStorage.setItem(SESSION, t); else sessionStorage.removeItem(SESSION); } catch { /* приватный режим */ }
}

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  const t = getToken();
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(t && t !== 'guest' ? { Authorization: `Bearer ${t}` } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError('Сервер недоступен. Проверьте, что запущен npm run dev.', 0);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && t) { setToken(null); notify(); }
    throw new ApiError(data?.error ?? `Ошибка ${res.status}`, res.status, data?.field);
  }
  return data as T;
}

// ---- общий сокет: оповещения об изменениях данных + мир ----
let socket: Socket | null = null;
let socketToken: string | null | undefined;
export function getSocket(): Socket {
  const t = getToken();
  if (socket && socketToken === t) return socket;
  socket?.disconnect();
  socketToken = t;
  socket = io({ auth: { token: t && t !== 'guest' ? t : null }, transports: ['websocket', 'polling'] });
  socket.on('data.changed', notify);
  return socket;
}

export const api = {
  mode: 'server' as const,
  onChange(fn: () => void) { listeners.add(fn); getSocket(); return () => { listeners.delete(fn); }; },
  hasSession(): boolean { return getToken() !== null; },
  token(): string | null { return getToken(); },
  async demoAccounts(): Promise<DemoAccount[]> { return call('GET', '/api/accounts'); },
  async login(userId: string | null): Promise<PublicUser | null> {
    const old = getToken();
    if (old && old !== 'guest') void call('POST', '/api/logout').catch(() => undefined);
    const r = await call<{ token: string; me: PublicUser | null }>('POST', '/api/login', { userId });
    setToken(r.token);
    getSocket();
    notify();
    return r.me;
  },
  async logout() {
    await call('POST', '/api/logout').catch(() => undefined);
    setToken(null);
    socket?.disconnect(); socket = null; socketToken = undefined;
    notify();
  },
  async snapshot(): Promise<Snapshot> { return call('GET', '/api/snapshot'); },
  async createTask(rawDescription: string, industry: string): Promise<string> {
    return (await call<{ result: string }>('POST', '/api/tasks', { rawDescription, industry })).result;
  },
  async clarify(taskId: string): Promise<ClarifyResult> { return (await call<{ result: ClarifyResult }>('POST', `/api/tasks/${encodeURIComponent(taskId)}/clarify`)).result; },
  async saveDraft(taskId: string, draft: Card, answers?: Record<string, string>) { await call('PUT', `/api/tasks/${encodeURIComponent(taskId)}/draft`, { draft, answers }); },
  async applyAnswers(taskId: string, answers: Record<string, string>) { await call('POST', `/api/tasks/${encodeURIComponent(taskId)}/answers`, { answers }); },
  async confirm(taskId: string): Promise<{ before: number | null; after: number }> {
    return (await call<{ result: { before: number | null; after: number } }>('POST', `/api/tasks/${encodeURIComponent(taskId)}/confirm`)).result;
  },
  async publish(taskId: string) { await call('POST', `/api/tasks/${encodeURIComponent(taskId)}/publish`); },
  async createProposal(taskId: string, p: { idea: string; plan: string; estimatedTime: string; prototypeUrl: string }) { await call('POST', `/api/tasks/${encodeURIComponent(taskId)}/proposals`, p); },
  async decide(proposalId: string, decision: 'select' | 'reject') { await call('POST', `/api/proposals/${encodeURIComponent(proposalId)}/decision`, { decision }); },
  async createMilestone(taskId: string, m: { title: string; acceptanceCriteria: string }) { await call('POST', `/api/tasks/${encodeURIComponent(taskId)}/milestones`, m); },
  async submitEvidence(milestoneId: string, e: { evidenceUrl: string; evidenceNote: string }) { await call('POST', `/api/milestones/${encodeURIComponent(milestoneId)}/evidence`, e); },
  async decideMilestone(milestoneId: string, decision: 'approve' | 'rework') { await call('POST', `/api/milestones/${encodeURIComponent(milestoneId)}/decision`, { decision }); },
  async resetDemo() { await call('POST', '/api/demo/reset'); notify(); },
  demoExample: DEMO_EXAMPLE,
};
