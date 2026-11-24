import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { InvestmentAccountsService } from '../investments/accounts.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { movingAverage } from './moving-average.js';
import {
  collectStrategyData,
  copySnapshot,
  restoreSnapshot,
  type StrategySnapshot,
} from './strategy-data.js';

export type StrategyScope = {
  userId: string;
  portfolioId: string;
  accountId: string;
};
const instrumentSelect = { id: true, ticker: true, mic: true, currency: true };
const latest = { orderBy: { number: 'desc' }, take: 1 } as const;
const withLatest = {
  instrument: { select: instrumentSelect },
  versions: latest,
} satisfies Prisma.StrategyInclude;
const withSignal = {
  signal: true,
  version: true,
} satisfies Prisma.StrategyRunInclude;
const accountWhere = ({ userId, portfolioId, accountId }: StrategyScope) => ({
  accountId,
  account: { portfolioId, portfolio: { userId } },
});
const strategyWhere = (scope: StrategyScope, id: string) => ({
  id,
  ...accountWhere(scope),
});

function ruleParameters(value: unknown) {
  try {
    return movingAverage.parseParameters(value);
  } catch (error) {
    throw new BadRequestException(
      error instanceof Error
        ? error.message
        : 'Nieprawidłowe parametry strategii.',
    );
  }
}

async function lockStrategy(
  tx: Prisma.TransactionClient,
  scope: StrategyScope,
  strategyId: string,
) {
  const [row] = await tx.$queryRaw<{ id: string }[]>`
    SELECT s."id" FROM "Strategy" s
    JOIN "InvestmentAccount" a ON a."id" = s."accountId"
    JOIN "Portfolio" p ON p."id" = a."portfolioId"
    WHERE s."id" = ${strategyId}::uuid AND a."id" = ${scope.accountId}::uuid
      AND p."id" = ${scope.portfolioId}::uuid AND p."userId" = ${scope.userId}::uuid
    FOR UPDATE OF s
  `;
  if (!row) throw new NotFoundException('Nie znaleziono strategii.');
}

