import { execFile } from 'node:child_process';
import '../config/environment.js';
import { AnalysisError } from './analysis-error.js';

export const QWEN_35_MODEL = /qwen[-_. ]?3[._-]?5(?:$|[-_. /:@])/i;
const WINDOWS_CURL = '/mnt/c/Windows/System32/curl.exe';

export function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

export function getLmStudioConfig() {
  try {
    const base = new URL(
      process.env.LM_STUDIO_BASE_URL?.trim() || 'http://127.0.0.1:1234/v1',
    );
    const windows = process.env.LM_STUDIO_WSL_WINDOWS?.trim() === '1';
    if (
      !['http:', 'https:'].includes(base.protocol) ||
      base.username ||
      base.password ||
      base.search ||
      base.hash ||
      (windows &&
        (process.platform !== 'linux' ||
          base.protocol !== 'http:' ||
          !['127.0.0.1', 'localhost'].includes(base.hostname) ||
          !/^\/v1\/?$/.test(base.pathname)))
    ) {
      throw new Error();
    }
    const headers = new Headers({
      'Content-Type': 'application/json',
      Accept: 'application/json',
    });
    const key = process.env.LM_STUDIO_API_KEY?.trim();
    if (key) headers.set('Authorization', 'Bearer ' + key);
    return { baseUrl: base.href.replace(/\/+$/, ''), headers, windows };
  } catch {
    throw new AnalysisError(
      'MODEL_CONFIG',
      503,
      'Sprawdź adres i ustawienia połączenia z LM Studio w backendzie.',
    );
  }
}

type Configuration = ReturnType<typeof getLmStudioConfig>;

export async function selectModel(config: Configuration, signal: AbortSignal) {
  const result = await requestLmStudio(config, 'models', signal);
  if (!isObject(result) || !Array.isArray(result.data)) throw invalidResponse();
  const models = new Set(
    (result.data as unknown[])
      .filter(isObject)
      .map((entry) => entry.id)
      .filter((id): id is string => typeof id === 'string' && !!id.trim()),
  );
  const configured = process.env.LM_STUDIO_MODEL?.trim();
  const detected = [...models].filter((id) => QWEN_35_MODEL.test(id));
  const match = configured
    ? models.has(configured) && configured
    : detected.length === 1 && detected[0];
  if (match) return match;
  throw new AnalysisError(
    'MODEL_MISSING',
    422,
    configured
      ? 'Skonfigurowany model jest niedostępny. Sprawdź jego identyfikator i uruchom go w LM Studio.'
      : detected.length > 1
        ? 'Wykryto kilka modeli Qwen 3.5. Wybierz jeden przez LM_STUDIO_MODEL w backendzie.'
        : 'Nie wykryto Qwen 3.5. Załaduj model w LM Studio.',
  );
}

function invalidResponse() {
  return new AnalysisError(
    'MODEL_RESPONSE',
    502,
    'LM Studio zwróciło nieprawidłową odpowiedź.',
  );
}

export async function requestLmStudio(
  config: Configuration,
  endpoint: 'models' | 'chat/completions',
  signal: AbortSignal,
  payload?: object,
): Promise<unknown> {
  const url = config.baseUrl + '/' + endpoint;
  const body = payload ? JSON.stringify(payload) : undefined;
  let status: number;
  let readBody: () => Promise<string>;
  try {
    if (config.windows) {
      const reply = await requestThroughWindows(
        url,
        config.headers,
        signal,
        body,
      );
      status = reply.status;
      readBody = async () => reply.body;
    } else {
      const reply = await fetch(url, {
        method: body ? 'POST' : 'GET',
        headers: config.headers,
        body,
        signal,
        redirect: 'error',
      });
      status = reply.status;
      if (!reply.ok) await reply.body?.cancel();
      readBody = () => reply.text();
    }
  } catch (error) {
    signal.throwIfAborted();
    if (error instanceof AnalysisError) throw error;
    throw new AnalysisError(
      'MODEL_OFFLINE',
      503,
      'Brak połączenia z lokalnym API LM Studio.',
    );
  }
  if (status === 401 || status === 403) {
    throw new AnalysisError(
      'MODEL_AUTH',
      503,
      'Sprawdź token API w LM Studio.',
    );
  }
  if (status >= 400 && status < 500) {
    throw new AnalysisError(
      'MODEL_REJECTED',
      422,
      'LM Studio odrzuciło żądanie. Sprawdź dostępność modelu i długość kontekstu.',
    );
  }
  if (status < 200 || status >= 300) throw invalidResponse();
  try {
    return JSON.parse(await readBody()) as unknown;
  } catch {
    signal.throwIfAborted();
    throw invalidResponse();
  }
}

function curlConfigValue(value: string): string {
  return (
    '"' +
    value
      .replaceAll('\\', '\\\\')
      .replaceAll('"', '\\"')
      .replaceAll('\r', '\\r')
      .replaceAll('\n', '\\n') +
    '"'
  );
}

function requestThroughWindows(
  url: string,
  headers: Headers,
  signal: AbortSignal,
  body?: string,
) {
  // Sending the configuration through stdin keeps the API token and report out of argv.
  const config = [
    'url = ' + curlConfigValue(url),
    ...Array.from(
      headers,
      ([name, value]) => 'header = ' + curlConfigValue(name + ': ' + value),
    ),
  ];
  if (body) config.push('data-binary = ' + curlConfigValue(body));

  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const child = execFile(
      WINDOWS_CURL,
      [
        '-q',
        '--config',
        '-',
        '--noproxy',
        '*',
        '--silent',
        '--connect-timeout',
        '3',
        '--write-out',
        '\n%{http_code}',
      ],
      { signal, maxBuffer: 1024 * 1024 },
      (error, stdout) => {
        if (error) {
          reject(error);
          return;
        }
        const split = stdout.lastIndexOf('\n');
        const status = Number(stdout.slice(split + 1));
        if (
          split < 0 ||
          !Number.isInteger(status) ||
          status < 100 ||
          status > 599
        ) {
          reject(invalidResponse());
          return;
        }
        resolve({ status, body: stdout.slice(0, split) });
      },
    );
    child.stdin?.on('error', reject);
    child.stdin?.end(config.join('\n') + '\n');
  });
}
