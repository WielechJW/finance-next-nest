import { verify } from 'argon2';
import { PasswordService } from './password.service.js';

describe('PasswordService', () => {
  const service = new PasswordService();

  it('produces an Argon2id hash and preserves the exact password', async () => {
    const password = '  Moje testowe hasło 123!  ';
    const encoded = await service.hash(password);

    expect(encoded).toMatch(/^\$argon2id\$/);
    expect(encoded).not.toContain(password);
    expect(await verify(encoded, password)).toBe(true);
    expect(await verify(encoded, password.trim())).toBe(false);
  });

  it('uses a different salt for each hash', async () => {
    const password = 'Moje testowe hasło 123!';
    const first = await service.hash(password);
    const second = await service.hash(password);

    expect(first).not.toBe(second);
    expect(await verify(first, password)).toBe(true);
    expect(await verify(second, password)).toBe(true);
  });

  it('also verifies a prepared hash when the account does not exist', async () => {
    const passwords = new PasswordService();
    await passwords.onModuleInit();
    const verification = vi.spyOn(passwords, 'verify');

    expect(
      await passwords.verifyForLogin(undefined, 'incorrect-password'),
    ).toBe(false);
    expect(verification).toHaveBeenCalledWith(
      expect.stringMatching(/^\$argon2id\$/),
      'incorrect-password',
    );
    verification.mockRestore();
  });
});
