import { describe, it, expect, vi } from 'vitest';

/**
 * Content-pinning tests for the plain donation acknowledgement. Same approach as
 * receipt-pdf.spec.ts and statement-pdf.spec.ts: no PDF text-extraction library is a project
 * dependency, so pdfkit's `PDFDocument` is stubbed with a fake that records every `.text()` call
 * in draw order, and assertions check those recorded strings — not layout/geometry.
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

import { buildAcknowledgementPdf, type AcknowledgementPdfInput } from './acknowledgement-pdf';

function baseInput(overrides: Partial<AcknowledgementPdfInput> = {}): AcknowledgementPdfInput {
  return {
    number: 'A-2026-00042',
    orgName: 'Riverside Community Fund',
    orgAddress: '1 Riverside Ave, Toronto, ON',
    donorName: 'Jordan Rivera',
    donorAddressLines: ['123 Main St', 'Toronto, ON M5V 2T6'],
    giftDate: '2026-03-10',
    issuedAt: new Date('2026-03-10T12:00:00Z'),
    amountCents: 10000,
    method: 'card',
    currency: 'CAD',
    taxReceiptExpected: false,
    cancelled: null,
    ...overrides,
  };
}

async function drawnText(input: AcknowledgementPdfInput): Promise<string[]> {
  await buildAcknowledgementPdf(input);
  const doc = FakePdfDocument.instances.at(-1);
  if (!doc) throw new Error('buildAcknowledgementPdf did not construct a document');
  return doc.textCalls;
}

describe('buildAcknowledgementPdf', () => {
  it('prints the acknowledgement number, donor name, and amount', async () => {
    const calls = await drawnText(baseInput());
    expect(calls).toContain('No. A-2026-00042');
    expect(calls).toContain('Jordan Rivera');
    expect(calls).toContain('$100.00');
  });

  it('always prints the not-an-official-receipt disclaimer, even when a tax receipt is expected', async () => {
    const calls = await drawnText(baseInput({ taxReceiptExpected: true }));
    expect(calls).toContain('This receipt confirms your gift. It is not an official receipt for income tax purposes.');
  });

  it('prints the payment method label', async () => {
    const calls = await drawnText(baseInput({ method: 'bank_transfer' }));
    expect(calls).toContain('Bank transfer');
  });

  it('falls back to the raw method string for an unrecognized payment method', async () => {
    const calls = await drawnText(baseInput({ method: 'crypto' }));
    expect(calls).toContain('crypto');
  });

  it('mentions the coming tax receipt only when the workspace has a regime configured, using the gift year', async () => {
    const expectedCalls = await drawnText(baseInput({ taxReceiptExpected: true, giftDate: '2026-03-10' }));
    expect(expectedCalls.some((c) => c.includes('An official tax receipt for 2026 follows'))).toBe(true);

    const notExpectedCalls = await drawnText(baseInput({ taxReceiptExpected: false }));
    expect(notExpectedCalls.some((c) => c.includes('An official tax receipt'))).toBe(false);
  });

  it('suppresses the coming-tax-receipt line on a cancelled acknowledgement even if a receipt was expected', async () => {
    const calls = await drawnText(
      baseInput({
        taxReceiptExpected: true,
        cancelled: { reason: 'Gift refunded', at: new Date('2026-04-01T12:00:00Z') },
      }),
    );
    expect(calls.some((c) => c.includes('An official tax receipt'))).toBe(false);
  });

  it('prints the cancellation reason and date, and the CANCELLED watermark', async () => {
    const calls = await drawnText(
      baseInput({ cancelled: { reason: 'Duplicate entry', at: new Date('2026-04-02T12:00:00Z') } }),
    );
    expect(calls).toContain('CANCELLED');
    expect(calls.some((c) => c.includes('April 2, 2026') && c.includes('Duplicate entry'))).toBe(true);
  });

  it('keeps cents exact on a sub-dollar amount', async () => {
    const calls = await drawnText(baseInput({ amountCents: 1 }));
    expect(calls).toContain('$0.01');
  });
});
