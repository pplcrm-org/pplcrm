import { vi, describe, it, expect, beforeEach } from 'vitest';
import { NewslettersRouter } from './trpc.router';
import { MAX_SAVED_TEMPLATES_PER_TENANT, NewsletterTemplatesController } from './templates.controller';
import { NewsletterTemplatesRepo } from './repositories/newsletter-templates.repo';
import { BaseRepository } from '../../lib/base.repo';

function mockAuthDb() {
  const mockQB: any = {
    select: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    executeTakeFirst: vi.fn().mockResolvedValue({ role: 'owner', verified: true }),
  };
  vi.spyOn(BaseRepository, 'dbInstance', 'get').mockReturnValue({
    selectFrom: vi.fn().mockReturnValue(mockQB),
  } as any);
}

const auth = { tenant_id: '1', user_id: '1', session_id: 's1', role: 'owner', campaign_id: null };

const templateRow = {
  id: '5',
  tenant_id: '1',
  name: 'Monthly update',
  html_content: '<!DOCTYPE html><html><body>Hi</body></html>',
  plain_text_content: 'Hi',
};

describe('NewslettersRouter templates', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockAuthDb();
  });

  it('lists templates scoped to the calling tenant', async () => {
    const spy = vi
      .spyOn(NewsletterTemplatesController.prototype, 'listTemplates')
      .mockResolvedValue([templateRow] as any);

    const caller = NewslettersRouter.createCaller({ auth } as any);
    const result = await caller.templates.getAll();

    expect(spy).toHaveBeenCalledWith('1');
    expect(result).toEqual([templateRow]);
  });

  it('adds a template with tenant and creator stamped from auth', async () => {
    vi.spyOn(NewsletterTemplatesRepo.prototype, 'count').mockResolvedValue(0);
    const addSpy = vi.spyOn(NewsletterTemplatesController.prototype, 'add').mockResolvedValue(templateRow as any);

    const caller = NewslettersRouter.createCaller({ auth } as any);
    const result = await caller.templates.add({
      name: 'Monthly update',
      html_content: templateRow.html_content,
      plain_text_content: 'Hi',
    });

    expect(addSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        tenant_id: '1',
        createdby_id: '1',
        updatedby_id: '1',
        name: 'Monthly update',
        html_content: templateRow.html_content,
        plain_text_content: 'Hi',
      }),
    );
    expect(result).toEqual(templateRow);
  });

  it('rejects a save once the tenant cap is reached, naming the number', async () => {
    vi.spyOn(NewsletterTemplatesRepo.prototype, 'count').mockResolvedValue(MAX_SAVED_TEMPLATES_PER_TENANT);
    const addSpy = vi.spyOn(NewsletterTemplatesController.prototype, 'add');

    const caller = NewslettersRouter.createCaller({ auth } as any);
    await expect(
      caller.templates.add({ name: 'One too many', html_content: templateRow.html_content }),
    ).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: expect.stringContaining(`limit of ${MAX_SAVED_TEMPLATES_PER_TENANT} saved templates`),
    });
    expect(addSpy).not.toHaveBeenCalled();
  });

  it('rejects empty (whitespace-only) template content at the input boundary', async () => {
    const addSpy = vi.spyOn(NewsletterTemplatesController.prototype, 'add');

    const caller = NewslettersRouter.createCaller({ auth } as any);
    await expect(caller.templates.add({ name: 'Blank', html_content: '   ' })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    expect(addSpy).not.toHaveBeenCalled();
  });

  it('rejects a missing name', async () => {
    const caller = NewslettersRouter.createCaller({ auth } as any);
    await expect(caller.templates.add({ name: '', html_content: templateRow.html_content })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
  });

  it('deletes a template the tenant owns', async () => {
    vi.spyOn(NewsletterTemplatesRepo.prototype, 'getOneById').mockResolvedValue(templateRow as any);
    const deleteSpy = vi.spyOn(NewsletterTemplatesController.prototype, 'delete').mockResolvedValue(true as any);

    const caller = NewslettersRouter.createCaller({ auth } as any);
    const result = await caller.templates.delete('5');

    expect(NewsletterTemplatesRepo.prototype.getOneById).toHaveBeenCalledWith({ tenant_id: '1', id: '5' });
    expect(deleteSpy).toHaveBeenCalledWith('1', '5', '1');
    expect(result).toBe(true);
  });

  it('returns NOT_FOUND when deleting a template outside the tenant (scoped lookup finds nothing)', async () => {
    vi.spyOn(NewsletterTemplatesRepo.prototype, 'getOneById').mockResolvedValue(undefined);
    const deleteSpy = vi.spyOn(NewsletterTemplatesController.prototype, 'delete');

    const caller = NewslettersRouter.createCaller({ auth } as any);
    await expect(caller.templates.delete('999')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(deleteSpy).not.toHaveBeenCalled();
  });

  it('renames a template the tenant owns', async () => {
    vi.spyOn(NewsletterTemplatesRepo.prototype, 'getOneById').mockResolvedValue(templateRow as any);
    const updateSpy = vi
      .spyOn(NewsletterTemplatesController.prototype, 'update')
      .mockResolvedValue({ ...templateRow, name: 'Quarterly update' } as any);

    const caller = NewslettersRouter.createCaller({ auth } as any);
    const result = await caller.templates.rename({ id: '5', data: { name: 'Quarterly update' } });

    expect(updateSpy).toHaveBeenCalledWith({
      tenant_id: '1',
      id: '5',
      row: expect.objectContaining({ name: 'Quarterly update', updatedby_id: '1' }),
    });
    expect(result).toMatchObject({ name: 'Quarterly update' });
  });

  it('returns NOT_FOUND when renaming a template outside the tenant', async () => {
    vi.spyOn(NewsletterTemplatesRepo.prototype, 'getOneById').mockResolvedValue(undefined);

    const caller = NewslettersRouter.createCaller({ auth } as any);
    await expect(caller.templates.rename({ id: '999', data: { name: 'Nope' } })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('rejects unauthenticated template requests with UNAUTHORIZED', async () => {
    const caller = NewslettersRouter.createCaller({} as any);
    await expect(caller.templates.getAll()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });
});
