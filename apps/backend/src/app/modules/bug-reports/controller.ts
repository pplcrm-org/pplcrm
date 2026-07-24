import type { IAuthKeyPayload, AddBugReportType } from '../../../../../../libs/common/src';

import { BaseController } from '../../lib/base.controller';
import { BadRequestError } from '../../errors/app-errors';
import { checkRateLimit } from '../../lib/rate-limiter';
import { BugReportsRepo } from './repositories/bug-reports.repo';

const REPORTS_PER_HOUR = 5;
const RATE_WINDOW_MS = 60 * 60 * 1000;

export class BugReportsController extends BaseController<'bug_reports', BugReportsRepo> {
  constructor() {
    super(new BugReportsRepo());
  }

  /**
   * Store the report and enqueue the ops email in one transaction (transactional outbox) —
   * the email job carries only the report id; the handler composes the message and pulls the
   * screenshot from storage. Fire-and-forget: the caller only gets the reference id back.
   */
  public async report(auth: IAuthKeyPayload, input: AddBugReportType): Promise<{ id: string }> {
    checkRateLimit(`bug-report:${auth.tenant_id}:${auth.user_id}`, REPORTS_PER_HOUR, RATE_WINDOW_MS);

    if (input.screenshot_file_id) {
      const file = await this.getRepo()
        .db.selectFrom('files')
        .select(['id', 'mime_type'])
        .where('tenant_id', '=', auth.tenant_id)
        .where('id', '=', input.screenshot_file_id)
        .executeTakeFirst();
      if (!file) {
        throw new BadRequestError('Screenshot upload not found. Remove it and try again.');
      }
      if (!file.mime_type?.startsWith('image/')) {
        throw new BadRequestError('The screenshot must be an image.');
      }
    }

    const report = await this.getRepo()
      .transaction()
      .execute(async (trx) => {
        const row = await this.getRepo().add(
          {
            row: {
              tenant_id: auth.tenant_id,
              created_by: auth.user_id,
              description: input.description,
              page_url: input.page_url ?? null,
              user_agent: input.user_agent ?? null,
              viewport: input.viewport ?? null,
              screenshot_file_id: input.screenshot_file_id ?? null,
            },
          },
          trx,
        );

        if (input.screenshot_file_id) {
          await trx
            .updateTable('files')
            .set({ entity_type: 'bug_report', entity_id: String(row.id) })
            .where('tenant_id', '=', auth.tenant_id)
            .where('id', '=', input.screenshot_file_id)
            .execute();
        }

        await trx
          .insertInto('background_jobs')
          .values({
            tenant_id: auth.tenant_id,
            queue: 'default',
            status: 'pending',
            payload: JSON.stringify({
              type: 'send-bug-report-email',
              bugReportId: String(row.id),
              tenant_id: auth.tenant_id,
            }),
            run_at: new Date(),
            max_attempts: 5,
          })
          .execute();

        return row;
      });

    return { id: String(report.id) };
  }
}
