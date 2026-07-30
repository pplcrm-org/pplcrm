import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { vi, describe, it, expect, beforeEach } from 'vitest';

import { EmailsStore } from '../../services/store/emailstore';
import { EmailFolderList } from './email-folder-list';

/**
 * The triage rail is collapsed on first use and remembers the user's toggle after that,
 * so an expanded rail survives a reload. The template mounts icons and the folder list,
 * neither of which the preference logic touches, so it is stubbed out.
 */
describe('EmailFolderList triage collapse preference', () => {
  const STORAGE_KEY = 'pc-email-triage-collapsed';

  function create(): EmailFolderList {
    const fixture = TestBed.createComponent(EmailFolderList);
    fixture.detectChanges();
    return fixture.componentInstance;
  }

  beforeEach(() => {
    localStorage.removeItem(STORAGE_KEY);
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        {
          provide: EmailsStore,
          useValue: {
            allFolders: signal([]),
            currentSelectedFolderId: signal(null),
            isSyncing: signal(false),
            lastSyncedAt: signal(null),
            loadAllFoldersWithCounts: vi.fn().mockResolvedValue(undefined),
          },
        },
      ],
    });
    TestBed.overrideComponent(EmailFolderList, { set: { template: '', imports: [] } });
  });

  it('starts collapsed when the user has no stored preference', () => {
    expect(create().foldersCollapsed()).toBe(true);
  });

  it('persists the expanded choice', () => {
    const component = create();

    component.toggleFolders();

    expect(component.foldersCollapsed()).toBe(false);
    expect(localStorage.getItem(STORAGE_KEY)).toBe('false');
  });

  it('restores an expanded rail on the next visit', () => {
    localStorage.setItem(STORAGE_KEY, 'false');

    expect(create().foldersCollapsed()).toBe(false);
  });

  it('restores a re-collapsed rail on the next visit', () => {
    localStorage.setItem(STORAGE_KEY, 'true');

    expect(create().foldersCollapsed()).toBe(true);
  });
});
