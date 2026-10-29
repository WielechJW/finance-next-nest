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
});
