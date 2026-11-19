import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { InvestmentAccountsService } from '../investments/accounts.service.js';
import { InvestmentPostingService } from '../investments/posting.service.js';
import { reconcileSplit } from '../investments/split-reconciliation.js';
import { eventInclude } from '../investments/events.service.js';
import { replayBalances } from '../investments/posting.js';
import { InvestmentCalculation as D } from '../investments/precision.js';

export type ActionConfirmation = { expectedRevision: number; idempotencyKey: string; occurredOn: string; daySequence: number; acknowledged: boolean; grossAmount?: string; withholdingTax?: string; fee?: string };
const actionKey = (action: { source: string; instrumentId: string; kind: string; exDate: Date }) => `${action.source}:${action.instrumentId}:${action.kind}:${action.exDate.toISOString().slice(0, 10)}`;

@Injectable()
export class CorporateActionsService {
  constructor(private readonly prisma: PrismaService, private readonly accounts: InvestmentAccountsService, private readonly posting: InvestmentPostingService) {}
  async proposals(userId: string, portfolioId: string, accountId: string) {
    await this.accounts.getAccount(userId, portfolioId, accountId);
    const history = await this.prisma.investmentEvent.findMany({ where: { accountId, activeSlot: 1 }, include: eventInclude });
    const ids = new Set(history.flatMap(row => [row.trade?.instrumentId, row.openingLot?.instrumentId, row.split?.instrumentId].filter((id): id is string => !!id)));
    const actions = await this.prisma.corporateAction.findMany({ where: { instrumentId: { in: [...ids] }, currentSlot: 1 }, include: { instrument: true }, orderBy: [{ exDate: 'desc' }, { id: 'asc' }], take: 100 });
    const recorded = await this.prisma.investmentEvent.findMany({ where: { accountId, sourceKey: 'corporate-actions' }, select: { id: true, externalOperationId: true, corporateActionId: true } });
    return actions.flatMap(action => {
      const quantity = replayBalances(history.filter(event => event.occurredOn < action.exDate)).securities[action.instrumentId] ?? '0';
      if (!new D(quantity).gt(0)) return [];
      const applied = recorded.find(row => row.externalOperationId === actionKey(action));
      const ledger = action.kind === 'SPLIT' ? reconcileSplit(history, action) : null;
      return [{ id: action.id, revision: action.revision, kind: action.kind, instrument: { id: action.instrument.id, ticker: action.instrument.ticker, currency: action.instrument.currency },
        exDate: action.exDate.toISOString().slice(0, 10), paymentOn: action.paymentOn?.toISOString().slice(0, 10) ?? null,
        quantity, suggestedGrossAmount: action.amount ? new D(action.amount.toString()).times(quantity).toFixed(2) : null,
        numerator: action.numerator?.toFixed(10) ?? null, denominator: action.denominator?.toFixed(10) ?? null,
        recordedEventId: ledger?.eventId ?? applied?.id ?? null,
        recordedRevisionDiffers: ledger ? !!(ledger.eventId || applied) && !ledger.matches : !!applied && applied.corporateActionId !== action.id }];
    });
  }
  async confirm(userId: string, portfolioId: string, accountId: string, actionId: string, input: ActionConfirmation) {
    await this.accounts.getAccount(userId, portfolioId, accountId);
    if (input.acknowledged !== true) throw new BadRequestException('Potwierdź rzeczywiste zdarzenie na rachunku.');
    const action = await this.prisma.corporateAction.findUnique({ where: { id: actionId } });
    if (!action) throw new NotFoundException('Nie znaleziono zdarzenia korporacyjnego.');
    if (action.currentSlot !== 1 || action.revision !== input.expectedRevision) throw new ConflictException('Dostawca zmienił zdarzenie. Odśwież propozycję.');
    const proposal = (await this.proposals(userId, portfolioId, accountId)).find(row => row.id === actionId);
    if (!proposal || input.occurredOn < proposal.exDate) throw new BadRequestException('Brak uprawnionej pozycji lub niepoprawna data.');
    const common = { accountId, idempotencyKey: input.idempotencyKey, occurredOn: input.occurredOn, timePrecision: 'DATE' as const,
      daySequence: input.daySequence, source: 'SYSTEM' as const, sourceKey: 'corporate-actions', externalOperationId: actionKey(action), corporateActionId: action.id };
    if (action.kind === 'SPLIT') {
      if (input.occurredOn !== proposal.exDate || !action.numerator || !action.denominator || input.grossAmount !== undefined || input.withholdingTax !== undefined || input.fee !== undefined) throw new BadRequestException('Split wymaga daty zdarzenia i nie przyjmuje kwot gotówki.');
      return this.posting.postForUser(userId, { ...common, type: 'SPLIT', instrumentId: action.instrumentId, numerator: action.numerator.toFixed(), denominator: action.denominator.toFixed() });
    }
    if (!action.currency || !input.grossAmount) throw new BadRequestException('Podaj rzeczywistą kwotę brutto dywidendy z rachunku.');
    return this.posting.postForUser(userId, { ...common, type: 'DIVIDEND', currency: action.currency, grossAmount: input.grossAmount, withholdingTax: input.withholdingTax, fee: input.fee });
  }
}
