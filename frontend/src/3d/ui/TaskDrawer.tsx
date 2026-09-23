// Side task card over the 3D scene (the world stays visible): the same BFF card as in 2D.
import { TaskPanel } from '../../components/TaskPanel';

export function TaskDrawer({ taskId, onClose }: { taskId: string; onClose: () => void }) {
  return (
    <aside className="task-drawer" aria-label="Task card">
      <TaskPanel taskId={taskId} onClose={onClose} />
    </aside>
  );
}
