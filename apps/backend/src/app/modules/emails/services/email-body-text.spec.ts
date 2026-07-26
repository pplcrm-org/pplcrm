import { describe, expect, it } from 'vitest';
import { BODY_TEXT_MAX_CHARS, extractBodyText } from './email-body-text';

describe('extractBodyText', () => {
  it('strips tags and collapses whitespace', () => {
    expect(extractBodyText('<p>Hello   there</p>\n<p>World</p>')).toBe('Hello there World');
  });

  it('keeps words apart across block boundaries', () => {
    // Without block-aware replacement this collapses to "FirstSecond" and search stops matching.
    expect(extractBodyText('<div>First</div><div>Second</div>')).toBe('First Second');
    expect(extractBodyText('Line one<br>Line two')).toBe('Line one Line two');
  });

  it('drops style and head content instead of indexing CSS', () => {
    const html = '<head><title>Ignore</title></head><style>.a{color:red}</style><p>Real content</p>';
    expect(extractBodyText(html)).toBe('Real content');
  });

  it('decodes the entities that matter for search', () => {
    expect(extractBodyText('<p>Tom&nbsp;&amp;&nbsp;Jerry &quot;quoted&quot;</p>')).toBe('Tom & Jerry "quoted"');
  });

  it('caps runaway bodies', () => {
    const html = `<p>${'word '.repeat(50_000)}</p>`;
    expect(extractBodyText(html).length).toBeLessThanOrEqual(BODY_TEXT_MAX_CHARS);
  });

  it('returns an empty string for a body with no text', () => {
    expect(extractBodyText('<div><img src="x.png"></div>')).toBe('');
    expect(extractBodyText('')).toBe('');
  });
});
