import { Directive, computed, inject, input } from '@angular/core';

import { TourService } from './tour.service';

/**
 * Marks an element as a tour target.
 *
 * When the active stop names this id, the element gets `.pc-tour-target`, which does two things
 * in pure CSS: raises it above the scrim (that is the whole spotlight — no cut-out mask, no
 * measured rect) and publishes `anchor-name: --pc-tour-anchor` for the bubble to position
 * against.
 *
 * Deliberately no `getBoundingClientRect`, no resize observer, no scroll listener. Positioning is
 * a CSS job, and the codebase already relies on anchor positioning for its popover dropdowns.
 */
@Directive({
  selector: '[pcTourAnchor]',
  host: {
    '[class.pc-tour-target]': 'isActive()',
  },
})
export class TourAnchor {
  private readonly tour = inject(TourService);

  public readonly pcTourAnchor = input.required<string>();

  protected readonly isActive = computed(() => this.tour.activeAnchor() === this.pcTourAnchor());
}
