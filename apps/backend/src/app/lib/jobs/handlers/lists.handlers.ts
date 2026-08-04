import { logger } from '../../../logger';
import type { JobPayloadOf } from '../job-payloads';

/**
 * Fire the `list_joined` automation trigger once for each person added to a static list.
 *
 * Enqueued by ListsController.addList inside the list-creation transaction, chunked so no single
 * job carries an entire large membership. The controller used to run this loop inline in the HTTP
 * request, which meant one awaited trigger evaluation per member before the response could return.
 *
 * Each person is evaluated in its own try/catch: one contact whose trigger evaluation fails must
 * not stop the remaining contacts in the chunk, and must not fail the job into a retry that would
 * re-fire every trigger that already succeeded.
 */
export async function handleTriggerListJoined(payload: JobPayloadOf<'trigger_list_joined'>): Promise<void> {
  if (payload.person_ids.length === 0) return;

  // Imported lazily, like the other handlers that reach into a module controller, so the job
  // dispatcher does not pull the whole workflows module in at load time.
  const { WorkflowsController } = await import('../../../modules/workflows/controller');
  const controller = new WorkflowsController();

  for (const personId of payload.person_ids) {
    try {
      await controller.triggerWorkflow(payload.tenant_id, personId, 'list_joined', payload.list_id);
    } catch (err) {
      logger.error(
        { err, tenantId: payload.tenant_id, listId: payload.list_id, personId },
        'Failed to fire the list_joined automation trigger for a contact',
      );
    }
  }
}
