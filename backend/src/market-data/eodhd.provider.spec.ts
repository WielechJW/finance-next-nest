import { EodhdProvider } from './eodhd.provider.js';
import { MarketDataBudgetService } from './budget.service.js';

describe('EODHD access', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
  it('does not fetch market data after the durable budget refuses a reservation', async () => {
    vi.stubEnv('EODHD_API_TOKEN', 'synthetic-secret');
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ apiRequests: 20, dailyRateLimit: 20, apiRequestsDate: new Date().toISOString().slice(0, 10) }));
    vi.stubGlobal('fetch', fetchMock);
    const budget = { reserve: vi.fn().mockRejectedValue(new Error('budget')) } as unknown as MarketDataBudgetService;
    await expect(new EodhdProvider(budget).catalog('WAR')).rejects.toThrow('budget');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('replaces network exceptions with a safe error, without leaking credential URLs', async () => {
    vi.stubEnv('EODHD_API_TOKEN', 'synthetic-secret');
    vi.stubGlobal('fetch', vi.fn(async url => { throw new Error(String(url)); }));
    const provider = new EodhdProvider({} as MarketDataBudgetService);
    await expect(provider.catalog('WAR')).rejects.toMatchObject({ code: 'network' });
    try { await provider.catalog('WAR'); } catch (error) { expect(String(error)).not.toContain('synthetic-secret'); }
  });
});
