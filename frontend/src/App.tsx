import { lazy, Suspense, type ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { api } from './api';
import { useApp } from './state';
import { Login } from './pages/Login';
import { BusinessHome } from './pages/BusinessHome';
import { TaskEditor } from './pages/TaskEditor';
import { CatalogList } from './pages/CatalogList';
import { TaskPage } from './pages/TaskPage';
import { Scoreboard } from './pages/Scoreboard';
import { hasWebGL } from './world/webgl';

// 3D-мир грузится отдельным чанком: 2D-страницы не ждут Three.js.
const World = lazy(() => import('./pages/World'));

function Guard({ role, children }: { role?: 'business' | 'student'; children: ReactNode }) {
  const { snap } = useApp();
  if (!api.hasSession()) return <Navigate to="/login" replace />;
  if (!snap) return <div className="page-loading">Загрузка…</div>;
  const isBiz = snap.me?.role === 'business';
  if (role === 'business' && !isBiz) return <Navigate to="/world" replace />;
  if (role === 'student' && isBiz) return <Navigate to="/business" replace />;
  return <>{children}</>;
}

function Home() {
  const { snap } = useApp();
  if (!api.hasSession()) return <Navigate to="/login" replace />;
  if (!snap) return <div className="page-loading">Загрузка…</div>;
  if (snap.me?.role === 'business') return <Navigate to="/business" replace />;
  return <Navigate to={hasWebGL() ? '/world' : '/list'} replace />;
}

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/login" element={<Login />} />
      <Route path="/business" element={<Guard role="business"><BusinessHome /></Guard>} />
      <Route path="/business/tasks/:id" element={<Guard role="business"><TaskEditor /></Guard>} />
      <Route
        path="/world"
        element={
          <Guard>
            {hasWebGL() ? (
              <Suspense fallback={<div className="page-loading world-loading">Строим кампус AI Sana…</div>}>
                <World />
              </Suspense>
            ) : (
              <Navigate to="/list?nowebgl=1" replace />
            )}
          </Guard>
        }
      />
      <Route path="/list" element={<Guard><CatalogList /></Guard>} />
      <Route path="/tasks/:id" element={<Guard><TaskPage /></Guard>} />
      <Route path="/teams" element={<Guard><Scoreboard /></Guard>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
