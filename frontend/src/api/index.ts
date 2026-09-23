// The frontend's only data source is the BFF in backend/ (typed client backend/client/index.ts).
// The tab token lives in sessionStorage: two tabs can sign in with different roles.
// Socket.IO on the same server: screen invalidations (invalidate/sync.required) and 3D-world presence.
import { io, type Socket } from 'socket.io-client';
import { ApiError, createSanaClient } from '../../../backend/client/index';

export { ApiError };
export type * from '../../../backend/client/index';

const TOKEN = 'sana.token';
const NAME = 'sana.worldName';

export function getToken(): string | null {
  try { return sessionStorage.getItem(TOKEN); } catch { return null; }
}
export function setToken(t: string | null) {
  try { if (t) sessionStorage.setItem(TOKEN, t); else sessionStorage.removeItem(TOKEN); } catch { /* private mode */ }
  reconnectSocket();
}
/** Participant name for the in-world nameplate (a team shares one login in the BFF). */
export function getWorldName(): string {
  try { return sessionStorage.getItem(NAME) ?? ''; } catch { return ''; }
}
export function setWorldName(n: string) {
  try { sessionStorage.setItem(NAME, n.trim().slice(0, 24)); } catch { /* ok */ }
}

export const api = createSanaClient({ getToken });

// ---- shared tab socket ----
let socket: Socket | null = null;
export function getSocket(): Socket {
  if (socket) return socket;
  socket = io({
    path: '/socket.io',
    transports: ['websocket', 'polling'],
    auth: (done) => { const t = getToken(); done(t ? { token: t } : {}); },
  });
  return socket;
}
/** After sign-in/sign-out the socket's permissions must match the current tab. */
export function reconnectSocket() {
  if (!socket) return;
  socket.disconnect().connect();
}

/** All published cards (the catalog returns at most 50 per page). */
export async function allCards() {
  const first = (await api.catalog({ pageSize: 50, page: 1 })).data;
  const cards = [...first.cards];
  for (let p = 2; p <= first.pagination.totalPages; p++) cards.push(...(await api.catalog({ pageSize: 50, page: p })).data.cards);
  return cards;
}
