import { renderFinancialDocumentPdf } from './pdf';

describe('financial document PDF', () => {
  it('starts with a PDF header', async () => {
    const bytes = await renderFinancialDocumentPdf({
      documentNumber: 'WO-STMT-202608-ABC123',
      type: 'CREATOR_STATEMENT',
      currency: 'NGN',
      grossAmount: 100000,
      feeAmount: 0,
      netAmount: 100000,
      generatedAt: '2026-08-26T00:00:00.000Z',
      snapshot: {
        year: 2026,
        month: 8,
        creator: 'Ada',
        lines: [
          {
            date: '2026-08-12',
            brand: 'Peak Milk',
            campaign: 'August launch',
            net: 100000,
            currency: 'NGN',
          },
        ],
      },
    });
    expect(Buffer.from(bytes).subarray(0, 4).toString()).toBe('%PDF');
  });
});
