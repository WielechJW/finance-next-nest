import { BadRequestException } from '@nestjs/common';

export const maxImportBytes = 1024 * 1024;
const maxRows = 5000;
const separators = [',', ';', '\t'] as const;
type Separator = (typeof separators)[number];

function decode(buffer: Buffer) {
  if (buffer.length === 0 || buffer.length > maxImportBytes) {
    throw new BadRequestException('Plik CSV musi mieć od 1 bajtu do 1 MB.');
  }
  const utf16 =
    buffer[0] === 0xff && buffer[1] === 0xfe
      ? 'utf-16le'
      : buffer[0] === 0xfe && buffer[1] === 0xff
        ? 'utf-16be'
        : null;
  let text: string;
  let encoding: string;
  try {
    encoding = utf16 ?? 'utf-8';
    text = new TextDecoder(encoding, { fatal: true }).decode(buffer);
  } catch {
    if (
      utf16 ||
      buffer.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))
    ) {
      throw new BadRequestException(
        'Uszkodzone kodowanie Unicode w pliku CSV.',
      );
    }
    encoding = 'windows-1250';
    text = new TextDecoder(encoding).decode(buffer);
  }
  // A CSV may contain line endings and tabs. Other controls indicate binary data.
  // oxlint-disable-next-line eslint/no-control-regex
  if (/[\0\u0001-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u.test(text)) {
    throw new BadRequestException(
      'Plik CSV zawiera znaki sterujące lub nieobsługiwane kodowanie.',
    );
  }
  return { text, encoding };
}

function cells(line: string, separator: Separator) {
  const result: string[] = [];
  let value = '';
  let state: 'field' | 'quoted' | 'closed' = 'field';
  for (let index = 0; index < line.length; index++) {
    const char = line[index];
    if (state === 'quoted') {
      if (char !== '"') value += char;
      else if (line[index + 1] === '"') {
        value += '"';
        index++;
      } else state = 'closed';
    } else if (char === separator) {
      result.push(value.trim());
      value = '';
      state = 'field';
    } else if (state === 'closed') {
      if (char !== ' ') return null;
    } else if (char === '"') {
      if (value.trim()) return null;
      value = '';
      state = 'quoted';
    } else value += char;
  }
  if (state === 'quoted') return null;
  result.push(value.trim());
  return result;
}

export function readCsv(buffer: Buffer, requiredHeaders: string[]) {
  const { text, encoding } = decode(buffer);
  const lines = text.split(/\r\n|\n|\r/);
  const headerLine = lines.findIndex((line) => line.trim() !== '');
  if (headerLine < 0) throw new BadRequestException('Plik CSV jest pusty.');
  const header = lines[headerLine];
  const candidates = separators.flatMap((separator) => {
    const names = cells(header, separator)?.map((name) => name.toLowerCase());
    if (
      !names ||
      names.length > 64 ||
      names.some((name) => !name) ||
      new Set(names).size !== names.length ||
      !requiredHeaders.every((name) => names.includes(name))
    )
      return [];
    return [{ separator, names }];
  });
  if (candidates.length !== 1) {
    throw new BadRequestException(
      'Nagłówki lub separator CSV nie pasują do wybranego formatu.',
    );
  }
  const { separator, names } = candidates[0];
  const dataLines = lines
    .slice(headerLine + 1)
    .flatMap((line, index) =>
      line.trim() ? [{ line, number: headerLine + index + 2 }] : [],
    );
  if (!dataLines.length || dataLines.length > maxRows) {
    throw new BadRequestException(
      `Plik CSV musi zawierać od 1 do ${maxRows} wierszy danych.`,
    );
  }
  const rows = dataLines.map(({ line, number }) => {
    const parsed = line.length <= 4096 ? cells(line, separator) : null;
    if (!parsed || parsed.length !== names.length)
      return { number, values: null };
    return {
      number,
      values: new Map(names.map((name, index) => [name, parsed[index]])),
    };
  });
  return { encoding, separator, rows };
}
