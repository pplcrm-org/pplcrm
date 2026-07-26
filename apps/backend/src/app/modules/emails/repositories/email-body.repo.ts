import { BaseRepository } from '../../../lib/base.repo';
import { StorageService } from '../../../lib/storage.service';
import { logger } from '../../../logger';

export class EmailBodiesRepo extends BaseRepository<'email_bodies'> {
  private readonly storageService = new StorageService();

  constructor() {
    super('email_bodies');
  }

  /**
   * Resolve a body's HTML regardless of where it lives.
   *
   * Bodies are stored inline when small and in blob storage when not, so no caller should read
   * `body_html` directly — rows written before the storage split, and small rows written after it,
   * both keep their HTML inline, while everything else carries only a `storage_key`.
   *
   * Returns null when there is no body row at all. A body whose blob cannot be read returns an
   * empty string rather than throwing: the sender, subject and attachment list are still worth
   * showing even when the content is temporarily unreachable.
   */
  public async getBodyHtml(tenant_id: string, email_id: string): Promise<string | null> {
    const row = await this.getSelect()
      .select(['body_html', 'storage_key'])
      .where('tenant_id', '=', tenant_id)
      .where('email_id', '=', email_id)
      .executeTakeFirst();

    if (!row) return null;
    if (row.body_html != null) return row.body_html;
    if (!row.storage_key) return '';

    try {
      const buffer = await this.storageService.download(String(row.storage_key));
      return buffer.toString('utf8');
    } catch (err) {
      logger.error({ err }, `Failed to read email body blob ${row.storage_key} for email ${email_id}`);
      return '';
    }
  }
}
