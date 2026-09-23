// 2D-каталог (FR-07): все опубликованные задачи, сортировка балл → новее → id, фильтры отрасли и уровня.
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useApp } from '../state';
import { Header, LevelBadge } from '../components/common';
import { LEVELS } from '../shared/scoring';

export function CatalogList() {
  const { snap } = useApp();
  const [params] = useSearchParams();
  const [industry, setIndustry] = useState('');
  const [level, setLevel] = useState('');
  const tasks = useMemo(
    () => (snap?.tasks ?? []).filter((t) => (!industry || t.industry === industry) && (!level || t.score.levelKey === level)),
    [snap, industry, level],
  );
  if (!snap) return null;
  return (
    <>
      <Header />
      <main className="page">
        {params.get('nowebgl') && <div className="alert">3D недоступен в этом браузере (нет WebGL) — открыт полноценный 2D-каталог со всеми задачами и действиями.</div>}
        <div className="page-head">
          <div>
            <h1>Все задачи</h1>
            <p className="muted">Видны все опубликованные задачи. Порядок: готовность по убыванию, при равенстве — более новая публикация.</p>
          </div>
          {snap.me?.role !== 'business' && <Link className="btn" to="/world">Открыть 3D-площадь</Link>}
        </div>
        <div className="filters">
          <label>Отрасль<select value={industry} onChange={(e) => setIndustry(e.target.value)}><option value="">Все</option>{snap.industries.map((i) => <option key={i}>{i}</option>)}</select></label>
          <label>Уровень<select value={level} onChange={(e) => setLevel(e.target.value)}><option value="">Все</option>{LEVELS.map((l) => <option key={l.key} value={l.key}>{l.label} ({l.min}+)</option>)}</select></label>
          <button className="btn ghost small" onClick={() => { setIndustry(''); setLevel(''); }}>Сбросить</button>
          <span className="muted small">Показано {tasks.length} из {snap.tasks.length}</span>
        </div>
        <ol className="catalog">
          {tasks.map((t, i) => (
            <li key={t.id} className={`citem lvl-${t.score.levelKey}`}>
              <span className="rank">№{snap.tasks.indexOf(t) + 1}</span>
              <Link to={`/tasks/${t.id}`} className="cbody">
                <b>{t.title}</b>
                <span className="muted small">{t.companyName} · {t.industry} · предложений: {t.offersCount}{t.selectedTeams.length ? ` · выбрана: ${t.selectedTeams.map((x) => x.name).join(', ')}` : ''}</span>
                {t.score.levelKey === 'draft' && <span className="note-draft">Нужны уточнения — отклик доступен</span>}
              </Link>
              <LevelBadge score={t.score} />
              <span className="sr-only">позиция {i + 1}</span>
            </li>
          ))}
          {tasks.length === 0 && <li className="muted">Нет задач по фильтрам.</li>}
        </ol>
      </main>
    </>
  );
}
