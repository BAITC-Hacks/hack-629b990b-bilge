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
    add({ id: 'demo-business-cafe', role: 'business', displayName: 'Dam Cafe', teamId: null });
    add({ id: 'demo-business-shop', role: 'business', displayName: 'Kitap Bookshop', teamId: null });
    const names = ['Bilge', 'Qadam', 'Orion', 'Sana Lab', 'Nomad'];
    for (let i = 0; i < 5; i++) {
      const teamId = `demo-team-${i + 1}`;
      if (!store.get('teams', teamId))
        store.saveTeam({
          id: teamId,
          name: names[i]!,
          interests: [i % 2 ? 'Education' : 'Food service'],
          skills: ['Analytics', 'Web development'],
          technologies: ['TypeScript', 'Python'],
          avatarPreset: ['fox', 'owl', 'robot', 'cat', 'bear'][i]!,
          color: ['#6366f1', '#059669', '#d97706', '#0891b2', '#db2777'][i]!,
          confirmedPoints: 0,
        });
      add({ id: `demo-student-${i + 1}`, role: 'team', displayName: names[i]!, teamId });
    }
    const samples = [
      {
        title: 'Cafe food waste',
        industry: 'Food service',
        context: 'The cafe is left with unsold food',
        need: 'Reduce the amount of written-off food',
      },
      {
        title: 'Book search',
        industry: 'Retail',
        context: 'Sellers spend a long time looking for books on shelves',
        need: 'Speed up catalog search',
      },
      {
        title: 'Purchase forecast',
        industry: 'Food service',
        context: 'Ingredient stock is purchased manually',
        need: 'Plan purchases based on demand',
      },
      {
        title: 'Returns tracking',
        industry: 'Retail',
        context: 'Returns are recorded in different spreadsheets',
        need: 'Collect return requests in one place',
      },
      {
        title: 'Review digest',
        industry: 'Food service',
        context: 'A manager reads cafe reviews manually',
        need: 'Highlight recurring complaints',
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
          users: 'Managers and staff',
          expectedResult: 'A working prototype with a results screen',
        });
      if (i >= 2)
        Object.assign(fields, {
          dataAvailability: 'available',
          dataSource: 'Synthetic CSV covering three months',
          constraints: 'Two weeks, synthetic data only',
        });
      if (i >= 3)
        fields.acceptanceCriteria = 'Upload a sample CSV, process it and show the result without errors';
      if (i >= 4)
        Object.assign(fields, {
          contact: 'demo@example.test',
          interactionFormat: 'Two 20-minute consultations per week',
        });
      if (!store.get('tasks', `demo-task-${i + 1}`)) store.saveTask(make(`demo-task-${i + 1}`, fields, true));
      const proposalId = `demo-proposal-${i + 1}`;
      if (!store.get('proposals', proposalId))
        store.saveProposal({
          id: proposalId,
          taskId: `demo-task-${i + 1}`,
          teamId: `demo-team-${i + 1}`,
          idea: 'Build a clear prototype for staff',
          plan: 'Study the process, build a prototype, test it on an example',
          estimatedTime: 'Two weeks',
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
