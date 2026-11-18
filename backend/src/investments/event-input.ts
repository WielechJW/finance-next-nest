import { BadRequestException } from '@nestjs/common';
import type { CreateInvestmentEventDto } from './dto/event.dto.js';
import type { PostInvestmentInput } from './posting.js';

const baseFields = ['type', 'idempotencyKey', 'occurredOn', 'timePrecision', 'daySequence',
  'executedAt', 'sourceTimeZone', 'marketSessionOn', 'settledOn'];
const fields = {
  DEPOSIT: ['currency', 'amount'], WITHDRAWAL: ['currency', 'amount'],
  BUY: ['instrumentId', 'quantity', 'unitPrice', 'commission'],
  SELL: ['instrumentId', 'quantity', 'unitPrice', 'commission'],
  DIVIDEND: ['currency', 'grossAmount', 'withholdingTax', 'fee'],
  FEE: ['currency', 'amount'], FX: ['soldCurrency', 'boughtCurrency', 'soldAmount', 'boughtAmount', 'commission'],
  OPENING_POSITION: ['instrumentId', 'quantity', 'totalCost', 'acquiredOn'],
  SPLIT: ['instrumentId', 'numerator', 'denominator'],
} satisfies Record<CreateInvestmentEventDto['type'], string[]>;
const optionalFields = new Set(['commission', 'withholdingTax', 'fee']);

export function toInvestmentInput(accountId: string, dto: CreateInvestmentEventDto): PostInvestmentInput {
  const economicFields = fields[dto.type];
  const entries = Object.entries(dto).filter(([, value]) => value !== undefined);
  if (entries.some(([key]) => !baseFields.includes(key) && !economicFields.includes(key)) ||
      economicFields.some((key) => !optionalFields.has(key) && Reflect.get(dto, key) === undefined)) {
    throw new BadRequestException('Pola operacji nie odpowiadają wybranemu typowi.');
  }
  // DTO validates field types, the discriminator above validates presence and allowed fields;
  // the posting engine validates decimal ranges, signs and economic/timing constraints.
  return { ...Object.fromEntries(entries), accountId } as PostInvestmentInput;
}
