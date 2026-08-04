import type { KyselyPlugin, PluginTransformQueryArgs, PluginTransformResultArgs, Transaction } from 'kysely';
import { describe, expect, it, vi } from 'vitest';

import { MAX_PAGE_SIZE } from '../../../../../libs/common/src';
import type { Models } from '../../../../../libs/common/src/lib/kysely.models';
import { DeliveryRequestsRepo } from '../modules/deliveries/repositories/delivery-requests.repo';
import { DonationsRepo } from '../modules/donations/repositories/donations.repo';
import { EventsRepo } from '../modules/events/repositories/events.repo';
import { ListsRepo } from '../modules/lists/repositories/lists.repo';
import { NewslettersRepo } from '../modules/newsletters/repositories/newsletters.repo';
import { PersonsRepo } from '../modules/persons/repositories/persons.repo';
import { TagsRepo } from '../modules/tags/repositories/tags.repo';
import { TeamsRepo } from '../modules/teams/repositories/teams.repo';
import { VolunteerEventsRepo } from '../modules/volunteer-events/repositories/volunteer-events.repo';
import { WebFormsRepo } from '../modules/web-forms/repositories/web-forms.repo';
import { WorkflowsRepo } from '../modules/workflows/repositories/workflows.repo';
import { UserActivityRepo } from './user-activity.repo';
import { useTestTransaction } from './test-utils/db-test-isolation';

/**
 * These specs assert on the SQL each repository builds, not on the rows it returns.
 *
 * The defect they cover is that `startRow` and `endRow` were bounded individually while their
 * DIFFERENCE became the SQL `LIMIT`, so `{ startRow: 0, endRow: 10_000_000 }` produced
 * `LIMIT 10000000`. Proving that by counting rows would need a tenant holding more than
 * MAX_PAGE_SIZE (5000) rows, which is far too slow to seed per test. Reading the emitted LIMIT
 * proves the same thing directly and runs against an empty tenant in milliseconds.
 */

/** Records the LIMIT and OFFSET of every SELECT executed through the wrapped connection. */
class PagingSpy implements KyselyPlugin {
  private readonly limits: (number | null)[] = [];
  private readonly rawOffsets: (number | null)[] = [];

  public transformQuery(args: PluginTransformQueryArgs) {
    const node = args.node as {
      kind?: string;
      limit?: { limit?: unknown };
      offset?: { offset?: unknown };
    };
    if (node?.kind === 'SelectQueryNode') {
      this.limits.push(readValue(node.limit?.limit));
      this.rawOffsets.push(readValue(node.offset?.offset));
    }
    return args.node;
  }

  public async transformResult(args: PluginTransformResultArgs) {
    return args.result;
  }

  /** LIMIT values from the SELECTs that carried one. Count queries carry none and drop out. */
  public get appliedLimits(): number[] {
    return this.limits.filter((l): l is number => typeof l === 'number');
  }

  public get appliedOffsets(): number[] {
    return this.rawOffsets.filter((o): o is number => typeof o === 'number');
  }

  /**
   * The LIMIT of the last SELECT executed, which is the paged data query in every method here.
   * Some methods run a bounded preflight lookup first (persons resolves the campaign's boundary
   * set with a LIMIT 1), so the first LIMIT seen is not always the one under test.
   */
  public get dataLimit(): number | undefined {
    return this.appliedLimits.at(-1);
  }
}

function readValue(node: unknown): number | null {
  if (node && typeof node === 'object' && (node as { kind?: string }).kind === 'ValueNode') {
    const value = (node as { value?: unknown }).value;
    if (typeof value === 'number') return value;
  }
  return null;
}

/** A tenant id no test database holds, so every query below returns zero rows. */
const EMPTY_TENANT = '999000111222';

