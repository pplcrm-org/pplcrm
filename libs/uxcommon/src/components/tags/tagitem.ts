import { Component, Signal, computed, input, output, signal } from '@angular/core';
import { Icon } from '@icons/icon';

@Component({
  selector: 'pc-tagitem',
  imports: [Icon],
  styleUrl: './tagitem.css',
  template: `<div
    class="badge rounded-lg px-0 gap-1 pl-2 bordered"
    [class.badge-compact]="compact()"
    [style.background]="background() || null"
    [style.color]="textColor()"
    [style.borderColor]="borderColor()"
  >
    <span
      (click)="emitClick()"
      class="tag-label cursor-pointer pr-1"
      [class.pr-2]="!canDelete()"
      [style.color]="textColor()"
    >
      {{ displayName() }}</span
    >
    <pc-icon
      name="x-mark"
      [size]="3"
      class="tag-remove hover:text-error cursor-pointer pr-1 mr-0"
      [style.color]="textColor()"
      [class.hidden]="!canDelete()"
      (click)="emitClose()"
    />
  </div> `,
})
export class TagItem {
  protected readonly background = computed(() => this.normalizeColor(this.color()));
  protected readonly borderColor = computed(() => this.background() ?? null);
  protected readonly displayName = computed(() => {
    const n = this.name();
    return n ? n.charAt(0).toUpperCase() + n.slice(1) : '';
  });
  protected readonly textColor = computed(() => this.computeTextColor(this.background()));

  // Named `tagClicked`/`tagClosed`, not `click`/`close`: an output that shadows a native DOM
  // event makes `(click)` on the host ambiguous — the consumer can no longer tell whether they
  // are binding the component's output or the real DOM event (@angular-eslint/no-output-native).
  public readonly tagClicked = output<string>();
  public readonly tagClosed = output<string>();

  public canDelete = input<boolean>(true);
  public color = input<string | null | undefined>(null);
  public compact = input<boolean>(false);
  public invisible = input<Signal<boolean>>(signal(false));
  public name = input.required<string>();

  public emitClick() {
    this.tagClicked.emit(this.name());
  }

  public emitClose() {
    this.tagClosed.emit(this.name());
  }

  private computeTextColor(hex: string | null): string | null {
    if (!hex) return null;
    const rgb = this.hexToRgb(hex);
    if (!rgb) return '#f9fafb';
    const [r = 0, g = 0, b = 0] = rgb.map((v) => v / 255);
    const [rLin = 0, gLin = 0, bLin = 0] = [r, g, b].map((v) =>
      v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4),
    );
    const luminance = 0.2126 * rLin + 0.7152 * gLin + 0.0722 * bLin;
    return luminance > 0.5 ? '#111827' : '#f9fafb';
  }

  private hexToRgb(hex: string): [number, number, number] | null {
    const normalized = hex.replace('#', '');
    const int = parseInt(normalized, 16);
    if (Number.isNaN(int)) return null;
    return [(int >> 16) & 255, (int >> 8) & 255, int & 255];
  }

  private normalizeColor(value: string | null | undefined): string | null {
    if (!value) return null;
    const trimmed = value.trim();
    if (!/^#?[0-9a-fA-F]{6}$/.test(trimmed)) return null;
    return trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
  }
}
