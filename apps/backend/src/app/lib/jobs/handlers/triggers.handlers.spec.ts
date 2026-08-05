import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { JobPayloadOf } from '../job-payloads';
import { handleTriggerContactCreated, handleTriggerTagAdded } from './triggers.handlers';

/**
 * Both handlers unpack an import-enqueued payload and call the workflows controller once per
 * item, each in its own try/catch (see the handler file's doc comments): a bug in one person's
 * trigger evaluation must not stop the rest of the batch, and the loop must not throw back into
 * the job worker. The controller is imported dynamically inside the handler
 * (`await import('../../../modules/workflows/controller')`), so the whole module is mocked here
 * rather than spying on an instance -- `vi.mock` (hoisted above every import by the Vitest
 * transform, regardless of where it's written) intercepts that dynamic import too.
 */
const triggerWorkflowMock = vi.fn().mockResolvedValue(undefined);
const triggerTagAddedMock = vi.fn().mockResolvedValue(undefined);

vi.mock('../../../modules/workflows/controller', () => ({
  // A class (not an arrow function) so `new WorkflowsController()` in the handler works --
  // the production code constructs an instance, and a mocked-with-an-arrow-function factory is
  // not a constructor.
  WorkflowsController: class {
    triggerWorkflow = triggerWorkflowMock;
    triggerTagAdded = triggerTagAddedMock;
  },
}));

describe('handleTriggerContactCreated', () => {
  beforeEach(() => {
    triggerWorkflowMock.mockReset().mockResolvedValue(undefined);
  });

  it('calls triggerWorkflow once per person id with the contact_created trigger', async () => {
    const payload: JobPayloadOf<'trigger_contact_created'> = {
      type: 'trigger_contact_created',
      tenant_id: 't1',
      person_ids: ['p1', 'p2', 'p3'],
    };

    await handleTriggerContactCreated(payload);

    expect(triggerWorkflowMock).toHaveBeenCalledTimes(3);
    expect(triggerWorkflowMock).toHaveBeenNthCalledWith(1, 't1', 'p1', 'contact_created', null);
    expect(triggerWorkflowMock).toHaveBeenNthCalledWith(2, 't1', 'p2', 'contact_created', null);
    expect(triggerWorkflowMock).toHaveBeenNthCalledWith(3, 't1', 'p3', 'contact_created', null);
  });

  it('keeps evaluating later people when an earlier trigger call throws, and does not throw itself', async () => {
    triggerWorkflowMock
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(undefined);
    const payload: JobPayloadOf<'trigger_contact_created'> = {
      type: 'trigger_contact_created',
      tenant_id: 't1',
      person_ids: ['p1', 'p2', 'p3'],
    };

    await expect(handleTriggerContactCreated(payload)).resolves.toBeUndefined();

    expect(triggerWorkflowMock).toHaveBeenCalledTimes(3);
    expect(triggerWorkflowMock).toHaveBeenNthCalledWith(3, 't1', 'p3', 'contact_created', null);
  });

  it('is a clean no-op on an empty person_ids list', async () => {
    const payload: JobPayloadOf<'trigger_contact_created'> = {
      type: 'trigger_contact_created',
      tenant_id: 't1',
      person_ids: [],
    };

    await handleTriggerContactCreated(payload);

    expect(triggerWorkflowMock).not.toHaveBeenCalled();
  });
});

describe('handleTriggerTagAdded', () => {
  beforeEach(() => {
    triggerTagAddedMock.mockReset().mockResolvedValue(undefined);
  });

  it('passes each (person, tag) pair through to triggerTagAdded correctly', async () => {
    const payload: JobPayloadOf<'trigger_tag_added'> = {
      type: 'trigger_tag_added',
      tenant_id: 't1',
      pairs: [
        { person_id: 'p1', tag_id: 'tag-a', tag_name: 'Volunteer' },
        { person_id: 'p2', tag_id: 'tag-b', tag_name: 'Donor' },
      ],
    };

    await handleTriggerTagAdded(payload);

    expect(triggerTagAddedMock).toHaveBeenCalledTimes(2);
    expect(triggerTagAddedMock).toHaveBeenNthCalledWith(1, 't1', 'p1', 'tag-a', 'Volunteer');
    expect(triggerTagAddedMock).toHaveBeenNthCalledWith(2, 't1', 'p2', 'tag-b', 'Donor');
  });

  it('keeps evaluating later pairs when an earlier trigger call throws, and does not throw itself', async () => {
    triggerTagAddedMock.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(undefined);
    const payload: JobPayloadOf<'trigger_tag_added'> = {
      type: 'trigger_tag_added',
      tenant_id: 't1',
      pairs: [
        { person_id: 'p1', tag_id: 'tag-a', tag_name: 'Volunteer' },
        { person_id: 'p2', tag_id: 'tag-b', tag_name: 'Donor' },
      ],
    };

    await expect(handleTriggerTagAdded(payload)).resolves.toBeUndefined();

    expect(triggerTagAddedMock).toHaveBeenCalledTimes(2);
    expect(triggerTagAddedMock).toHaveBeenNthCalledWith(2, 't1', 'p2', 'tag-b', 'Donor');
  });

  it('is a clean no-op on an empty pairs list', async () => {
    const payload: JobPayloadOf<'trigger_tag_added'> = {
      type: 'trigger_tag_added',
      tenant_id: 't1',
      pairs: [],
    };

    await handleTriggerTagAdded(payload);

    expect(triggerTagAddedMock).not.toHaveBeenCalled();
  });
});
