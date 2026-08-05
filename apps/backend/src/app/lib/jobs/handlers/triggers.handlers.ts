import { logger } from '../../../logger';
import type { JobPayloadOf } from '../job-payloads';

/**
 * Fire the `contact_created` automation trigger once for each person a CSV import inserted.
 *
 * Enqueued by PersonsService.processImportRows inside each chunk's transaction (so a rolled-back
 * chunk discards its jobs), chunked so no single job carries an entire 100k-row import. The
 * import used to run this loop inline in the import job, one awaited trigger evaluation per
 * inserted person — minutes of extra wall-clock at scale.
 *
 * Each person is evaluated in its own try/catch: one contact whose trigger evaluation fails must
 * not stop the remaining contacts in the chunk, and must not fail the job into a retry that
 * would re-fire every trigger that already succeeded.
 */
export async function handleTriggerContactCreated(payload: JobPayloadOf<'trigger_contact_created'>): Promise<void> {
  if (payload.person_ids.length === 0) return;

  // Imported lazily, like the other handlers that reach into a module controller, so the job
  // dispatcher does not pull the whole workflows module in at load time.
  const { WorkflowsController } = await import('../../../modules/workflows/controller');
  const controller = new WorkflowsController();

  for (const personId of payload.person_ids) {
    try {
      await controller.triggerWorkflow(payload.tenant_id, personId, 'contact_created', null);
    } catch (err) {
      logger.error(
        { err, tenantId: payload.tenant_id, personId },
        'Failed to fire the contact_created automation trigger for an imported contact',
      );
    }
  }
}

/**
 * Fire the `tag_added` automation trigger once for each person/tag pair a CSV import actually
 * created. The import enqueues only `.returning()`-confirmed new map_peoples_tags rows, so pairs
 * the contact already carried (re-import of an overlapping file) never re-fire. Same
 * in-transaction chunked enqueue and per-pair fault isolation as handleTriggerContactCreated.
 */
export async function handleTriggerTagAdded(payload: JobPayloadOf<'trigger_tag_added'>): Promise<void> {
  if (payload.pairs.length === 0) return;

  const { WorkflowsController } = await import('../../../modules/workflows/controller');
  const controller = new WorkflowsController();

  for (const pair of payload.pairs) {
    try {
      await controller.triggerTagAdded(payload.tenant_id, pair.person_id, pair.tag_id, pair.tag_name);
    } catch (err) {
      logger.error(
        { err, tenantId: payload.tenant_id, personId: pair.person_id, tagId: pair.tag_id },
        'Failed to fire the tag_added automation trigger for an imported contact',
      );
    }
  }
}
