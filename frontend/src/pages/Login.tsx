import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, type DemoAccount } from '../api';
import { useApp } from '../state';
import { AvatarBadge } from '../world/AvatarBadge';

export function Login() {
  const [accounts, setAccounts] = useState<DemoAccount[]>([]);
  const nav = useNavigate();
  const { run } = useApp();
  const [params] = useSearchParams();
  useEffect(() => { void api.demoAccounts().then(setAccounts); }, []);

  // Быстрый демо-вход по ссылке: #/login?as=<id аккаунта | guest> — удобно готовить вкладки к защите.
  useEffect(() => {
    const as = params.get('as');
    if (!as) return;
    void (async () => {
      const r = await run(() => api.login(as === 'guest' ? null : as).then((u) => u));
      const next = params.get('next');
      if (r !== undefined) nav(next && next.startsWith('/') && !next.startsWith('//') ? next : r?.role === 'business' ? '/business' : '/world', { replace: true });
    })();
  }, [params]); // eslint-disable-line react-hooks/exhaustive-deps

  async function enter(id: string | null, to: string) {
    const r = await run(() => api.login(id).then(() => true));
    if (r) nav(to);
  }

  return (
    <div className="login">
      <div className="login-hero">
        <h1>AI Sana · Площадь задач</h1>
        <p>Бизнес превращает короткое описание проблемы в понятную карточку задачи. Студенческие команды гуляют по 3D-площади, выбирают павильоны-задачи и отправляют предложения.</p>
        <p className="muted small">Тестовый вход для демонстрации: без пароля, фото и анкет. Каждая вкладка браузера может войти под своей ролью — в 3D-мире вы увидите друг друга онлайн.</p>
      </div>
      <div className="login-cols">
        <section>
          <h2>Студенческая команда</h2>
          <div className="acc-grid">
            {accounts.filter((a) => a.role === 'team').map((a) => (
              <button key={a.id} className="acc" onClick={() => enter(a.id, '/world')}>
                {a.team && <AvatarBadge preset={a.team.avatarPreset} color={a.team.color} />}
                <span><b>{a.displayName}</b><small>{a.team?.skills.join(', ')}</small></span>
              </button>
            ))}
            <button className="acc guest" onClick={() => enter(null, '/world')}>
              <AvatarBadge preset="guest" color="#9aa3b2" />
              <span><b>Гость</b><small>только просмотр</small></span>
            </button>
          </div>
        </section>
        <section>
          <h2>Представитель бизнеса</h2>
          <div className="acc-grid">
            {accounts.filter((a) => a.role === 'business').map((a) => (
              <button key={a.id} className="acc" onClick={() => enter(a.id, '/business')}>
                <span className="biz-ic" aria-hidden>🏢</span>
                <span><b>{a.companyName}</b><small>{a.displayName.split(' — ')[0]}</small></span>
              </button>
            ))}
          </div>
        </section>
      </div>
      <button className="btn ghost small reset" onClick={() => { if (confirm('Сбросить демо-данные на сервере для всех пользователей?')) void run(() => api.resetDemo(), 'Демо-данные сброшены'); }}>Сбросить демо-данные</button>
    </div>
  );
}
