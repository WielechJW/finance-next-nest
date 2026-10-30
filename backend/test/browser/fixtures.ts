import { test as base, expect } from '@playwright/test';
import { BrowserDatabase, type TestAccount } from './database.js';

export const API_URL = 'http://localhost:3101';
export const FRONTEND_URL = 'http://localhost:3100';

interface Accounts {
  newAccount(): TestAccount;
  register(): Promise<TestAccount>;
  expireSessions(account: TestAccount): Promise<void>;
}

export const test = base.extend<{ accounts: Accounts }>({
  accounts: async ({ request }, use) => {
    const database = new BrowserDatabase();
    try {
      await use({
        newAccount: () => database.newAccount(),
        register: async () => {
          const account = database.newAccount();
          const response = await request.post(API_URL + '/auth/register', {
            headers: { Origin: FRONTEND_URL },
            data: account,
          });
          expect(response.status()).toBe(201);
          return account;
        },
        expireSessions: (account) => database.expireSessions(account),
      });
    } finally {
      await database.dispose();
    }
  },
});

export { expect } from '@playwright/test';
