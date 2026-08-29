import { vi } from 'vitest';
import { EmailsService } from './emails-service';

describe('EmailsService', () => {
  let service: EmailsService;
  let mockApi: any;

  const mockEmail = {
    id: '1',
    folder_id: 'folder1',
    from_email: 'test@example.com',
    to_email: 'recipient@example.com',
    subject: 'Test Email',
    preview: 'Test preview',
    is_favourite: false,
    assigned_to: null,
    updated_at: '2023-01-01T00:00:00.000Z',
  };

  const mockFolder = {
    id: 'folder1',
    name: 'Inbox',
    icon: 'inbox',
    color: '#000000',
  };

  const mockEmailBody = {
    id: '1',
    email_id: '1',
    body_html: '<p>Test email body</p>',
    body_text: 'Test email body',
  };

  beforeEach(() => {
    mockApi = {
      emails: {
        getEmails: { query: vi.fn() },
        getFolders: { query: vi.fn() },
        getFoldersWithCounts: { query: vi.fn() },
        getById: { query: vi.fn() },
        add: { mutate: vi.fn() },
        update: { mutate: vi.fn() },
        delete: { mutate: vi.fn() },
        setFavourite: { mutate: vi.fn() },
        setStatus: { mutate: vi.fn() },
        assign: { mutate: vi.fn() },
        getEmailBody: { query: vi.fn() },
        getEmailHeader: { query: vi.fn() },
        getEmailWithHeaders: { query: vi.fn() },
        deleteMany: { mutate: vi.fn() },
        addComment: { mutate: vi.fn() },
        deleteComment: { mutate: vi.fn() },
        getDraft: { query: vi.fn() },
        deleteDraft: { mutate: vi.fn() },
        getAllAttachments: { query: vi.fn() },
        getAttachmentsByEmailId: { query: vi.fn() },
        hasAttachment: { query: vi.fn() },
        hasAttachmentByEmailIds: { query: vi.fn() },
        restoreFromTrash: { mutate: vi.fn() },
        moveToFolder: { mutate: vi.fn() },
        setEmailReadStatus: { mutate: vi.fn() },
      },
      msSync: {
        syncNow: { mutate: vi.fn() },
        getConnectionStatus: { query: vi.fn() },
      },
      googleSync: {
        syncNow: { mutate: vi.fn() },
        getConnectionStatus: { query: vi.fn() },
      },
    };

    // Create a bare instance without invoking Angular inject()s
    service = Object.create(EmailsService.prototype) as EmailsService;
    (service as any).api = mockApi;
    (service as any).ac = new AbortController();
    // §15 — the Inbox is campaign-scoped; stub the context the service reads.
    (service as any).campaignContext = {
      ensureLoaded: vi.fn().mockResolvedValue(undefined),
      activeCampaignId: () => 'camp-1',
    };
  });

  describe('Initialization', () => {
    it('should be created', () => {
      expect(service).toBeTruthy();
    });
  });

  describe('Email Operations', () => {
    it('should get emails for a folder', async () => {
      const mockEmails = [mockEmail];
      mockApi.emails.getEmails.query.mockResolvedValue(mockEmails);

      const result = await service.getEmails('folder1');

      expect(mockApi.emails.getEmails.query).toHaveBeenCalledWith({ campaignId: 'camp-1', folderId: 'folder1' });
      expect(result).toEqual(mockEmails);
    });

    it('should forward limit and offset for paging', async () => {
      mockApi.emails.getEmails.query.mockResolvedValue([]);

      await service.getEmails('folder1', 25, 50);

      expect(mockApi.emails.getEmails.query).toHaveBeenCalledWith({
        campaignId: 'camp-1',
        folderId: 'folder1',
        limit: 25,
        offset: 50,
      });
    });

    it('should set email as favourite', async () => {
      mockApi.emails.setFavourite.mutate.mockResolvedValue(undefined);

      await service.setFavourite('1', true);

      expect(mockApi.emails.setFavourite.mutate).toHaveBeenCalledWith({
        id: '1',
        favourite: true,
      });
    });

    it('should set email read status', async () => {
      mockApi.emails.setEmailReadStatus.mutate.mockResolvedValue(undefined);

      await service.setEmailReadStatus('1', true);

      expect(mockApi.emails.setEmailReadStatus.mutate).toHaveBeenCalledWith({
        id: '1',
        isRead: true,
      });
    });

    it('should assign email to user', async () => {
      mockApi.emails.assign.mutate.mockResolvedValue(undefined);

      await service.assign('1', 'user123');

      expect(mockApi.emails.assign.mutate).toHaveBeenCalledWith({
        id: '1',
        user_id: 'user123',
      });
    });

    it('should unassign email when userId is null', async () => {
      mockApi.emails.assign.mutate.mockResolvedValue(undefined);

      await service.assign('1', null);

      expect(mockApi.emails.assign.mutate).toHaveBeenCalledWith({
        id: '1',
        user_id: null,
      });
    });

    it('should get email with headers', async () => {
      const mockResponse = {
        body: { body_html: '<p>Test body</p>' },
        header: {
          email: {
            to_list: [{ name: 'John Doe', email: 'john@example.com', pos: 0 }],
            cc_list: [],
            bcc_list: [],
          },
          comments: [],
        },
      };
      mockApi.emails.getEmailWithHeaders.query.mockResolvedValue(mockResponse);

      const result = await service.getEmailWithHeaders('1');

      expect(mockApi.emails.getEmailWithHeaders.query).toHaveBeenCalledWith('1');
      expect(result).toEqual(mockResponse);
    });
  });

  describe('Folder Operations', () => {
    it('should get all folders', async () => {
      const mockFolders = [mockFolder];
      mockApi.emails.getFolders.query.mockResolvedValue(mockFolders);

      const result = await service.getFolders();

      expect(mockApi.emails.getFolders.query).toHaveBeenCalled();
      expect(result).toEqual(mockFolders);
    });
  });

  describe('Email Body Operations', () => {
    it('should get email body by id', async () => {
      mockApi.emails.getEmailBody.query.mockResolvedValue(mockEmailBody);

      const result = await service.getEmailBody('1');

      expect(mockApi.emails.getEmailBody.query).toHaveBeenCalledWith('1');
      expect(result).toEqual(mockEmailBody);
    });

    it('should handle missing email body', async () => {
      mockApi.emails.getEmailBody.query.mockResolvedValue(null);

      const result = await service.getEmailBody('1');

      expect(result).toBeNull();
    });
  });

  describe('Comment Operations', () => {
    it('should add comment to email', async () => {
      const mockComment = {
        id: '1',
        email_id: '1',
        author_id: 'user123',
        comment: 'Test comment',
        created_at: new Date(),
      };
      mockApi.emails.addComment.mutate.mockResolvedValue(mockComment);

      const result = await service.addComment('1', 'user123', 'Test comment');

      expect(mockApi.emails.addComment.mutate).toHaveBeenCalledWith({
        id: '1',
        author_id: 'user123',
        comment: 'Test comment',
      });
      expect(result).toEqual(mockComment);
    });
  });

  describe('Sync Operations', () => {
    it('should trigger email sync when MS is connected', async () => {
      mockApi.msSync.getConnectionStatus.query.mockResolvedValue({ connected: true });
      mockApi.msSync.syncNow.mutate.mockResolvedValue({ inserted: 5 });
      mockApi.googleSync.getConnectionStatus.query.mockResolvedValue({ connected: false });

      const result = await service.syncEmails();

      expect(mockApi.msSync.syncNow.mutate).toHaveBeenCalled();
      expect(result).toEqual({ inserted: 5, failedProviders: [], needsReconnect: false });
    });

    it('should trigger email sync when Google is connected', async () => {
      mockApi.msSync.getConnectionStatus.query.mockResolvedValue({ connected: false });
      mockApi.googleSync.getConnectionStatus.query.mockResolvedValue({ connected: true });
      mockApi.googleSync.syncNow.mutate.mockResolvedValue({ inserted: 3 });

      const result = await service.syncEmails();

      expect(mockApi.googleSync.syncNow.mutate).toHaveBeenCalled();
      expect(result).toEqual({ inserted: 3, failedProviders: [], needsReconnect: false });
    });

    it('reports a connected provider whose sync failed instead of returning a success shape', async () => {
      // Regression guard: a failed provider sync used to be caught into console.error and the
      // method returned { inserted: 0 } — the store then showed "Inbox synced. No new emails".
      mockApi.msSync.getConnectionStatus.query.mockResolvedValue({ connected: true });
      mockApi.msSync.syncNow.mutate.mockRejectedValue(new Error('boom'));
      mockApi.googleSync.getConnectionStatus.query.mockResolvedValue({ connected: true });
      mockApi.googleSync.syncNow.mutate.mockResolvedValue({ inserted: 2 });

      const result = await service.syncEmails();

      expect(result).toEqual({ inserted: 2, failedProviders: ['Microsoft'], needsReconnect: false });
    });

    it('flags needsReconnect when a provider fails with the backend`s 412 precondition error', async () => {
      const preconditionError = Object.assign(new Error('Token refresh failed.'), {
        data: { httpStatus: 412 },
      });
      mockApi.msSync.getConnectionStatus.query.mockResolvedValue({ connected: false });
      mockApi.googleSync.getConnectionStatus.query.mockResolvedValue({ connected: true });
      mockApi.googleSync.syncNow.mutate.mockRejectedValue(preconditionError);

      const result = await service.syncEmails();

      expect(result).toEqual({ inserted: 0, failedProviders: ['Google'], needsReconnect: true });
    });

    it('still throws when no provider is connected at all', async () => {
      mockApi.msSync.getConnectionStatus.query.mockResolvedValue({ connected: false });
      mockApi.googleSync.getConnectionStatus.query.mockResolvedValue({ connected: false });

      await expect(service.syncEmails()).rejects.toThrow('No email accounts connected');
    });

    it('should query connection status', async () => {
      const mockStatus = { connected: true, msEmail: 'test@example.com', syncedAt: null };
      mockApi.msSync.getConnectionStatus.query.mockResolvedValue(mockStatus);

      const result = await service.getConnectionStatus();

      expect(mockApi.msSync.getConnectionStatus.query).toHaveBeenCalledWith({ campaignId: 'camp-1' });
      expect(result).toEqual(mockStatus);
    });
  });

  describe('Error Handling', () => {
    it('should handle API errors gracefully', async () => {
      const error = new Error('API Error');
      mockApi.emails.getEmails.query.mockRejectedValue(error);

      await expect(service.getEmails('folder1')).rejects.toThrow('API Error');
    });

    it('should handle network errors in favourite toggle', async () => {
      const error = new Error('Network Error');
      mockApi.emails.setFavourite.mutate.mockRejectedValue(error);

      await expect(service.setFavourite('1', true)).rejects.toThrow('Network Error');
    });
  });
});
