// Боковая карточка задачи поверх 3D (мир остаётся виден): те же данные и действия, что в 2D.
import { Link } from 'react-router-dom';
import type { PublicTask, Snapshot } from '../../shared/types';
import { TaskPanel } from '../../components/TaskPanel';

export function TaskDrawer({ task, snap, onClose }: { task: PublicTask; snap: Snapshot; onClose: () => void }) {
  const me = snap.me;
  const owner = me?.role === 'business' && snap.ownTasks.some((t) => t.id === task.id);
  const responded = me?.role === 'team' && snap.ownProposals.some((p) => p.taskId === task.id);
  return (
    <aside className="task-drawer" aria-label={`Задача: ${task.title}`}>
      {owner && (
        <div className="drawer-cta">
          Это ваша задача. <Link className="btn small" to={`/business/tasks/${task.id}`}>Открыть предложения</Link>
        </div>
      )}
      {me?.role === 'team' && (
        <div className="drawer-cta">
          {responded ? 'Ваша команда откликнулась на эту задачу.' : 'Откликнуться может любая команда — форма ниже.'}
          {!responded && <a className="btn small" href="#proposal" onClick={(e) => { e.preventDefault(); document.getElementById('proposal')?.scrollIntoView({ behavior: 'smooth' }); }}>Откликнуться</a>}
        </div>
      )}
      <TaskPanel task={task} onClose={onClose} />
    </aside>
  );
}
