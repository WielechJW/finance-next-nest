import type { Prisma } from '../generated/prisma/client.js';
import type { StrategySnapshot } from './strategy-data.js';
import type { StrategyDecision } from './strategy.js';

export function recordStrategyDecision(
  tx: Prisma.TransactionClient,
  versionId: string,
  snapshot: StrategySnapshot,
  decision: StrategyDecision,
  scheduledSessionOn?: Date,
) {
  const decidedAt = new Date(decision.decidedAt);
  return tx.strategyRun.create({
    data: {
      versionId,
      decidedAt,
      input: snapshot,
      decision,
      ...(scheduledSessionOn
        ? { mode: 'SCHEDULED' as const, scheduledSessionOn }
        : {}),
      ...(decision.kind === 'SIGNAL'
        ? {
            signal: {
              create: {
                instrumentId: decision.instrumentId,
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
    include: { signal: true, version: true },
  });
}
