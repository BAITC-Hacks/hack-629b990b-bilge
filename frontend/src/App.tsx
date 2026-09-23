import { lazy, Suspense, type ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { getToken } from './api';
import { useApp } from './state';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { TaskEditor } from './pages/TaskEditor';
import { ReviewDesk } from './pages/ReviewDesk';
import { MilestonePage } from './pages/MilestonePage';
import { CatalogList } from './pages/CatalogList';
import { TaskPage } from './pages/TaskPage';
import { Scoreboard } from './pages/Scoreboard';
import { hasWebGL } from './world/webgl';

// The 3D world loads as a separate chunk: 2D pages don't wait for Three.js.
const World = lazy(() => import('./pages/World'));

/** The screen waits for the first BFF snapshot; personal screens need a session with the right role (the server still checks permissions). */
function Guard({ role, children }: { role?: 'business' | 'member'; children: ReactNode }) {
  const { snap } = useApp();
  if (!snap) return <div className="page-loading">Loading…</div>;
  const actor = snap.bootstrap.actor;
  if (role && (!getToken() || !actor)) return <Navigate to="/login" replace />;
  if (role === 'business' && actor?.role !== 'business') return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}

function Home() {
  const { snap } = useApp();
  if (!snap) return <div className="page-loading">Loading…</div>;
  const actor = snap.bootstrap.actor;
  if (!actor && !getToken()) return <Navigate to="/login" replace />;
  if (actor?.role === 'business') return <Navigate to="/dashboard" replace />;
  return <Navigate to={hasWebGL() ? '/world' : '/list'} replace />;
}

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/login" element={<Login />} />
      <Route path="/dashboard" element={<Guard role="member"><Dashboard /></Guard>} />
      <Route path="/business" element={<Navigate to="/dashboard" replace />} />
      <Route path="/business/tasks/:id" element={<Guard role="business"><TaskEditor /></Guard>} />
      <Route path="/business/tasks/:id/review" element={<Guard role="business"><ReviewDesk /></Guard>} />
      <Route path="/milestones/:id" element={<Guard role="member"><MilestonePage /></Guard>} />
      <Route
        path="/world"
        element={
          <Guard>
            {hasWebGL() ? (
              <Suspense fallback={<div className="page-loading world-loading">Building the AI Sana campus…</div>}>
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
