/**
 * Labels for the "command" modifier key, chosen from the platform the browser reports.
 *
 * Behaviour never depended on this: every shortcut handler in the app tests
 * `event.metaKey || event.ctrlKey`, so Ctrl has always worked on Windows and Linux.
 * Only the printed key caps and prose used to say ⌘ to everyone.
 *
 * A wrong guess costs nothing but a label, so the detection stays deliberately simple.
 */

/** True when the browser reports macOS, iPadOS or iOS. */
export function isApplePlatform(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Mac|iPhone|iPad|iPod/i.test(`${navigator.platform} ${navigator.userAgent}`);
}

const APPLE = isApplePlatform();

/** Key cap for the command modifier: `⌘` on Apple platforms, `Ctrl` elsewhere. */
export const MOD_KEY_LABEL = APPLE ? '⌘' : 'Ctrl';

/** Key cap for shift: `⇧` on Apple platforms, `Shift` elsewhere. */
export const SHIFT_KEY_LABEL = APPLE ? '⇧' : 'Shift';

/** The command modifier written out for prose: `Cmd` on Apple platforms, `Ctrl` elsewhere. */
export const MOD_KEY_WORD = APPLE ? 'Cmd' : 'Ctrl';

/** Inline label for modifier + key, e.g. `⌘K` or `Ctrl+K`. */
export function modCombo(key: string): string {
  return APPLE ? `${MOD_KEY_LABEL}${key}` : `${MOD_KEY_LABEL}+${key}`;
}

/** Inline label for modifier + shift + key, e.g. `⌘⇧K` or `Ctrl+Shift+K`. */
export function modShiftCombo(key: string): string {
  return APPLE ? `${MOD_KEY_LABEL}${SHIFT_KEY_LABEL}${key}` : `${MOD_KEY_LABEL}+${SHIFT_KEY_LABEL}+${key}`;
}