@Injectable()
export class StrategiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accounts: InvestmentAccountsService,
  ) {}

  async list(scope: StrategyScope) {
    await this.accounts.getAccount(
      scope.userId,
      scope.portfolioId,
      scope.accountId,
    );
    return this.prisma.strategy.findMany({
      where: accountWhere(scope),
      include: withLatest,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
  }

  async create(
    scope: StrategyScope,
    name: string,
    instrumentId: string,
    input: unknown,
  ) {
    const account = await this.accounts.getAccount(
      scope.userId,
      scope.portfolioId,
      scope.accountId,
    );
    if (account.archivedAt)
      throw new ConflictException('Rachunek jest zarchiwizowany.');
    const parameters = ruleParameters(input);
    const instrument = await this.prisma.instrument.findUnique({
      where: { id: instrumentId },
      select: { id: true },
    });
    if (!instrument) throw new NotFoundException('Nie znaleziono instrumentu.');
    return this.prisma.strategy.create({
      data: {
        accountId: scope.accountId,
        instrumentId,
        name,
        versions: {
          create: {
            number: 1,
            ruleKey: movingAverage.key,
            codeVersion: movingAverage.codeVersion,
            parameters,
          },
        },
      },
      include: withLatest,
    });
  }

  async versions(scope: StrategyScope, id: string) {
    await this.get(scope, id);
    return this.prisma.strategyVersion.findMany({
      where: { strategy: strategyWhere(scope, id) },
      orderBy: { number: 'desc' },
    });
  }

  async revise(scope: StrategyScope, id: string, input: unknown) {
    const parameters = ruleParameters(input);
    return this.prisma.$transaction(async (tx) => {
      await lockStrategy(tx, scope, id);
      const current = await tx.strategyVersion.findFirstOrThrow({
        where: { strategyId: id },
        orderBy: { number: 'desc' },
      });
      const old = ruleParameters(current.parameters);
      if (
        current.ruleKey === movingAverage.key &&
        current.codeVersion === movingAverage.codeVersion &&
        old.fastSessions === parameters.fastSessions &&
        old.slowSessions === parameters.slowSessions &&
        old.validForMinutes === parameters.validForMinutes
      )
        return current;
      return tx.strategyVersion.create({
        data: {
          strategyId: id,
          number: current.number + 1,
          ruleKey: movingAverage.key,
          codeVersion: movingAverage.codeVersion,
          parameters,
        },
      });
    });
  }

  async run(scope: StrategyScope, id: string, decidedAt = new Date()) {
    if (
      !Number.isFinite(decidedAt.getTime()) ||
      decidedAt > new Date() ||
      decidedAt.getUTCFullYear() < 1900
    )
      throw new BadRequestException(
        'Podaj aktualny lub wcześniejszy czas decyzji.',
      );
    return this.prisma.$transaction(
      async (tx) => {
        await lockStrategy(tx, scope, id);
        const strategy = await tx.strategy.findUniqueOrThrow({
          where: { id },
          include: withLatest,
        });
        const version = strategy.versions[0];
        const key = { versionId: version.id, decidedAt };
        const existing = await tx.strategyRun.findUnique({
          where: { versionId_decidedAt: key },
          include: withSignal,
        });
        if (existing) return existing;
        if (
          version.ruleKey !== movingAverage.key ||
          version.codeVersion !== movingAverage.codeVersion
        )
          throw new ConflictException(
            'Wersja kodu tej reguły jest niedostępna.',
          );
        const recorded = await collectStrategyData(
          tx,
          scope.accountId,
          strategy.instrument,
          decidedAt,
          ruleParameters(version.parameters),
        );
        const decision = movingAverage.evaluate(recorded);
        return tx.strategyRun.create({
          data: {
            ...key,
            input: copySnapshot(recorded),
            decision,
            ...(decision.kind === 'SIGNAL'
              ? {
                  signal: {
                    create: {
                      instrumentId: strategy.instrument.id,
                      side: decision.side,
                      rationale: decision.reason,
                      decidedAt,
                      expectedSessionOn: new Date(
                        decision.evidence.expectedSessionOn + 'T00:00:00Z',
                      ),
                      validUntil: new Date(decision.validUntil),
                    },
                  },
                }
              : {}),
          },
          include: withSignal,
        });
      },
      { timeout: 20000 },
    );
  }

  async runs(scope: StrategyScope, id: string, page: number, pageSize: number) {
    await this.get(scope, id);
    return this.prisma.strategyRun.findMany({
      where: { version: { strategy: strategyWhere(scope, id) } },
      orderBy: [{ decidedAt: 'desc' }, { id: 'desc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        decidedAt: true,
        decision: true,
        signal: true,
        version: { select: { number: true, codeVersion: true, ruleKey: true } },
      },
    });
  }

  async replay(scope: StrategyScope, id: string, runId: string) {
    const run = await this.prisma.strategyRun.findFirst({
      where: { id: runId, version: { strategy: strategyWhere(scope, id) } },
      include: withSignal,
    });
    if (!run) throw new NotFoundException('Nie znaleziono uruchomienia.');
    if (
      run.version.ruleKey !== movingAverage.key ||
      run.version.codeVersion !== movingAverage.codeVersion
    )
      throw new ConflictException('Wersja kodu tej reguły jest niedostępna.');
    const snapshot = run.input as unknown as StrategySnapshot;
    const computed = movingAverage.evaluate(
      restoreSnapshot(snapshot, ruleParameters(run.version.parameters)),
    );
    return { run, computed };
  }

  private async get(scope: StrategyScope, id: string) {
    const strategy = await this.prisma.strategy.findFirst({
      where: strategyWhere(scope, id),
      select: { id: true },
    });
    if (!strategy) throw new NotFoundException('Nie znaleziono strategii.');
    return strategy;
  }
}
