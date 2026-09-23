import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { api, ApiError } from './api';
import type { Snapshot } from './shared/types';

interface Ctx {
  snap: Snapshot | null;
  refresh: () => Promise<void>;
  toast: (text: string, kind?: 'ok' | 'err' | 'info') => void;
  /** Выполнить действие API: ошибки показываются пользователю с указанием поля. */
  run: <T>(fn: () => Promise<T>, okText?: string) => Promise<T | undefined>;
  fieldError: { field?: string; text: string } | null;
  clearFieldError: () => void;
}

const AppCtx = createContext<Ctx | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [toastMsg, setToastMsg] = useState<{ text: string; kind: string; id: number } | null>(null);
  const [fieldError, setFieldError] = useState<{ field?: string; text: string } | null>(null);
  const timer = useRef<number | undefined>(undefined);

  const refresh = useCallback(async () => {
    setSnap(await api.snapshot());
  }, []);

  useEffect(() => {
    void refresh();
    return api.onChange(() => void refresh());
  }, [refresh]);

  const toast = useCallback((text: string, kind: 'ok' | 'err' | 'info' = 'ok') => {
    setToastMsg({ text, kind, id: Date.now() });
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setToastMsg(null), 3800);
  }, []);

  const run = useCallback(async <T,>(fn: () => Promise<T>, okText?: string) => {
    setFieldError(null);
    try {
      const r = await fn();
      if (okText) toast(okText, 'ok');
      return r;
    } catch (e) {
      const text = e instanceof ApiError ? e.message : 'Не удалось выполнить действие. Попробуйте ещё раз.';
      setFieldError({ field: e instanceof ApiError ? e.field : undefined, text });
      toast(text, 'err');
      return undefined;
    }
  }, [toast]);

  return (
    <AppCtx.Provider value={{ snap, refresh, toast, run, fieldError, clearFieldError: () => setFieldError(null) }}>
      {children}
      {toastMsg && (
        <div key={toastMsg.id} className={`toast toast-${toastMsg.kind}`} role="status" aria-live="polite">
          {toastMsg.text}
        </div>
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
