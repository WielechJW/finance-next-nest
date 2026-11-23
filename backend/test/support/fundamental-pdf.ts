export function reportPdf(revenue = '120'): Buffer {
  const fragments: [number, number, string][] = [
    [40, 750, 'CONSOLIDATED STATEMENTS OF OPERATIONS'],
    [40, 728, 'In millions of USD'],
    [390, 708, '2024'],
    [465, 708, '2025'],
    [40, 688, 'Total revenue'],
    [400, 688, '100'],
    [475, 688, revenue],
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
