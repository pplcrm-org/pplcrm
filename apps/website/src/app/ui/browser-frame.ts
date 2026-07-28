import { Component, input } from '@angular/core';

/**
 * A browser-chrome shell (three dots + a URL pill) around a screenshot or a
 * projected mock UI. Pass `imageSrc` to show a real screenshot, or project
 * content for a live HTML mock:
 *
 *   <pc-browser-frame url="app.pplcrm.com/inbox" imageSrc="assets/site-shots/01-shot.webp" />
 */
@Component({
  selector: 'pc-browser-frame',
  template: `
    <div
      class="mx-auto w-full max-w-[880px] overflow-hidden rounded-xl border border-line bg-base-100 shadow-[0_24px_70px_rgba(3,10,22,.45)]"
    >
      <div class="flex items-center gap-2 border-b border-line bg-base-200 px-3.5 py-2.5">
        <span class="h-2.5 w-2.5 rounded-full bg-base-300"></span>
        <span class="h-2.5 w-2.5 rounded-full bg-base-300"></span>
        <span class="h-2.5 w-2.5 rounded-full bg-base-300"></span>
        <span class="ml-2.5 rounded border border-line bg-base-100 px-2.5 py-1 text-[11px] text-base-content/45">{{
          url()
        }}</span>
      </div>

      @if (imageSrc()) {
        <img [src]="imageSrc()" [alt]="imageAlt()" class="block w-full" />
      } @else {
        <ng-content />
      }
    </div>
  `,
})
export class BrowserFrame {
  public readonly url = input<string>('app.pplcrm.com');
  public readonly imageSrc = input<string>('');
  public readonly imageAlt = input<string>('');
}
