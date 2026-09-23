import { Link, useParams } from 'react-router-dom';
import { Header } from '../components/common';
import { TaskPanel } from '../components/TaskPanel';

export function TaskPage() {
  const { id = '' } = useParams();
  return (
    <>
      <Header />
      <main className="page narrow">
        <p><Link to="/list">← Все задачи</Link> · <Link to={`/world?open=${encodeURIComponent(id)}`}>Показать в 3D-мире</Link></p>
        <TaskPanel taskId={id} />
      </main>
    </>
  );
}
