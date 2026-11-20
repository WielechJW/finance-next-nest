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
  const stream = 'BT /F1 12 Tf 40 700 Td (Revenue 2025: PLN 120 million) Tj ET';
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
    await app.close();
  });

  it('extracts PDF text with page references and includes prior turns when asking a follow-up', async () => {
    const reply = 'Przychody to 120 mln PLN w 2025 r. [str. 1]';
    lmStudio.mockImplementation(async (url) => {
      if (url === 'http://127.0.0.1:1234/v1/models') {
        return Response.json({
          data: [{ id: 'qwen/qwen3.5-9b' }, { id: 'other-model' }],
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
          partial: false,
        },
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
    expect(payload.messages.slice(1, 3)).toEqual(history);
    expect(payload.messages[3].content).toContain('Jaka była marża?');
    expect(payload.messages[3].content).toContain(
      '[str. 1]\nRevenue 2025: PLN 120 million',
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
      .expect(400);
    expect(lmStudio).not.toHaveBeenCalled();
  });
});