describe('list paging is bounded in every repository that derives a LIMIT', () => {
  const ctx = useTestTransaction();

  function spied(): { spy: PagingSpy; trx: Transaction<Models> } {
    const spy = new PagingSpy();
    return { spy, trx: ctx.trx.withPlugin(spy) };
  }

  /**
   * A few repository methods take no transaction argument and build from BaseRepository's shared
   * connection, so a plugin installed on a transaction never sees them. Redirecting the repo's
   * own `getSelect` to the wrapped transaction routes those queries through the spy without
   * altering the paging code under test. `getSelect` is protected, hence the cast — specs are the
   * one place this repo allows `any`.
   */
  function routeThroughSpy(repo: object, trx: Transaction<Models>, table: keyof Models): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.spyOn(repo as any, 'getSelect').mockImplementation(() => trx.selectFrom(table));
  }

  describe('a span wider than one page is truncated to MAX_PAGE_SIZE', () => {
    const OVERSIZED = { startRow: 0, endRow: 10_000_000 };

    it('persons.getAllWithAddress', async () => {
      const { spy, trx } = spied();
      await new PersonsRepo().getAllWithAddress({ tenant_id: EMPTY_TENANT, options: OVERSIZED }, trx);
      expect(spy.dataLimit).toBe(MAX_PAGE_SIZE);
    });

    it('teams.getAllWithCounts', async () => {
      const { spy, trx } = spied();
      await new TeamsRepo().getAllWithCounts({ tenant_id: EMPTY_TENANT, options: OVERSIZED }, trx);
      expect(spy.dataLimit).toBe(MAX_PAGE_SIZE);
    });

    it('tags.getAllWithCounts', async () => {
      const { spy, trx } = spied();
      await new TagsRepo().getAllWithCounts({ tenant_id: EMPTY_TENANT, options: OVERSIZED }, trx);
      expect(spy.dataLimit).toBe(MAX_PAGE_SIZE);
    });

    it('lists.getAllWithCounts', async () => {
      const { spy, trx } = spied();
      await new ListsRepo().getAllWithCounts({ tenant_id: EMPTY_TENANT, options: OVERSIZED }, trx);
      expect(spy.dataLimit).toBe(MAX_PAGE_SIZE);
    });

    it('workflows.getAllWithCounts', async () => {
      const { spy, trx } = spied();
      await new WorkflowsRepo().getAllWithCounts({ tenant_id: EMPTY_TENANT, options: OVERSIZED }, trx);
      expect(spy.dataLimit).toBe(MAX_PAGE_SIZE);
    });

    it('web-forms.getAllWithCounts', async () => {
      const { spy, trx } = spied();
      await new WebFormsRepo().getAllWithCounts({ tenant_id: EMPTY_TENANT, options: OVERSIZED }, trx);
      expect(spy.dataLimit).toBe(MAX_PAGE_SIZE);
    });

    it('delivery-requests.getAllWithCounts', async () => {
      const { spy, trx } = spied();
      await new DeliveryRequestsRepo().getAllWithCounts({ tenant_id: EMPTY_TENANT, options: OVERSIZED }, trx);
      expect(spy.dataLimit).toBe(MAX_PAGE_SIZE);
    });

    it('donations.getAllWithCounts (the gifts grid)', async () => {
      const { spy, trx } = spied();
      await new DonationsRepo().getAllWithCounts({ tenant_id: EMPTY_TENANT, options: OVERSIZED }, trx);
      expect(spy.dataLimit).toBe(MAX_PAGE_SIZE);
    });

    it('events.getAllEventsWithCount', async () => {
      const { spy, trx } = spied();
      await new EventsRepo().getAllEventsWithCount({ tenant_id: EMPTY_TENANT, options: OVERSIZED }, trx);
      expect(spy.dataLimit).toBe(MAX_PAGE_SIZE);
    });

    it('volunteer-events.getAllEventsWithCount', async () => {
      const { spy, trx } = spied();
      await new VolunteerEventsRepo().getAllEventsWithCount({ tenant_id: EMPTY_TENANT, options: OVERSIZED }, trx);
      expect(spy.dataLimit).toBe(MAX_PAGE_SIZE);
    });

    it('newsletters.getAllWithCount', async () => {
      const { spy, trx } = spied();
      const repo = new NewslettersRepo();
      routeThroughSpy(repo, trx, 'newsletters');
      await repo.getAllWithCount(EMPTY_TENANT, OVERSIZED);
      expect(spy.dataLimit).toBe(MAX_PAGE_SIZE);
    });

    it('user-activity.getForEntity', async () => {
      const { spy, trx } = spied();
      const repo = new UserActivityRepo();
      routeThroughSpy(repo, trx, 'user_activity');
      await repo.getForEntity(EMPTY_TENANT, 'persons', '1', OVERSIZED);
      expect(spy.dataLimit).toBe(MAX_PAGE_SIZE);
    });

    it('user-activity.getAllWithUser', async () => {
      const { spy, trx } = spied();
      const repo = new UserActivityRepo();
      routeThroughSpy(repo, trx, 'user_activity');
      await repo.getAllWithUser(EMPTY_TENANT, OVERSIZED);
      expect(spy.dataLimit).toBe(MAX_PAGE_SIZE);
    });
  });

  describe('a request with no paging fields at all still emits a LIMIT', () => {
    // persons, events and volunteer-events used to guard offset/limit with
    // `$if(typeof startRow === 'number' && typeof endRow === 'number')`, and newsletters only
    // applied a limit when one could be derived — so an empty request emitted no LIMIT clause at
    // all and read the whole table.

    it('persons.getAllWithAddress', async () => {
      const { spy, trx } = spied();
      await new PersonsRepo().getAllWithAddress({ tenant_id: EMPTY_TENANT }, trx);
      expect(spy.dataLimit).toBe(MAX_PAGE_SIZE);
    });

    it('events.getAllEventsWithCount', async () => {
      const { spy, trx } = spied();
      await new EventsRepo().getAllEventsWithCount({ tenant_id: EMPTY_TENANT }, trx);
      expect(spy.dataLimit).toBe(MAX_PAGE_SIZE);
    });

    it('volunteer-events.getAllEventsWithCount', async () => {
      const { spy, trx } = spied();
      await new VolunteerEventsRepo().getAllEventsWithCount({ tenant_id: EMPTY_TENANT }, trx);
      expect(spy.dataLimit).toBe(MAX_PAGE_SIZE);
    });

    it('newsletters.getAllWithCount', async () => {
      const { spy, trx } = spied();
      const repo = new NewslettersRepo();
      routeThroughSpy(repo, trx, 'newsletters');
      await repo.getAllWithCount(EMPTY_TENANT);
      expect(spy.dataLimit).toBe(MAX_PAGE_SIZE);
    });

    it('user-activity.getForEntity', async () => {
      const { spy, trx } = spied();
      const repo = new UserActivityRepo();
      routeThroughSpy(repo, trx, 'user_activity');
      await repo.getForEntity(EMPTY_TENANT, 'persons', '1');
      expect(spy.dataLimit).toBe(100);
    });

    it('user-activity.getAllWithUser', async () => {
      const { spy, trx } = spied();
      const repo = new UserActivityRepo();
      routeThroughSpy(repo, trx, 'user_activity');
      await repo.getAllWithUser(EMPTY_TENANT, {});
      expect(spy.dataLimit).toBe(100);
    });
  });

  describe('an ordinary page-sized request is untouched', () => {
    const ONE_PAGE = { startRow: 50, endRow: 75 };

    it('persons.getAllWithAddress asks for exactly the 25 rows requested', async () => {
      const { spy, trx } = spied();
      await new PersonsRepo().getAllWithAddress({ tenant_id: EMPTY_TENANT, options: ONE_PAGE }, trx);
      expect(spy.dataLimit).toBe(25);
      expect(spy.appliedOffsets).toContain(50);
    });

    it('teams.getAllWithCounts asks for exactly the 25 rows requested', async () => {
      const { spy, trx } = spied();
      await new TeamsRepo().getAllWithCounts({ tenant_id: EMPTY_TENANT, options: ONE_PAGE }, trx);
      expect(spy.dataLimit).toBe(25);
      expect(spy.appliedOffsets).toContain(50);
    });

    it('donations.getAllWithCounts asks for exactly the 25 rows requested', async () => {
      const { spy, trx } = spied();
      await new DonationsRepo().getAllWithCounts({ tenant_id: EMPTY_TENANT, options: ONE_PAGE }, trx);
      expect(spy.dataLimit).toBe(25);
    });

    it('the list member-count path still asks for zero rows', async () => {
      // lists/controller.ts getMemberCount sends { startRow: 0, endRow: 0 } and reads only `count`.
      const { spy, trx } = spied();
      await new PersonsRepo().getAllWithAddress({ tenant_id: EMPTY_TENANT, options: { startRow: 0, endRow: 0 } }, trx);
      expect(spy.dataLimit).toBe(0);
    });
  });

  describe('BaseRepository.getAll, the generic path every simple list uses', () => {
    it('truncates an oversized span to MAX_PAGE_SIZE', async () => {
      const { spy, trx } = spied();
      await new TeamsRepo().getAll({ tenant_id: EMPTY_TENANT, options: { startRow: 0, endRow: 10_000_000 } }, trx);
      expect(spy.dataLimit).toBe(MAX_PAGE_SIZE);
    });

    it('leaves a normal page alone', async () => {
      const { spy, trx } = spied();
      await new TeamsRepo().getAll({ tenant_id: EMPTY_TENANT, options: { startRow: 0, endRow: 25 } }, trx);
      expect(spy.dataLimit).toBe(25);
    });

    it('applies MAX_PAGE_SIZE when no paging is supplied', async () => {
      const { spy, trx } = spied();
      await new TeamsRepo().getAll({ tenant_id: EMPTY_TENANT }, trx);
      expect(spy.dataLimit).toBe(MAX_PAGE_SIZE);
    });
  });
});
