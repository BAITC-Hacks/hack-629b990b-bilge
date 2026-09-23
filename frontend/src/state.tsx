// Общее состояние вкладки: снимок BFF (bootstrap + каталог + кабинет + рейтинг) и данные мира.
// Перечитывается при подключении сокета и по событиям invalidate/sync.required (debounce 50 мс, как в памятке BFF).
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { ApiError, api, getSocket, getToken, setToken, type SnapshotView, type WorldView } from './api';

interface Ctx {
  snap: SnapshotView | null;
  world: WorldView | null;
  /** Счётчик изменений: открытые детальные экраны перечитываются при его росте. */
  revision: number;
  refresh: () => Promise<void>;
  toast: (text: string, kind?: 'ok' | 'err' | 'info') => void;
  /** Выполнить команду BFF: сообщение сервера (feedback) или ошибка с полями показываются пользователю. */
  run: <T>(fn: () => Promise<T>, okText?: string) => Promise<T | undefined>;
  fieldErrors: Record<string, string[]>;
  clearFieldErrors: () => void;
  signedIn: boolean;
}

const AppCtx = createContext<Ctx | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [snap, setSnap] = useState<SnapshotView | null>(null);
  const [world, setWorld] = useState<WorldView | null>(null);
  const [revision, setRevision] = useState(0);
  const [toastMsg, setToastMsg] = useState<{ text: string; kind: string; id: number } | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const timer = useRef<number | undefined>(undefined);
  const pending = useRef<number | undefined>(undefined);

  const toast = useCallback((text: string, kind: 'ok' | 'err' | 'info' = 'ok') => {
    setToastMsg({ text, kind, id: Date.now() });
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setToastMsg(null), 4200);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const [s, w] = await Promise.all([api.snapshot(), api.world()]);
      setSnap(s.data);
      setWorld(w.data);
      setRevision((r) => r + 1);
    } catch (e) {
      if (e instanceof ApiError && (e.code === 'SESSION_EXPIRED' || e.code === 'INVALID_SESSION')) {
        setToken(null);
        toast('Сессия завершена. Войдите снова.', 'info');
        const s = await api.snapshot().catch(() => null);
        if (s) setSnap(s.data);
      } else toast(e instanceof ApiError ? e.message : 'Сервер недоступен', 'err');
    }
  }, [toast]);

  useEffect(() => {
    const sock = getSocket();
    const schedule = () => {
      window.clearTimeout(pending.current);
      pending.current = window.setTimeout(() => void refresh(), 50);
    };
    sock.on('connect', schedule);
    sock.on('sync.required', schedule);
    sock.on('invalidate', schedule);
    void refresh();
    return () => { sock.off('connect', schedule); sock.off('sync.required', schedule); sock.off('invalidate', schedule); };
  }, [refresh]);

  const run = useCallback(async <T,>(fn: () => Promise<T>, okText?: string) => {
    setFieldErrors({});
    try {
      const r = await fn();
      const fb = (r as { feedback?: { message?: string } | null } | undefined)?.feedback?.message;
      if (fb || okText) toast(fb ?? okText!, 'ok');
      return r;
    } catch (e) {
      if (e instanceof ApiError) {
        setFieldErrors(e.fieldErrors ?? {});
        toast(e.message, 'err');
        if (e.code === 'SESSION_EXPIRED') setToken(null);
      } else toast('Не удалось выполнить действие. Попробуйте ещё раз.', 'err');
      return undefined;
    }
  }, [toast]);

  return (
    <AppCtx.Provider value={{ snap, world, revision, refresh, toast, run, fieldErrors, clearFieldErrors: () => setFieldErrors({}), signedIn: !!getToken() && !!snap?.bootstrap.actor }}>
      {children}
      {toastMsg && (
        <div key={toastMsg.id} className={`toast toast-${toastMsg.kind}`} role="status" aria-live="polite">{toastMsg.text}</div>
      )}
    </AppCtx.Provider>
  );
}

export function useApp(): Ctx {
  const c = useContext(AppCtx);
  if (!c) throw new Error('AppProvider отсутствует');
  return c;
}

export function usePrefersReducedMotion(): boolean {
  const [r, setR] = useState(() => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const m = window.matchMedia('(prefers-reduced-motion: reduce)');
    const fn = () => setR(m.matches);
    m.addEventListener('change', fn);
    return () => m.removeEventListener('change', fn);
  }, []);
  return r;
}

/** Ошибки полей BFF: ключи вида 'fields.title', 'title', '_form'. */
export function useFieldError(field: string): string | null {
  const { fieldErrors } = useApp();
  const list = fieldErrors[field] ?? fieldErrors[`fields.${field}`];
  return list?.[0] ?? null;
}
