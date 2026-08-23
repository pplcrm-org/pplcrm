/**
 * Human label for a delivery request's origin. One shared mapping so the requests grid and
 * the yard-sign standing card cannot disagree — the grid used to collapse `canvass` into
 * "Manual", which hid the fact that a canvasser created the request at the door.
 *
 * Typed `string` (not the union) so a widened source union (`web_form | manual | canvass`)
 * needs no change here; unknown values fall back to "manual".
 */
export function requestSourceLabel(source: string): string {
  if (source === 'web_form') return 'web form';
  if (source === 'canvass') return 'canvass';
  if (source === 'donor_portal') return 'donor portal';
  return 'manual';
}

/** Sentence-case variant for table cells ("Web form", "Canvass", "Manual"). */
export function requestSourceLabelSentence(source: string): string {
  const label = requestSourceLabel(source);
  return label.charAt(0).toUpperCase() + label.slice(1);
}
