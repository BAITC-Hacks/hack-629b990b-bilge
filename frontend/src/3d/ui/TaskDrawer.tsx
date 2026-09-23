// Боковая карточка задачи поверх 3D (мир остаётся виден): та же карточка BFF, что и в 2D.
import { TaskPanel } from '../../components/TaskPanel';

export function TaskDrawer({ taskId, onClose }: { taskId: string; onClose: () => void }) {
  return (
    <aside className="task-drawer" aria-label="Карточка задачи">
      <TaskPanel taskId={taskId} onClose={onClose} />
    </aside>
  );
}
