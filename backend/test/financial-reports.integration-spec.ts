import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { FinancialReportsService } from '../src/fundamental-analysis/financial-reports.service.js';
import { investmentHttpContext } from './support/investment-http.js';
import { reportPdf } from './support/fundamental-pdf.js';

const root = '/fundamental-analysis/reports';

describe('Issuer report library (PostgreSQL)', () => {
  let context: Awaited<ReturnType<typeof investmentHttpContext>>;
  const instrumentIds: string[] = [];

  beforeAll(async () => {
    context = await investmentHttpContext();
  });
  afterEach(async () => {
    const where = { id: { in: instrumentIds } };
    const instruments = await context.prisma.instrument.findMany({
      where,
      select: { companyId: true },
    });
    await context.cleanup();
    await context.prisma.instrument.deleteMany({ where });
    await context.prisma.company.deleteMany({
      where: {
        id: {
          in: instruments.flatMap(({ companyId }) =>
            companyId ? [companyId] : [],
          ),
        },
      },
    });
    instrumentIds.length = 0;
  });
  afterAll(async () => {
    await context?.app.close();
  });

  async function setup() {
    const owner = await context.signIn();
    const instrument = await context.prisma.instrument.create({
      data: {
        ticker: 'R' + randomUUID().slice(0, 8),
        mic: 'XNAS',
        name: 'Issuer Co.',
        currency: 'USD',
      },
    });
    instrumentIds.push(instrument.id);
    const metadata = {
      instrumentId: instrument.id,
      filename: 'issuer.pdf',
      scope: 'CONSOLIDATED',
      periodKind: 'ANNUAL',
      currency: 'USD',
      periodStart: '2025-02-01',
      periodEnd: '2026-01-31',
      publishedOn: '2026-03-01',
      sourceUrl: 'https://issuer.example/report.pdf',
    };
    return {
      owner,
      instrument,
      upload: (file = reportPdf(), changes: Record<string, string> = {}) =>
        owner.agent
          .post(root)
          .set('Origin', context.origin)
          .field({ ...metadata, ...changes })
          .attach('report', file, 'issuer.pdf'),
    };
  }

  it('creates versioned reports and reuses the saved text after a concurrent upload', async () => {
    const { owner, instrument, upload } = await setup();
    const [first, retry] = await Promise.all([
      upload().expect(201),
      upload().expect(201),
    ]);
    expect(retry.body).toEqual(first.body);
    expect(first.body).toMatchObject({
      version: 1,
      periodStart: '2025-02-01',
      periodEnd: '2026-01-31',
      publishedOn: '2026-03-01',
      company: { name: 'Issuer Co.' },
      instrument: { id: instrument.id, mic: 'XNAS' },
      facts: expect.arrayContaining([
        {
          metric: 'REVENUE',
          amount: '120',
          unit: 'mln USD',
          period: '2025',
          page: 1,
        },
      ]),
    });
    const revision = await upload(reportPdf('130'), {
      publishedOn: '2026-03-04',
    }).expect(201);
    expect(revision.body).toMatchObject({
      version: 2,
      publishedOn: '2026-03-04',
    });
    expect(revision.body.id).not.toBe(first.body.id);
    const response = await owner.agent
      .get(root)
      .expect(200)
      .expect('Cache-Control', 'no-store');
    expect(
      response.body.items.map((item: { version: number }) => item.version),
    ).toEqual([2, 1]);
    expect(
      response.body.items.every(
        (item: object) => !('pdf' in item) && !('parsedReport' in item),
      ),
    ).toBe(true);
    await owner.agent
      .get(root + '/' + first.body.id + '/pdf')
      .expect(200)
      .expect('Content-Type', /application\/pdf/);
    const saved = await context.app
      .get(FinancialReportsService)
      .forAnalysis(owner.userId, revision.body.id);
    expect(saved.document.pages[0]?.text).toContain('130');
    expect(saved.instrumentId).toBe(instrument.id);
  });

  it('keeps PDFs and their facts private and removes the complete saved version', async () => {
    const { owner, upload } = await setup();
    const other = await context.signIn();
    const created = await upload().expect(201);
    const path = root + '/' + created.body.id;
    await request(context.app.getHttpServer()).get(root).expect(401);
    expect((await other.agent.get(root).expect(200)).body.items).toEqual([]);
    await other.agent.get(path + '/pdf').expect(404);
    await other.agent.delete(path).set('Origin', context.origin).expect(404);
    await other.agent
      .post('/fundamental-analysis/chat')
      .set('Origin', context.origin)
      .field('question', 'Podsumuj.')
      .field('reportId', created.body.id)
      .expect(404);
    await owner.agent.delete(path).set('Origin', context.origin).expect(204);
    await owner.agent.get(path + '/pdf').expect(404);
    expect(
      await context.prisma.fundamentalFact.count({
        where: { reportId: created.body.id },
      }),
    ).toBe(0);
  });

  it('validates metadata and leaves absent quarterly reports out of the library', async () => {
    const { owner, upload } = await setup();
    await upload(reportPdf(), { publishedOn: '2025-03-01' }).expect(400);
    await upload(reportPdf(), {
      sourceUrl: 'http://issuer.example/report.pdf',
    }).expect(400);
    await upload(reportPdf(), { currency: 'PLN' })
      .expect(201)
      .expect(({ body }) => {
        expect(body.facts).toEqual([]);
      });
    await upload(reportPdf('115'), {
      periodStart: '2025-01-01',
      periodEnd: '2025-12-31',
      publishedOn: '2026-02-15',
    })
      .expect(201)
      .expect(({ body }) => {
        expect(body).toMatchObject({ version: 1, periodEnd: '2025-12-31' });
      });
    const response = await owner.agent.get(root).expect(200);
    expect(
      response.body.items.map(
        (item: { periodKind: string }) => item.periodKind,
      ),
    ).toEqual(['ANNUAL', 'ANNUAL']);
  });
});
