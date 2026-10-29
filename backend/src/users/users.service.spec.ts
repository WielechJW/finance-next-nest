import {
  ConflictException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { UsersService } from './users.service.js';

describe('UsersService errors', () => {
  const create = vi.fn();
  const input = { email: 'test@example.invalid', passwordHash: 'private-hash' };
  let service: UsersService;

  beforeEach(async () => {
    create.mockReset();
    const module = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: PrismaService, useValue: { user: { create } } },
      ],
    }).compile();
    service = module.get(UsersService);
  });

  afterEach(() => vi.restoreAllMocks());

  it('reports a unique constraint conflict as 409', async () => {
    const log = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => {});
    create.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('private-hash', {
        code: 'P2002',
        clientVersion: '7.10.1',
        meta: { target: ['email'] },
      }),
    );

    await expect(service.create(input)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(log).not.toHaveBeenCalled();
  });

  it('sanitizes unexpected database failures in both responses and logs', async () => {
    const log = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => {});
    create.mockRejectedValueOnce(new Error('query arguments: private-hash'));

    await expect(service.create(input)).rejects.toEqual(
      new InternalServerErrorException('Nie udało się utworzyć konta.'),
    );
    expect(log).toHaveBeenCalled();
    expect(JSON.stringify(log.mock.calls)).not.toContain('private-hash');
  });
});
