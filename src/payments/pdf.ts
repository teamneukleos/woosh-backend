import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

export type PdfDocumentInput = {
  documentNumber: string;
  type: string;
  currency: string;
  grossAmount: number;
  feeAmount: number;
  netAmount: number;
  generatedAt: Date | string;
  snapshot: unknown;
};

function money(currency: string, amount: number) {
  return `${currency} ${amount.toLocaleString('en-NG', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function lineLabel(row: unknown) {
  const item = asRecord(row);
  const campaign = typeof item.campaign === 'string' ? item.campaign : 'Campaign';
  const brand = typeof item.brand === 'string' ? item.brand : '';
  const date = typeof item.date === 'string' ? item.date.slice(0, 10) : '';
  const net = typeof item.net === 'number' ? item.net : Number(item.net ?? 0);
  const currency = typeof item.currency === 'string' ? item.currency : 'NGN';
  const prefix = [date, brand, campaign].filter(Boolean).join(' · ');
  return `${prefix}  ${money(currency, net)}`;
}

export async function renderFinancialDocumentPdf(input: PdfDocumentInput) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  let page = pdf.addPage([595, 842]);
  let y = 800;
  const black = rgb(0.07, 0.11, 0.17);
  const muted = rgb(0.4, 0.45, 0.5);

  const write = (text: string, size: number, weight: 'regular' | 'bold' = 'regular') => {
    if (y < 64) {
      page = pdf.addPage([595, 842]);
      y = 800;
    }
    page.drawText(text.slice(0, 110), {
      x: 48,
      y,
      size,
      font: weight === 'bold' ? bold : font,
      color: weight === 'bold' ? black : muted,
    });
    y -= size + 10;
  };

  const snapshot = asRecord(input.snapshot);
  const kind =
    input.type === 'CREATOR_STATEMENT' ? 'Creator statement' : 'Brand receipt';
  const generated =
    input.generatedAt instanceof Date
      ? input.generatedAt.toISOString().slice(0, 10)
      : String(input.generatedAt).slice(0, 10);

  write('Woosh', 18, 'bold');
  write(kind, 12, 'bold');
  write(input.documentNumber, 11);
  write(`Generated ${generated}`, 10);
  if (typeof snapshot.creator === 'string') write(`Creator  ${snapshot.creator}`, 10);
  if (typeof snapshot.brand === 'string') write(`Brand  ${snapshot.brand}`, 10);
  if (typeof snapshot.campaign === 'string') write(`Campaign  ${snapshot.campaign}`, 10);
  if (typeof snapshot.year === 'number' && typeof snapshot.month === 'number') {
    write(
      `Period  ${snapshot.year}-${String(snapshot.month).padStart(2, '0')}`,
      10,
    );
  }
  y -= 8;
  write(`Gross     ${money(input.currency, input.grossAmount)}`, 11, 'bold');
  write(`Fee (0%)  ${money(input.currency, input.feeAmount)}`, 11);
  write(`Net       ${money(input.currency, input.netAmount)}`, 12, 'bold');

  const lines = Array.isArray(snapshot.lines) ? snapshot.lines : [];
  if (lines.length) {
    y -= 8;
    write('Line items', 11, 'bold');
    for (const row of lines.slice(0, 40)) {
      write(lineLabel(row), 9);
    }
  }

  y -= 16;
  write('Woosh takes 0% of the creator rate. Paystack processing is separate.', 8);
  return pdf.save();
}
