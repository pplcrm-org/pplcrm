import { env } from '../../../env';
import { BaseController } from '../../lib/base.controller';
import type { Transaction } from 'kysely';
import type { OperationDataType, Models } from '../../../../../../libs/common/src/lib/kysely.models';
import { TaskCommentsRepo } from './repositories/task-comments.repo';

export class TaskCommentsController extends BaseController<'task_comments', TaskCommentsRepo> {
  constructor() {
    super(new TaskCommentsRepo());
  }

  public getByTaskId(input: { tenant_id: string; task_id: string }) {
    return (this as any).getRepo().getManyBy('task_id', { tenant_id: input.tenant_id, value: input.task_id });
  }

  public override async add(row: OperationDataType<'task_comments', 'insert'>, trx?: Transaction<Models>) {
    const comment = await super.add(row, trx);
    if (comment && row.comment && row.task_id && row.tenant_id) {
      const actorId = row.createdby_id || row.author_id || '';
      if (actorId) {
        await this.userActivity.log(
          {
            tenant_id: String(row.tenant_id),
            user_id: String(actorId),
            activity: 'update',
            entity: 'tasks',
            entity_id: String(row.task_id),
            quantity: 1,
            metadata: { action: 'add_comment', comment_id: comment.id },
          },
          trx,
        );
      }

      // Queued, not detached: processMentions sends SMTP, and a fire-and-forget promise lost
      // every in-flight mention on shutdown. When the caller supplied a transaction the job row
      // is written inside it, so a rolled-back comment can never leave a ghost notification.
      await (trx ?? this.getRepo().db)
        .insertInto('background_jobs')
        .values({
          tenant_id: String(row.tenant_id),
          queue: 'default',
          status: 'pending',
          payload: JSON.stringify({
            type: 'process_mentions',
            tenant_id: String(row.tenant_id),
            commentText: row.comment,
            commentLink: `${env.appUrl}/tasks/${row.task_id}`,
            authorId: String(actorId),
          }),
          run_at: new Date(),
          max_attempts: 3,
        })
        .execute();
    }
    return comment;
  }

  public async addComment(row: OperationDataType<'task_comments', 'insert'>) {
    return this.add(row);
  }
}
