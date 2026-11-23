import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type {
  Request,
  Response as ExpressResponse,
  NextFunction,
} from 'express';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/config/configure-app.js';
import { getFrontendOrigin } from '../src/config/cors.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { SessionService } from '../src/sessions/session.service.js';
import { UsersService } from '../src/users/users.service.js';

function reportPdf(): Buffer {
  const fragments: [number, number, string][] = [
    [40, 750, 'CONSOLIDATED STATEMENTS OF OPERATIONS'],
    [40, 728, 'In millions of USD'],
    [390, 708, '2024'],
    [465, 708, '2025'],
    [40, 688, 'Total revenue'],
    [400, 688, '100'],
    [475, 688, '120'],
    [40, 668, 'Operating income'],
    [400, 668, '8'],
    [475, 668, '9'],
    [40, 648, 'Net income'],
    [400, 648, '4'],
    [475, 648, '5'],
  ];
  const stream =
    'BT /F1 12 Tf ' +
    fragments
      .map(([x, y, text]) => '1 0 0 1 ' + x + ' ' + y + ' Tm (' + text + ') Tj')
      .join(' ') +
    ' ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = objects.map((object, index) => {
    const offset = pdf.length;
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
    return `${String(offset).padStart(10, '0')} 00000 n \n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 6\n0000000000 65535 f \n${offsets.join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf);
}

describe('Fundamental analysis chat', () => {
  let app: INestApplication<App>;
  const userId = '11111111-2222-4333-8444-555555555555';
  const endpoint = '/fundamental-analysis/chat';
  const lmStudio = vi.fn<typeof fetch>();

  beforeEach(async () => {
    lmStudio.mockReset();
    vi.stubGlobal('fetch', lmStudio);
    vi.stubEnv('LM_STUDIO_BASE_URL', 'http://127.0.0.1:1234/v1');
    vi.stubEnv('LM_STUDIO_MODEL', '');
    vi.stubEnv('LM_STUDIO_WSL_WINDOWS', '0');
    const testingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue({})
      .overrideProvider(UsersService)
      .useValue({ findPublicById: () => ({ id: userId }) })
      .overrideProvider(SessionService)
      .useValue({
        config: { trustProxyHops: 0 },
        clearCookie: () => undefined,
        middleware: (
          req: Request,
          _res: ExpressResponse,
          next: NextFunction,
        ) => {
          if (req.get('X-Test-Session')) {
            req.session = { userId } as Request['session'];
          }
          next();
        },
      })
      .compile();
    app = testingModule.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    await app.close();
  });

  it('extracts PDF text with page references and includes prior turns when asking a follow-up', async () => {
    const reply = 'Przychody to 120 mln USD w 2025 r. [str. 1]';
    lmStudio.mockImplementation(async (url, init) => {
      if (url === 'http://127.0.0.1:1234/v1/models') {
        return Response.json({
          data: [{ id: 'qwen/qwen3.5-9b' }, { id: 'other-model' }],
        });
      }
      if (
        typeof init?.body === 'string' &&
        JSON.parse(init.body).reasoning_effort !== 'none'
      ) {
        return Response.json({
          choices: [
            {
              finish_reason: 'length',
              message: {
                content: '',
                reasoning_content: 'Wykorzystano limit.',
              },
            },
          ],
        });
      }
      return Response.json({ choices: [{ message: { content: reply } }] });
    });

    const chat = () =>
      request(app.getHttpServer())
        .post(endpoint)
        .set('Origin', getFrontendOrigin())
        .set('X-Test-Session', '1');
    await chat()
      .field('question', '')
      .attach('report', reportPdf(), 'report.pdf')
      .expect(200)
      .expect({
        answer: reply,
        coverage: {
          totalPages: 1,
          pagesWithText: 1,
          pagesInContext: 1,
          contextPages: [{ number: 1, partial: false }],
          partial: false,
        },
        summary: [
          {
            metric: 'revenue',
            state: 'verified',
            amount: '120',
            unit: 'mln USD',
            period: '2025',
            page: 1,
          },
          {
            metric: 'ebit',
            state: 'verified',
            amount: '9',
            unit: 'mln USD',
            period: '2025',
            page: 1,
          },
          {
            metric: 'netIncome',
            state: 'verified',
            amount: '5',
            unit: 'mln USD',
            period: '2025',
            page: 1,
          },
        ],
        incomplete: false,
      });
    const history = [
      { role: 'user', content: 'Podsumuj raport.' },
      { role: 'assistant', content: reply },
    ];
    await chat()
      .field('question', 'Jaka była marża?')
      .field('history', JSON.stringify(history))
      .attach('report', reportPdf(), 'report.pdf')
      .expect(200);

    const [url, init] = lmStudio.mock.calls[3]!;
    expect(url).toBe('http://127.0.0.1:1234/v1/chat/completions');
    if (typeof init?.body !== 'string') throw new Error('Expected a JSON body');
    const payload = JSON.parse(init.body);
    expect(payload.model).toBe('qwen/qwen3.5-9b');
    expect(payload.reasoning_effort).toBe('none');
    expect(payload.messages.slice(1, 3)).toEqual(history);
    expect(payload.messages[3].content).toContain('Jaka była marża?');
    expect(payload.messages[3].content).toContain(
      '[str. 1]\nCONSOLIDATED STATEMENTS OF OPERATIONS',
    );
  });

  it('requires a session and rejects invalid PDF data before calling LM Studio', async () => {
    await request(app.getHttpServer())
      .post(endpoint)
      .field('question', 'Raport')
      .expect(401);
    await request(app.getHttpServer())
      .post(endpoint)
      .set('X-Test-Session', '1')
      .field('question', '')
      .attach('report', Buffer.from('invalid'), 'report.pdf')
      .expect(400)
      .expect(({ body }) => expect(body.code).toBe('PDF_INVALID'));
    await request(app.getHttpServer())
      .post(endpoint)
      .set('X-Test-Session', '1')
      .field('question', '')
      .attach('report', Buffer.from('%PDF-1.7\ninvalid'), 'report.pdf')
      .expect(400)
      .expect(({ body }) => expect(body.code).toBe('PDF_UNREADABLE'));
    expect(lmStudio).not.toHaveBeenCalled();
  });

  it('reports the available model and distinguishes a missing model from an offline API', async () => {
    const url = '/fundamental-analysis/status';
    await request(app.getHttpServer()).get(url).expect(401);
    const check = () =>
      request(app.getHttpServer()).get(url).set('X-Test-Session', '1');
    lmStudio.mockResolvedValueOnce(
      Response.json({ data: [{ id: 'qwen/qwen3.5-9b' }] }),
    );
    await check().expect(200, { model: 'qwen/qwen3.5-9b' });
    lmStudio.mockResolvedValueOnce(Response.json({ data: [] }));
    await check()
      .expect(422)
      .expect(({ body }) => expect(body.code).toBe('MODEL_MISSING'));
    lmStudio.mockRejectedValueOnce(new TypeError('network error'));
    await check()
      .expect(503)
      .expect(({ body }) => expect(body.code).toBe('MODEL_OFFLINE'));
    vi.stubEnv('LM_STUDIO_WSL_WINDOWS', '1');
    vi.stubEnv('LM_STUDIO_BASE_URL', 'http://192.0.2.10:1235/v1');
    await check()
      .expect(503)
      .expect(({ body }) => expect(body.code).toBe('MODEL_CONFIG'));
    expect(lmStudio).toHaveBeenCalledTimes(3);
  });

  it('reports reasoning without a final answer as an empty response', async () => {
    lmStudio.mockResolvedValueOnce(
      Response.json({ data: [{ id: 'qwen/qwen3.5-9b' }] }),
    );
    lmStudio.mockResolvedValueOnce(
      Response.json({
        choices: [
          {
            finish_reason: 'length',
            message: { content: '', reasoning_content: 'limit' },
          },
        ],
      }),
    );
    await request(app.getHttpServer())
      .post(endpoint)
      .set('X-Test-Session', '1')
      .field('question', 'Podsumuj wyniki')
      .expect(502)
      .expect(({ body }) => expect(body.code).toBe('MODEL_EMPTY'));
  });

  it('reports a model timeout separately from its connection failure', async () => {
    const realTimeout = AbortSignal.timeout.bind(AbortSignal);
    vi.spyOn(AbortSignal, 'timeout').mockImplementationOnce(() =>
      realTimeout(20),
    );
    lmStudio.mockImplementationOnce(
      async (_url, options) =>
        new Promise((_resolve, reject) => {
          const signal = options?.signal;
          if (signal?.aborted) reject(signal.reason);
          else
            signal?.addEventListener('abort', () => reject(signal.reason), {
              once: true,
            });
        }),
    );
    await request(app.getHttpServer())
      .get('/fundamental-analysis/status')
      .set('X-Test-Session', '1')
      .expect(504)
      .expect(({ body }) => expect(body.code).toBe('MODEL_TIMEOUT'));
  });
});
