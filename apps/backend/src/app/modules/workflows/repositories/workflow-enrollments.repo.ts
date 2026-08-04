import type { QueryParams } from '../../../lib/base.repo';
import { BaseRepository } from '../../../lib/base.repo';
import { resolvePageWindow } from '../../../lib/paging';
import type { Transaction } from 'kysely';
import type { Models } from '../../../../../../../libs/common/src/lib/kysely.models';

export class WorkflowEnrollmentsRepo extends BaseRepository<'workflow_enrollments'> {
  constructor() {
    super('workflow_enrollments');
  }

  public async getEnrollmentsWithPersonDetails(
    input: {
      tenant_id: string;
      workflow_id: string;
      options?: QueryParams<'workflow_enrollments'>;
    },
    trx?: Transaction<Models>,
  ) {
    const options = input.options || {};
    const page = resolvePageWindow(options, 50);

    const query = this.getSelect(trx)
      .innerJoin('persons', 'persons.id', 'workflow_enrollments.person_id')
      .select([
        'workflow_enrollments.id',
        'workflow_enrollments.tenant_id',
        'workflow_enrollments.workflow_id',
        'workflow_enrollments.person_id',
        'workflow_enrollments.status',
        'workflow_enrollments.current_step_number',
        'workflow_enrollments.next_run_at',
        'workflow_enrollments.enrolled_at',
        'workflow_enrollments.created_at',
        'workflow_enrollments.updated_at',
        'persons.first_name as person_first_name',
        'persons.last_name as person_last_name',
        'persons.email as person_email',
      ])
      .where('workflow_enrollments.tenant_id', '=', input.tenant_id)
      .where('workflow_enrollments.workflow_id', '=', input.workflow_id)
      .orderBy('workflow_enrollments.enrolled_at', 'desc')
      .offset(page.offset)
      .limit(page.limit);

    const rows = await query.execute();
    return rows.map((row) => ({
      ...row,
      id: String(row.id),
      workflow_id: String(row.workflow_id),
      person_id: String(row.person_id),
    }));
  }
}
