import { describe, it, expect } from 'vitest';
import { assertUploadAllowed, extensionOf, safeMimeType } from './upload-content-types';

/**
 * SECURITY REGRESSION (M11) — there was no extension, MIME, or magic-byte check anywhere
 * in the upload path. The client declared a mimeType, it was stored verbatim, and the
 * download route echoed it back as the response Content-Type. Content-Disposition:
 * attachment kept it from rendering inline, so this was never stored XSS — but it left the
 * platform usable as a general-purpose file host on its own domain.
 */
describe('assertUploadAllowed', () => {
  it('accepts the things a CRM actually stores', () => {
    for (const [name, mime] of [
      ['donors.csv', 'text/csv'],
      ['logo.png', 'image/png'],
      ['report.pdf', 'application/pdf'],
      ['list.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
    ] as const) {
      expect(() => assertUploadAllowed(name, mime)).not.toThrow();
    }
  });

  it('refuses executables regardless of the declared type', () => {
    // The declared type is a lie the uploader controls; the extension is what a recipient
    // double-clicks.
    for (const name of ['payload.exe', 'run.bat', 'installer.msi', 'app.apk', 'script.ps1']) {
      expect(() => assertUploadAllowed(name, 'text/plain')).toThrow(/cannot be uploaded/i);
    }
  });

  it('refuses markup and server-script extensions that would be served from our domain', () => {
    for (const name of ['phish.html', 'page.htm', 'shell.php', 'x.jsp']) {
      expect(() => assertUploadAllowed(name, 'text/plain')).toThrow(/cannot be uploaded/i);
    }
  });

  it('refuses a MIME type outside the allow-list', () => {
    expect(() => assertUploadAllowed('thing.bin', 'application/x-msdownload')).toThrow(/not supported/i);
  });

  it('allows an absent MIME type once the extension has passed', () => {
    expect(() => assertUploadAllowed('notes.txt', null)).not.toThrow();
    expect(() => assertUploadAllowed('notes.txt', undefined)).not.toThrow();
  });

  it('ignores the case and parameters of the declared type', () => {
    expect(() => assertUploadAllowed('a.csv', 'TEXT/CSV; charset=utf-8')).not.toThrow();
  });
});

describe('safeMimeType', () => {
  it('keeps a recognised type', () => {
    expect(safeMimeType('image/png')).toBe('image/png');
  });

  it('downgrades anything unrecognised rather than echoing it back', () => {
    expect(safeMimeType('text/html')).toBe('application/octet-stream');
    expect(safeMimeType('application/x-msdownload')).toBe('application/octet-stream');
    expect(safeMimeType(null)).toBe('application/octet-stream');
  });
});

describe('extensionOf', () => {
  it.each([
    ['a.csv', 'csv'],
    ['a.tar.gz', 'gz'],
    ['A.PDF', 'pdf'],
    ['noext', ''],
    ['.hidden', ''],
    ['dir/name.txt', 'txt'],
  ])('%s -> %s', (name, ext) => {
    expect(extensionOf(name)).toBe(ext);
  });
});
