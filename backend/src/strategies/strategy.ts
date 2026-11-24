export type StrategyInstrument = {
  id: string;
  mic: string;
  currency: 'PLN' | 'USD';
};

export type StrategyBar = {
  id: string;
  instrumentId: string;
  sessionOn: string;
  availableAt: Date;
  revision: number;
  close: string;
};

export type StrategySplit = {
  id: string;
  instrumentId: string;
  exDate: string;
  availableAt: Date;
};

export type StrategyUniverseMember = {
  ticker: string;
  mic: string;
  currency: 'PLN' | 'USD';
  listedOn: string;
  delistedOn?: string | null;
};
export type StrategyFundamentalReport = Pick<
  StrategyUniverseMember,
  'mic' | 'ticker'
> & {
  id: string;
  periodEnd: string;
  publishedAt: string;
  availableAt: string;
  revision: number;
  scope: 'CONSOLIDATED' | 'STANDALONE';
  sourceUrl: string;
  facts: { metric: string; amount: string; unit: string }[];
};

export type StrategyInput<P> = {
  instrument: StrategyInstrument;
  decidedAt: Date;
  // Balances already reconstructed at decidedAt and denominated in instrument.currency.
  portfolio: { cash: string; quantity: string };
  bars: readonly StrategyBar[];
  splits: readonly StrategySplit[];
  universe?: readonly StrategyUniverseMember[];
  reports?: readonly StrategyFundamentalReport[];
  parameters: P;
};

export type StrategyEvidence = {
  expectedSessionOn: string | null;
  barIds: string[];
  splitIds: string[];
};

export type NoSignalReason =
  | 'CALENDAR_UNAVAILABLE'
  | 'INSUFFICIENT_HISTORY'
  | 'STALE_PRICE'
  | 'INVALID_PRICE'
  | 'SPLIT_IN_LOOKBACK'
  | 'NO_CROSSOVER'
  | 'PORTFOLIO_INELIGIBLE'
  | 'INVALID_PORTFOLIO';

export type StrategyDecision = {
  decidedAt: string;
  instrumentId: string;
  evidence: StrategyEvidence;
} & (
  | { kind: 'NO_SIGNAL'; reason: NoSignalReason }
  | {
      kind: 'SIGNAL';
      side: 'BUY' | 'SELL';
      reason: string;
      validUntil: string;
      evidence: StrategyEvidence & { expectedSessionOn: string };
      averages: {
        previousFast: string;
        previousSlow: string;
        fast: string;
        slow: string;
      };
    }
);

export interface StrategyRule<P> {
  key: string;
  codeVersion: string;
  requiredFundamentals?: readonly string[];
  parseParameters(input: unknown): P;
  evaluate(input: StrategyInput<P>): StrategyDecision;
}
