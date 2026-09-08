import { describe, expect, it } from 'vitest';

import { ALL_FOLDERS, allowsAttachmentDownload, allowsEagerAttachmentFetch, allowsInlineImages } from './emails';

describe('email attachment payload policy', () => {
  it('spam attachments may never be downloaded; every other folder allows it', () => {
    expect(allowsAttachmentDownload(ALL_FOLDERS.SPAM)).toBe(false);
    expect(allowsAttachmentDownload(ALL_FOLDERS.INBOX)).toBe(true);
    expect(allowsAttachmentDownload(ALL_FOLDERS.TRASH)).toBe(true);
    // A numeric or missing folder id is not Spam, so it is allowed.
    expect(allowsAttachmentDownload(42)).toBe(true);
    expect(allowsAttachmentDownload(null)).toBe(true);
    expect(allowsAttachmentDownload(undefined)).toBe(true);
  });

  it('eager fetch is limited to the folders people work out of: Inbox and Sent', () => {
    expect(allowsEagerAttachmentFetch(ALL_FOLDERS.INBOX)).toBe(true);
    expect(allowsEagerAttachmentFetch(ALL_FOLDERS.SENT)).toBe(true);
    expect(allowsEagerAttachmentFetch(ALL_FOLDERS.SPAM)).toBe(false);
    expect(allowsEagerAttachmentFetch(ALL_FOLDERS.TRASH)).toBe(false);
    expect(allowsEagerAttachmentFetch(ALL_FOLDERS.DRAFTS)).toBe(false);
    expect(allowsEagerAttachmentFetch(null)).toBe(false);
  });

  it('inline images are blocked in Spam (loading one confirms a live address) and allowed elsewhere', () => {
    expect(allowsInlineImages(ALL_FOLDERS.SPAM)).toBe(false);
    expect(allowsInlineImages(ALL_FOLDERS.INBOX)).toBe(true);
    expect(allowsInlineImages(undefined)).toBe(true);
  });
});
