import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * The labels are decided once when the module is first imported, so each case stubs
 * `navigator` and re-imports the module rather than calling a setter.
 */
async function loadWith(platform: string, userAgent: string) {
  vi.stubGlobal('navigator', { platform, userAgent });
  vi.resetModules();
  return import('./platform-keys');
}

const MAC_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126.0 Safari/537.36';
const WINDOWS_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36';
const LINUX_UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36';

describe('platform key labels', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('prints the Apple symbols on macOS', async () => {
    const keys = await loadWith('MacIntel', MAC_UA);

    expect(keys.isApplePlatform()).toBe(true);
    expect(keys.MOD_KEY_LABEL).toBe('⌘');
    expect(keys.SHIFT_KEY_LABEL).toBe('⇧');
    expect(keys.MOD_KEY_WORD).toBe('Cmd');
    expect(keys.modCombo('K')).toBe('⌘K');
    expect(keys.modShiftCombo('K')).toBe('⌘⇧K');
  });

  it('prints Ctrl and Shift on Windows', async () => {
    const keys = await loadWith('Win32', WINDOWS_UA);

    expect(keys.isApplePlatform()).toBe(false);
    expect(keys.MOD_KEY_LABEL).toBe('Ctrl');
    expect(keys.SHIFT_KEY_LABEL).toBe('Shift');
    expect(keys.MOD_KEY_WORD).toBe('Ctrl');
    expect(keys.modCombo('K')).toBe('Ctrl+K');
    expect(keys.modShiftCombo('K')).toBe('Ctrl+Shift+K');
  });

  it('prints Ctrl and Shift on Linux', async () => {
    const keys = await loadWith('Linux x86_64', LINUX_UA);

    expect(keys.isApplePlatform()).toBe(false);
    expect(keys.modCombo('K')).toBe('Ctrl+K');
  });

  it('treats an iPad as an Apple platform', async () => {
    const keys = await loadWith('iPad', 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15');

    expect(keys.isApplePlatform()).toBe(true);
  });
});
