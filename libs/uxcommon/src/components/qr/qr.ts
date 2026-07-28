import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/** 4 modules of white on every side — the spec's minimum for a scanner to lock on. */
const QUIET_ZONE = 4;

/**
 * A QR code drawn as one `<svg>` path from a module matrix the server computed.
 *
 * No image, no canvas, no `innerHTML`, no `DomSanitizer` bypass: the matrix is
 * `boolean[][]` and the path is built from it here, so nothing untrusted reaches the DOM
 * and the code stays sharp from a phone screen to a projected slide.
 *
 * **Deliberate exception to the semantic-token rule** (`pplcrm-design-principles` §5):
 * this is hardcoded dark-on-white in both themes. A QR inverted for dark mode fails on a
 * large share of scanners, and a code that doesn't scan is not a design choice. The one
 * place in the app where a literal color is the correct answer.
 */
@Component({
  selector: 'pc-qr',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg
      class="h-full w-full"
      [attr.viewBox]="viewBox()"
      shape-rendering="crispEdges"
      role="img"
      [attr.aria-label]="alt()"
    >
      <rect [attr.width]="extent()" [attr.height]="extent()" fill="#ffffff" />
      <path [attr.d]="path()" fill="#000000" />
    </svg>
  `,
})
export class Qr {
  /** Row-major module matrix; true = dark. Comes from the backend's `qr` query. */
  public readonly matrix = input.required<boolean[][]>();
  public readonly alt = input<string>('QR code');

  protected readonly extent = computed(() => this.matrix().length + QUIET_ZONE * 2);
  protected readonly viewBox = computed(() => `0 0 ${this.extent()} ${this.extent()}`);

  /**
   * One path, with horizontal runs merged into single rectangles.
   *
   * A 41×41 code is ~1700 modules; emitting a `<rect>` each would put a thousand-plus
   * nodes in the DOM for something that is conceptually one shape. Merging runs takes it
   * to a few hundred path commands and one element.
   */
  protected readonly path = computed(() => {
    const rows = this.matrix();
    const parts: string[] = [];
    for (let y = 0; y < rows.length; y++) {
      const row = rows[y] ?? [];
      let runStart = -1;
      for (let x = 0; x <= row.length; x++) {
        const dark = x < row.length && row[x] === true;
        if (dark && runStart < 0) runStart = x;
        if (!dark && runStart >= 0) {
          parts.push(`M${runStart + QUIET_ZONE} ${y + QUIET_ZONE}h${x - runStart}v1h-${x - runStart}z`);
          runStart = -1;
        }
      }
    }
    return parts.join('');
  });
}
