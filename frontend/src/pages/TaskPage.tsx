import { Link, useParams } from 'react-router-dom';
import { useApp } from '../state';
import { Header } from '../components/common';
import { TaskPanel } from '../components/TaskPanel';

export function TaskPage() {
  const { id } = useParams();
  const { snap } = useApp();
  if (!snap) return null;
  const task = snap.tasks.find((t) => t.id === id);
  return (
    <>
      <Header />
      <main className="page narrow">
        <Link to="/list">← Все задачи</Link>
        {task ? <TaskPanel task={task} /> : <p>Задача не найдена или ещё не опубликована.</p>}
      </main>
    </>
  );
}
