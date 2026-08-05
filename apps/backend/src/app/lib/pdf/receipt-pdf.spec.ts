import { describe, it, expect, vi } from 'vitest';
import { RECEIPT_REGIMES } from '@common';

// The individual regime constants are not part of the `@common` public surface — only the
// `RECEIPT_REGIMES` lookup is re-exported — so the specs read the two they need out of it.
const CRA_CHARITY_REGIME = RECEIPT_REGIMES.cra_charity;
const POLITICAL_ALBERTA_REGIME = RECEIPT_REGIMES.political_ab;

/**
 * Content-pinning tests for the official receipt PDF (per-gift and cumulative). No PDF
 * text-extraction library is a project dependency (checked package.json — only `pdfkit` itself;
 * no `pdf-parse` or similar), so extracting real bytes and reading them back is not feasible
 * without adding one. Instead this stubs pdfkit's `PDFDocument` with a minimal fake that records
 * every string passed to `.text()` in draw order, and asserts on that recording — the same
 * approach used by statement-pdf.spec.ts and acknowledgement-pdf.spec.ts. This pins CONTENT
 * (receipt serial, totals, regime wording) and deliberately ignores geometry (x/y, pagination),
 * per instructions not to snapshot layout.
 */

const { FakePdfDocument } = vi.hoisted(() => {
  /**
   * `pdfkit`'s default export is called with `new`, so the mocked default must be a real
   * constructor. Each instance registers itself in the static list, which is how a test gets at
   * the document the module under test built.
   */
  class FakePdfDocument {
    static readonly instances: FakePdfDocument[] = [];
    readonly textCalls: string[] = [];
    x = 54;
    y = 54;
    page = { margins: { top: 54 }, maxY: (): number => Number.MAX_SAFE_INTEGER };
    private readonly handlers: Record<string, ((...args: unknown[]) => void)[]> = {};

    constructor() {
      FakePdfDocument.instances.push(this);
    }

    font(): this {
      return this;
    }
    fontSize(): this {
      return this;
    }
    fillColor(): this {
      return this;
    }
    strokeColor(): this {
      return this;
    }
    lineWidth(): this {
      return this;
    }
    opacity(): this {
      return this;
    }
    rotate(): this {
      return this;
    }
    save(): this {
      return this;
    }
    restore(): this {
      return this;
    }
    moveTo(): this {
      return this;
    }
    lineTo(): this {
      return this;
    }
    stroke(): this {
      return this;
    }
    image(): this {
      return this;
    }
    moveDown(lines = 1): this {
      this.y += 12 * lines;
      return this;
    }
    text(value: unknown): this {
      this.textCalls.push(String(value));
      this.y += 12;
      return this;
    }
    addPage(): this {
      this.emit('pageAdded');
      return this;
    }
    on(event: string, handler: (...args: unknown[]) => void): this {
      (this.handlers[event] ??= []).push(handler);
      return this;
    }
    private emit(event: string, ...args: unknown[]): void {
      for (const handler of this.handlers[event] ?? []) handler(...args);
    }
    end(): void {
      this.emit('data', Buffer.from('fake-pdf'));
      this.emit('end');
    }
    heightOfString(): number {
      return 12;
    }
    currentLineHeight(): number {
      return 12;
    }
  }
  return { FakePdfDocument };
});

vi.mock('pdfkit', () => ({ default: FakePdfDocument }));

import { buildReceiptPdf, type ReceiptPdfInput } from './receipt-pdf';

function baseInput(overrides: Partial<ReceiptPdfInput> = {}): ReceiptPdfInput {
  return {
    regime: CRA_CHARITY_REGIME,
    receiptNumber: 'R-2026-00042',
    kind: 'per_gift',
    issuedAt: new Date('2026-03-15T12:00:00Z'),
    giftDate: '2026-03-10',
    items: [],
    amountCents: 10000,
    advantageCents: 0,
    eligibleCents: 10000,
    advantageDescription: null,
    donorName: 'Jordan Rivera',
    donorAddressLines: ['123 Main St', 'Toronto, ON M5V 2T6'],
    issuer: {
      org_legal_name: 'Riverside Community Fund',
      org_address: '1 Riverside Ave, Toronto, ON',
      registration_number: '123456789 RR 0001',
      place_of_issue: 'Toronto, ON',
      signatory_name: 'Alex Chen',
      signatory_title: 'Treasurer',
    },
    replacesReceiptNumber: null,
    cancelled: null,
    specimen: false,
    signatureImage: null,
    currency: 'CAD',
    taxCreditEligible: undefined,
    ...overrides,
  };
}

