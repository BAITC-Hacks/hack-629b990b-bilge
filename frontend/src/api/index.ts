// Единственный источник данных фронтенда — BFF из backend/ (типизированный клиент backend/client/index.ts).
// Токен вкладки хранится в sessionStorage: две вкладки могут войти под разными ролями.
// Socket.IO того же сервера: инвалидации экранов (invalidate/sync.required) и присутствие в 3D-мире.
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
  try { if (t) sessionStorage.setItem(TOKEN, t); else sessionStorage.removeItem(TOKEN); } catch { /* приватный режим */ }
  reconnectSocket();
}
/** Имя участника для таблички в мире (у команды в BFF один общий вход). */
export function getWorldName(): string {
  try { return sessionStorage.getItem(NAME) ?? ''; } catch { return ''; }
}
export function setWorldName(n: string) {
  try { sessionStorage.setItem(NAME, n.trim().slice(0, 24)); } catch { /* ок */ }
}

export const api = createSanaClient({ getToken });

// ---- общий сокет вкладки ----
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
/** После входа/выхода права сокета должны соответствовать текущей вкладке. */
export function reconnectSocket() {
  if (!socket) return;
  socket.disconnect().connect();
}

/** Все опубликованные карточки (каталог отдаёт максимум 50 на страницу). */
export async function allCards() {
  const first = (await api.catalog({ pageSize: 50, page: 1 })).data;
  const cards = [...first.cards];
  for (let p = 2; p <= first.pagination.totalPages; p++) cards.push(...(await api.catalog({ pageSize: 50, page: p })).data.cards);
  return cards;
}
