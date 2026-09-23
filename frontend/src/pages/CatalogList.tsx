// 2D-каталог (GET /catalog): опубликованные задачи, сортировка сервера (балл → новее → id), фильтры и поиск.
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
        <div className="page-head"><h1>Все задачи</h1><Link className="btn" to="/world">Смотреть в 3D-мире</Link></div>
        {params.get('nowebgl') && <div className="alert">3D-режим недоступен на этом устройстве — открыт список задач с теми же данными и действиями.</div>}
        <div className="filters">
          <label>Поиск<input value={f.search} onChange={(e) => setF({ ...f, search: e.target.value, page: 1 })} /></label>
          <label>Отрасль<select value={f.industry} onChange={(e) => setF({ ...f, industry: e.target.value, page: 1 })}><option value="">Все</option>{view?.filters.industries.map((i) => <option key={i}>{i}</option>)}</select></label>
          <label>Уровень<select value={f.level} onChange={(e) => setF({ ...f, level: e.target.value as typeof f.level, page: 1 })}><option value="">Все</option>{view?.filters.levels.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}</select></label>
        </div>
        {view?.emptyState && <p className="muted">{view.emptyState.title}. {view.emptyState.message}</p>}
        <ol className="catalog">
          {view?.cards.map((c, i) => (
            <li key={c.id} className={`citem ${levelClass(c.readinessLevel)}`}>
              <span className="rank">#{(f.page - 1) * 20 + i + 1}</span>
              <Link className="cbody" to={`/tasks/${c.id}`}>
                <b>{c.title}</b>
                <span className="muted small">{c.industry} · предложений: {c.offersCount}{c.selectedTeams.length ? ` · выбрано: ${c.selectedTeams.map((t) => t.name).join(', ')}` : ''}{c.pendingMilestones ? ' · этап на проверке' : ''}</span>
                {c.needsClarification && <span className="note-draft">Нужны уточнения — откликнуться всё равно можно</span>}
              </Link>
              <LevelBadge value={c.readinessScore} level={c.readinessLevel} label={c.readinessLabel} />
            </li>
          ))}
        </ol>
        {view && view.pagination.totalPages > 1 && (
          <div className="row"><button className="btn ghost small" disabled={f.page <= 1} onClick={() => setF({ ...f, page: f.page - 1 })}>← Назад</button><span>{f.page} / {view.pagination.totalPages}</span><button className="btn ghost small" disabled={f.page >= view.pagination.totalPages} onClick={() => setF({ ...f, page: f.page + 1 })}>Вперёд →</button></div>
        )}
      </main>
    </>
  );
}
