import { describe, it, expect, vi } from 'vitest';

/**
 * Content-pinning tests for the year-end giving statement. Same approach as receipt-pdf.spec.ts:
 * no PDF text-extraction library is a project dependency, so pdfkit's `PDFDocument` is stubbed
 * with a fake that records every `.text()` call in draw order, and assertions check those
 * recorded strings — not layout/geometry.
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

import { buildStatementPdf, type StatementPdfInput } from './statement-pdf';

function baseInput(overrides: Partial<StatementPdfInput> = {}): StatementPdfInput {
  return {
    year: 2026,
    orgName: 'Riverside Community Fund',
    orgAddress: '1 Riverside Ave, Toronto, ON',
    donorName: 'Jordan Rivera',
    donorAddressLines: ['123 Main St', 'Toronto, ON M5V 2T6'],
    gifts: [
      { gift_date: '2026-02-01', amount_cents: 5000, method: 'card' },
      { gift_date: '2026-11-20', amount_cents: 12500, method: 'check' },
    ],
    totalCents: 17500,
    currency: 'CAD',
    generatedAt: new Date('2027-01-05T12:00:00Z'),
    ...overrides,
  };
}

async function drawnText(input: StatementPdfInput): Promise<string[]> {
  await buildStatementPdf(input);
  const doc = FakePdfDocument.instances.at(-1);
  if (!doc) throw new Error('buildStatementPdf did not construct a document');
  return doc.textCalls;
}

describe('buildStatementPdf', () => {
  it('prints the tax year in the heading and the total line', async () => {
    const calls = await drawnText(baseInput({ year: 2026 }));
    expect(calls).toContain('2026 giving statement');
    expect(calls).toContain('Total gifts in 2026');
  });

  it('prints every gift row: date, method label, and amount', async () => {
    const calls = await drawnText(baseInput());
    expect(calls).toContain('February 1, 2026');
    expect(calls).toContain('Card');
    expect(calls).toContain('$50.00');
    expect(calls).toContain('November 20, 2026');
    expect(calls).toContain('Check');
    expect(calls).toContain('$125.00');
  });

  it('prints the total amount exactly, without recomputing it from the gift rows', async () => {
    // buildStatementPdf trusts totalCents as given — it does not sum the gifts itself. A caller
    // bug that passes a mismatched total would print silently; this only pins that the module
    // prints whatever total it was handed.
    const calls = await drawnText(baseInput({ totalCents: 17500 }));
    expect(calls).toContain('$175.00');
  });

  it('falls back to the raw method string for an unrecognized payment method', async () => {
    const calls = await drawnText(
      baseInput({ gifts: [{ gift_date: '2026-03-01', amount_cents: 1000, method: 'crypto' }] }),
    );
    expect(calls).toContain('crypto');
  });

  it('always prints the "not an official receipt" disclaimer', async () => {
    const calls = await drawnText(baseInput());
    expect(calls.some((c) => c.includes('is a summary of gifts received and is not an official receipt'))).toBe(true);
  });

  it('keeps cents exact on a sub-dollar gift', async () => {
    const calls = await drawnText(
      baseInput({
        gifts: [{ gift_date: '2026-05-05', amount_cents: 99, method: 'cash' }],
        totalCents: 99,
      }),
    );
    expect(calls).toContain('$0.99');
  });

  it('prints the year-end boundary date correctly (no off-by-one into the next year)', async () => {
    const calls = await drawnText(
      baseInput({ gifts: [{ gift_date: '2026-12-31', amount_cents: 100, method: 'card' }] }),
    );
    expect(calls).toContain('December 31, 2026');
  });
});
