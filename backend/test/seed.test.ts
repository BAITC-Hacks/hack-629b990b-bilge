import { expect, it } from 'vitest';
import { Store } from '../src/db.js';
import { seed } from '../src/seed.js';
import type { Task } from '../src/contracts.js';
import { calculateScore } from '../src/domain/score.js';
import { Auth } from '../src/auth.js';

it('seeds five of each required dataset across all levels without duplicate accounts', () => {
  const store = new Store();
  try {
    const first = seed(store);
    expect(first.accounts).toHaveLength(7);
    for (const account of first.accounts)
      expect(new Auth(store).login(account.code).actor.id).toBe(account.id);
    const tasks = store.all<Task>('tasks');
    expect(tasks.filter((t) => t.publicationStatus === 'draft')).toHaveLength(5);
    const published = tasks.filter((t) => t.publicationStatus === 'published');
    expect(published).toHaveLength(5);
    expect(new Set(published.map((t) => calculateScore(t.confirmedFields!).level)).size).toBe(4);
    expect(store.all('teams')).toHaveLength(5);
    expect(store.all('proposals')).toHaveLength(5);
    expect(seed(store).accounts).toHaveLength(0);
    expect(store.all('tasks')).toHaveLength(10);
  } finally {
    store.close();
  }
});
