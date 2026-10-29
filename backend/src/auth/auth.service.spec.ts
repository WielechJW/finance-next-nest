import { InternalServerErrorException, Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { UsersService } from '../users/users.service.js';
import { AuthService } from './auth.service.js';
import { PasswordService } from './password.service.js';

describe('AuthService failures', () => {
  afterEach(() => vi.restoreAllMocks());

  it('does not create an account or expose passwords when hashing fails', async () => {
    const password = 'private-test-password';
    const create = vi.fn();
    const log = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => {});
    const module = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UsersService, useValue: { create } },
        {
          provide: PasswordService,
          useValue: { hash: vi.fn().mockRejectedValue(new Error(password)) },
        },
      ],
    }).compile();

    await expect(
      module
        .get(AuthService)
        .register({ email: 'test@example.invalid', password }),
    ).rejects.toEqual(
      new InternalServerErrorException('Nie udało się utworzyć konta.'),
    );
    expect(create).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalled();
    expect(JSON.stringify(log.mock.calls)).not.toContain(password);
  });

  it('sanitizes verification errors instead of reporting invalid credentials', async () => {
    const password = 'private-test-password';
    const log = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => {});
    const module = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: UsersService,
          useValue: {
            findByEmailForLogin: vi
              .fn()
              .mockResolvedValue({ passwordHash: 'private-hash' }),
          },
        },
        {
          provide: PasswordService,
          useValue: {
            verifyForLogin: vi
              .fn()
              .mockRejectedValue(new Error(`${password} private-hash`)),
          },
        },
      ],
    }).compile();

    await expect(
      module
        .get(AuthService)
        .login({ email: 'test@example.invalid', password }),
    ).rejects.toEqual(
      new InternalServerErrorException('Nie udało się zalogować.'),
    );
    expect(log).toHaveBeenCalled();
    expect(JSON.stringify(log.mock.calls)).not.toContain(password);
    expect(JSON.stringify(log.mock.calls)).not.toContain('private-hash');
  });
});