async function drawnText(input: ReceiptPdfInput): Promise<string[]> {
  await buildReceiptPdf(input);
  const doc = FakePdfDocument.instances.at(-1);
  if (!doc) throw new Error('buildReceiptPdf did not construct a document');
  return doc.textCalls;
}

describe('buildReceiptPdf', () => {
  it('prints the receipt serial, issuer name, donor name, and total/eligible amounts', async () => {
    const calls = await drawnText(baseInput());
    expect(calls).toContain('Riverside Community Fund');
    expect(calls).toContain('Receipt No. R-2026-00042');
    expect(calls).toContain('Jordan Rivera');
    expect(calls).toContain('$100.00'); // amountCents = 10000
    expect(calls).toContain('$100.00'); // eligibleCents = 10000 (same value here)
  });

  it('omits the "Amount of advantage" row when advantageCents is zero', async () => {
    const calls = await drawnText(baseInput({ advantageCents: 0 }));
    expect(calls).not.toContain('Amount of advantage');
  });

  it('prints the advantage amount and description when advantageCents is positive', async () => {
    const calls = await drawnText(
      baseInput({
        amountCents: 20000,
        advantageCents: 5000,
        eligibleCents: 15000,
        advantageDescription: 'Gala dinner ticket',
      }),
    );
    expect(calls).toContain('$200.00');
    expect(calls).toContain('$150.00');
    expect(calls.some((c) => c.includes('$50.00') && c.includes('Gala dinner ticket'))).toBe(true);
  });

  it('keeps cents exact — no rounding on an odd-cent total', async () => {
    const calls = await drawnText(baseInput({ amountCents: 100001, eligibleCents: 100001 }));
    expect(calls).toContain('$1,000.01');
  });

  it('prints every gift date and amount for a cumulative receipt, itemized', async () => {
    const calls = await drawnText(
      baseInput({
        kind: 'cumulative',
        giftDate: null,
        items: [
          { gift_date: '2026-01-01', amount_cents: 5000 },
          { gift_date: '2026-06-15', amount_cents: 7500 },
        ],
        amountCents: 12500,
        eligibleCents: 12500,
      }),
    );
    expect(calls).toContain('Gifts covered by this receipt');
    expect(calls).toContain('January 1, 2026');
    expect(calls).toContain('$50.00');
    expect(calls).toContain('June 15, 2026');
    expect(calls).toContain('$75.00');
    expect(calls).toContain('$125.00'); // total
  });

  it('prints the hard-coded regulatory label "Electoral district" regardless of campaign wording', async () => {
    const calls = await drawnText(
      baseInput({
        regime: { ...CRA_CHARITY_REGIME },
        issuer: { ...baseInput().issuer, electoral_district: 'Ward 4 (per campaign settings)' },
      }),
    );
    expect(calls).toContain('Electoral district');
    expect(calls).toContain('Ward 4 (per campaign settings)');
  });

  it('prints both serial numbers on a replacement receipt', async () => {
    const calls = await drawnText(baseInput({ replacesReceiptNumber: 'R-2026-00013' }));
    expect(calls).toContain('This receipt cancels and replaces receipt No. R-2026-00013.');
  });

  it('prints the cancellation reason and date on a cancelled receipt', async () => {
    const calls = await drawnText(
      baseInput({
        cancelled: { reason: 'Gift refunded', at: new Date('2026-04-01T12:00:00Z') },
      }),
    );
    expect(calls.some((c) => c.includes('April 1, 2026') && c.includes('Gift refunded'))).toBe(true);
  });

  it('shows the Alberta tax-credit-eligibility line only for a regime that prescribes one', async () => {
    const craCalls = await drawnText(baseInput({ regime: CRA_CHARITY_REGIME }));
    expect(craCalls).not.toContain('Eligible for tax credit');

    const abCalls = await drawnText(
      baseInput({ regime: POLITICAL_ALBERTA_REGIME, taxCreditEligible: false, issuer: { agent_name: 'Sam Lee' } }),
    );
    expect(abCalls).toContain('Eligible for tax credit');
    expect(abCalls).toContain('No');
  });

  it('prints every regime footer line', async () => {
    const calls = await drawnText(baseInput({ regime: CRA_CHARITY_REGIME }));
    for (const line of CRA_CHARITY_REGIME.footerLines) {
      expect(calls).toContain(line);
    }
  });

  it('draws the CANCELLED watermark text when cancelled, and SPECIMEN when marked specimen', async () => {
    const cancelledCalls = await drawnText(
      baseInput({ cancelled: { reason: 'Duplicate entry', at: new Date('2026-05-01T12:00:00Z') } }),
    );
    expect(cancelledCalls).toContain('CANCELLED');

    const specimenCalls = await drawnText(baseInput({ specimen: true }));
    expect(specimenCalls).toContain('SPECIMEN');
  });
});
