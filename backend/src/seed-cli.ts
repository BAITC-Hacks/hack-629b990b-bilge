import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Store } from './db.js';
import { seed } from './seed.js';
import { readConfig } from './config.js';

export function seedWithAccounts(store: Store, accountFile = resolve('demo-accounts.local.json')) {
  const result = seed(store);
  if (result.accounts.length) {
    const previous: unknown[] = existsSync(accountFile) ? JSON.parse(readFileSync(accountFile, 'utf8')) : [];
    writeFileSync(accountFile, JSON.stringify([...previous, ...result.accounts], null, 2), {
      encoding: 'utf8',
      mode: 0o600,
    });
  }
  return { created: result.accounts.length, accountFile };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const config = readConfig();
  const store = new Store(config.DATABASE_PATH);
  try {
    const result = seedWithAccounts(store);
    console.log(`Seed ready. New accounts: ${result.created}. Codes: ${result.accountFile}`);
  } finally {
    store.close();
  }
}
