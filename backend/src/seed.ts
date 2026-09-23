import type { Store } from './db.js';
import { emptyFields, type Actor, type Task, type TaskFields } from './contracts.js';
import { Auth, newCode } from './auth.js';

export function seed(store: Store): { accounts: (Actor & { code: string })[] } {
  return store.transaction(() => {
    const accounts: (Actor & { code: string })[] = [];
    const auth = new Auth(store);
    const add = (actor: Actor) => {
      if (store.actor(actor.id)) return;
      const code = newCode();
      auth.addUser(actor, code);
      accounts.push({ ...actor, code });
    };
    add({ id: 'demo-business-cafe', role: 'business', displayName: 'Кафе «Дәм»', teamId: null });
    add({ id: 'demo-business-shop', role: 'business', displayName: 'Магазин «Кітап»', teamId: null });
    const names = ['Bilge', 'Qadam', 'Orion', 'Sana Lab', 'Nomad'];
    for (let i = 0; i < 5; i++) {
      const teamId = `demo-team-${i + 1}`;
      if (!store.get('teams', teamId))
        store.saveTeam({
          id: teamId,
          name: names[i]!,
          interests: [i % 2 ? 'Образование' : 'Общепит'],
          skills: ['Аналитика', 'Веб-разработка'],
          technologies: ['TypeScript', 'Python'],
          avatarPreset: ['fox', 'owl', 'robot', 'cat', 'bear'][i]!,
          color: ['#6366f1', '#059669', '#d97706', '#0891b2', '#db2777'][i]!,
          confirmedPoints: 0,
        });
      add({ id: `demo-student-${i + 1}`, role: 'team', displayName: names[i]!, teamId });
    }
    const samples = [
      {
        title: 'Списания в кафе',
        industry: 'Общепит',
        context: 'В кафе остаётся непроданная еда',
        need: 'Сократить объём списаний',
      },
      {
        title: 'Поиск книг',
        industry: 'Торговля',
        context: 'Продавцы долго ищут книги на полках',
        need: 'Ускорить поиск по каталогу',
      },
      {
        title: 'Прогноз закупок',
        industry: 'Общепит',
        context: 'Запасы ингредиентов закупаются вручную',
        need: 'Планировать закупки по спросу',
      },
      {
        title: 'Учёт возвратов',
        industry: 'Торговля',
        context: 'Возвраты фиксируются в разных таблицах',
        need: 'Собирать обращения в одном месте',
      },
      {
        title: 'Сводка отзывов',
        industry: 'Общепит',
        context: 'Менеджер вручную читает отзывы кафе',
        need: 'Выделять повторяющиеся замечания',
      },
    ];
    samples.forEach((sample, i) => {
      const owner = i % 2 ? 'demo-business-shop' : 'demo-business-cafe';
      const now = new Date(Date.UTC(2026, 8, 23, 8, i)).toISOString();
      const base: TaskFields = { ...emptyFields(), ...sample };
      const make = (id: string, fields: TaskFields, published: boolean): Task => ({
        id,
        businessUserId: owner,
        rawDescription: sample.context,
        draftFields: fields,
        confirmedFields: published ? structuredClone(fields) : null,
        publicationStatus: published ? 'published' : 'draft',
        version: 1,
        clarification: null,
        createdAt: now,
        updatedAt: now,
        publishedAt: published ? now : null,
      });
      if (!store.get('tasks', `demo-draft-${i + 1}`))
        store.saveTask(make(`demo-draft-${i + 1}`, base, false));
      const fields = { ...base };
      if (i >= 1)
        Object.assign(fields, {
          users: 'Менеджеры и сотрудники',
          expectedResult: 'Работающий прототип с экраном результата',
        });
      if (i >= 2)
        Object.assign(fields, {
          dataAvailability: 'available',
          dataSource: 'Синтетический CSV за три месяца',
          constraints: 'Две недели, только синтетические данные',
        });
      if (i >= 3)
        fields.acceptanceCriteria = 'Загрузить пример CSV, обработать его и показать результат без ошибок';
      if (i >= 4)
        Object.assign(fields, {
          contact: 'demo@example.test',
          interactionFormat: 'Две консультации по 20 минут в неделю',
        });
      if (!store.get('tasks', `demo-task-${i + 1}`)) store.saveTask(make(`demo-task-${i + 1}`, fields, true));
      const proposalId = `demo-proposal-${i + 1}`;
      if (!store.get('proposals', proposalId))
        store.saveProposal({
          id: proposalId,
          taskId: `demo-task-${i + 1}`,
          teamId: `demo-team-${i + 1}`,
          idea: 'Сделать понятный прототип для сотрудников',
          plan: 'Изучить процесс, собрать прототип, проверить на примере',
          estimatedTime: 'Две недели',
          prototypeUrl: 'https://github.com/openai/openai-node',
          status: 'pending',
          decisionNote: '',
          version: 1,
          createdAt: now,
        });
    });
    return { accounts };
  });
}
