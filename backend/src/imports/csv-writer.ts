export function csvCell(input: string | null | undefined): string {
  // A CSV decoder recognises the escaped line breaks as text on the same record.
  const value = (input ?? '')
    .replace(/\r\n|\n|\r/g, '\\n')
    .replace(/\t/g, '\\t');
  const dangerous =
    /^[\s\u200b\ufeff]*[=+\-@＝＋－＠]/u.test(value) &&
    !/^-?\d+(?:\.\d+)?$/.test(value);
  return `"${(dangerous ? "'" + value : value).replaceAll('"', '""')}"`;
}

export function encodeCsv(
  headers: readonly string[],
  rows: readonly Record<string, string | null | undefined>[],
) {
  return (
    '\ufeff' +
    [
      headers.map(csvCell).join(','),
      ...rows.map((row) => headers.map((key) => csvCell(row[key])).join(',')),
    ].join('\r\n') +
    '\r\n'
  );
}
