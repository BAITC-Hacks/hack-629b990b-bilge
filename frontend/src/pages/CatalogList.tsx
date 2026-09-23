// 2D catalog (GET /catalog): published tasks, server-side sorting (score → newest → id), filters and search.
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, type CatalogView } from '../api';
import { useApp } from '../state';
import { Header, LevelBadge, levelClass } from '../components/common';

export function CatalogList() {
  const { revision } = useApp();
  const [params] = useSearchParams();
  const [f, setF] = useState({ search: '', industry: '', level: '' as '' | 'draft' | 'working' | 'ready' | 'priority', page: 1 });
  const [view, setView] = useState<CatalogView | null>(null);
  useEffect(() => {
    const t = setTimeout(() => {
      void api.catalog({ search: f.search, industry: f.industry, level: f.level || undefined, page: f.page, pageSize: 20 }).then((r) => setView(r.data)).catch(() => undefined);
    }, 150);
    return () => clearTimeout(t);
  }, [f, revision]);
  return (
    <>
      <Header />
      <main className="page">
        <div className="page-head"><h1>All tasks</h1><Link className="btn" to="/world">View in 3D world</Link></div>
        {params.get('nowebgl') && <div className="alert">3D mode isn't available on this device — showing the task list with the same data and actions.</div>}
        <div className="filters">
          <label>Search<input value={f.search} onChange={(e) => setF({ ...f, search: e.target.value, page: 1 })} /></label>
          <label>Industry<select value={f.industry} onChange={(e) => setF({ ...f, industry: e.target.value, page: 1 })}><option value="">All</option>{view?.filters.industries.map((i) => <option key={i}>{i}</option>)}</select></label>
          <label>Level<select value={f.level} onChange={(e) => setF({ ...f, level: e.target.value as typeof f.level, page: 1 })}><option value="">All</option>{view?.filters.levels.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}</select></label>
        </div>
        {view?.emptyState && <p className="muted">{view.emptyState.title}. {view.emptyState.message}</p>}
        <ol className="catalog">
          {view?.cards.map((c, i) => (
            <li key={c.id} className={`citem ${levelClass(c.readinessLevel)}`}>
              <span className="rank">#{(f.page - 1) * 20 + i + 1}</span>
              <Link className="cbody" to={`/tasks/${c.id}`}>
                <b>{c.title}</b>
                <span className="muted small">{c.industry} · applications: {c.offersCount}{c.selectedTeams.length ? ` · selected: ${c.selectedTeams.map((t) => t.name).join(', ')}` : ''}{c.pendingMilestones ? ' · milestone in review' : ''}</span>
                {c.needsClarification && <span className="note-draft">Needs clarification — you can still apply</span>}
              </Link>
              <LevelBadge value={c.readinessScore} level={c.readinessLevel} label={c.readinessLabel} />
            </li>
          ))}
        </ol>
        {view && view.pagination.totalPages > 1 && (
          <div className="row"><button className="btn ghost small" disabled={f.page <= 1} onClick={() => setF({ ...f, page: f.page - 1 })}>← Back</button><span>{f.page} / {view.pagination.totalPages}</span><button className="btn ghost small" disabled={f.page >= view.pagination.totalPages} onClick={() => setF({ ...f, page: f.page + 1 })}>Next →</button></div>
        )}
      </main>
    </>
  );
}
