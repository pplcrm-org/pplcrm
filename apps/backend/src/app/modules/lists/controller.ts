import type {
  AddListType,
  IAuthKeyPayload,
  UpdateListType,
  getAllOptionsType,
} from '../../../../../../libs/common/src';
import { getAllOptions } from '../../../../../../libs/common/src';
import { TRPCError } from '@trpc/server';

import { BaseController } from '../../lib/base.controller';
import { CampaignsRepo } from '../campaigns/repositories/campaigns.repo';
import { HouseholdsController } from '../households/controller';
import { PersonsController } from '../persons/controller';
import { ListsRepo } from './repositories/lists.repo';
import { MapListsHouseholdsRepo } from './repositories/map-lists-households.repo';
import { MapListsPersonsRepo } from './repositories/map-lists-persons.repo';
import { ensureSystemLists, queueSystemListRefreshes } from './system-lists';
import type { OperationDataType } from '../../../../../../libs/common/src/lib/kysely.models';
import { WorkflowsController } from '../workflows/controller';
import { logger } from '../../logger';

/**
 * The live membership of a list at the moment of the call.
 *
 * - Smart lists (`is_dynamic = true`) re-run their stored `definition` against
 *   the tenant's people/households and return whoever matches *right now*.
 * - Static lists read the fixed snapshot saved in `map_lists_persons` /
 *   `map_lists_households` at creation time.
 *
 * Exported for downstream consumers that need "who is in this list today":
 * canvassing turf cutting (§13, universe = a smart list), automations
 * (§16, List-joined trigger), and CSV import add-to-static-list (§17).
 */
export interface ListCurrentMembers {
  object: 'people' | 'households';
  ids: string[];
  count: number;
}

/** One thing that references a list (drives "LAST USED IN" and delete confirms). */
export interface ListConsumer {
  id: string;
  name: string;
  kind: 'newsletter' | 'form' | 'team';
}

/** Everything that references a list, grouped by kind. `total` is the flat count. */
export interface ListConsumers {
  newsletters: ListConsumer[];
  forms: ListConsumer[];
  teams: ListConsumer[];
  total: number;
}

/** The subset of a list row this module reasons about (narrowed from the DB row). */
interface ListShape {
  id: string;
  object: 'people' | 'households';
  is_dynamic: boolean;
  definition: getAllOptionsType | null;
  campaign_id: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Narrow a raw list row (or the resolved controller shape) to the fields this
 * module needs, parsing the stored JSONB `definition` through its Zod schema
 * rather than casting it — so a malformed definition surfaces as `null`, not a
 * runtime blow-up deeper in the query pipeline.
 */
function toListShape(row: unknown): ListShape | null {
  if (!isRecord(row)) return null;
  const object = row['object'];
  if (object !== 'people' && object !== 'households') return null;
  const parsed = getAllOptions.safeParse(row['definition'] ?? undefined);
  const campaignId = row['campaign_id'];
  return {
    id: String(row['id']),
    object,
    is_dynamic: row['is_dynamic'] === true,
    definition: parsed.success ? (parsed.data ?? null) : null,
    campaign_id: campaignId == null ? null : String(campaignId),
  };
}

/**
 * Run a list's rules in the campaign context the list belongs to (§15).
 *
 * Rules can reach campaign-scoped facts — subscription status, support level,
 * voting status — and those joins resolve against `options.campaignId`. Without
 * this the built-in "All Subscribers" list (and any user rule on a
 * campaign-scoped field) would silently match nothing, because the repo falls
 * back to campaign '0'. A definition that already carries a campaignId keeps it.
 */
function scopedDefinition(definition: getAllOptionsType, campaign_id: string | null | undefined): getAllOptionsType {
  if (!campaign_id) return definition;
  return { ...(definition ?? {}), campaignId: (definition ?? {})?.campaignId ?? String(campaign_id) };
}

export class ListsController extends BaseController<'lists', ListsRepo> {
  private campaignsRepo = new CampaignsRepo();
  private householdsController = new HouseholdsController();
  private mapListsHouseholdsRepo = new MapListsHouseholdsRepo();
  private mapListsPersonsRepo = new MapListsPersonsRepo();
  private personsController = new PersonsController();

  constructor() {
    super(new ListsRepo());
  }

  /**
   * The Lists read path. Creates any missing built-in lists for the context
   * being read first (§8) — that is what guarantees "All Subscribers" and "All
   * Volunteers" are there for tenants that predate the feature, for campaigns
   * created later, and after a tenant exits demo mode. It is a no-op insert on
   * every call after the first.
   *
   * A failure to seed must not blank the page, so it is logged and swallowed;
   * the user's own lists still load.
   */
  public async getAllForContext(auth: IAuthKeyPayload, options?: getAllOptionsType) {
    try {
      // Archived campaigns are read-only history (§15) — resolveForWrite would
      // reject them, so skip seeding rather than log a failure on every read.
      const campaign_id = await this.resolveSeedableCampaign(auth.tenant_id, options?.campaignId);
      if (campaign_id) {
        const inserted = await ensureSystemLists({ tenant_id: auth.tenant_id, campaign_id, user_id: auth.user_id });
        if (inserted > 0) {
          await queueSystemListRefreshes({ tenant_id: auth.tenant_id, campaign_id, user_id: auth.user_id });
        }
      }
    } catch (err) {
      logger.error({ err }, 'Failed to ensure the built-in lists exist');
    }
    return this.getAllWithCounts(auth.tenant_id, options);
  }

  /** The active (non-archived) campaign to seed built-ins into, or null. */
  private async resolveSeedableCampaign(tenant_id: string, campaign_id?: string): Promise<string | null> {
    const row = await this.getRepo()
      .db.selectFrom('campaigns')
      .select(['id', 'status'])
      .where('tenant_id', '=', tenant_id)
      .$if(!!campaign_id, (qb) => qb.where('id', '=', campaign_id as string))
      .$if(!campaign_id, (qb) => qb.where('kind', '=', 'office'))
      .executeTakeFirst();
    if (!row || row.status === 'archived') return null;
    return String(row.id);
  }

  public async addList(payload: AddListType, auth: IAuthKeyPayload) {
    // Enforce unique list names per tenant. This check is the friendly path; two concurrent
    // creates can both pass it, so uq_lists_tenant_campaign_name is the real guarantee and the
    // 23505 below turns the loser of that race into the same CONFLICT rather than a 500.
    const existing = await this.getRepo().getOneBy('name', {
      tenant_id: auth.tenant_id,
      value: payload.name,
    });
    if (existing) throw new TRPCError({ code: 'CONFLICT', message: 'A list with this name already exists.' });

    const row = {
      name: payload.name,
      description: payload.description,
      object: payload.object,
      is_dynamic: payload.is_dynamic ?? false,
      definition: payload.definition ?? null,
      tenant_id: auth.tenant_id,
      // The context this segment belongs to (§15); defaults to the office.
      campaign_id: await this.campaignsRepo.resolveForWrite({
        tenant_id: auth.tenant_id,
        campaign_id: payload.campaign_id,
      }),
      createdby_id: auth.user_id,
      updatedby_id: auth.user_id,
      status: (payload.is_dynamic ?? false) ? 'refreshing' : 'idle',
    };

    let list: Awaited<ReturnType<typeof this.add>>;
    try {
      list = await this.add(row as OperationDataType<'lists', 'insert'>);
    } catch (err) {
      if ((err as { code?: string })?.code === '23505') {
        throw new TRPCError({ code: 'CONFLICT', message: 'A list with this name already exists.' });
      }
      throw err;
    }

    // For dynamic lists, trigger an immediate initial refresh via background job
    if (row.is_dynamic) {
      await this.getRepo()
        .db.insertInto('background_jobs')
        .values({
          tenant_id: auth.tenant_id,
          queue: 'default',
          status: 'pending',
          payload: JSON.stringify({
            type: 'refresh_list',
            list_id: list.id,
            tenant_id: auth.tenant_id,
            user_id: auth.user_id,
          }),
          run_at: new Date(),
        })
        .execute();
    } else {
      // For static lists, populate membership by explicit IDs if provided; otherwise by definition
      const ids = payload.member_ids ?? [];

      if (ids.length && payload.object === 'people') {
        const rows = ids.map((person_id) => ({
          tenant_id: auth.tenant_id,
          list_id: list.id,
          person_id,
          createdby_id: auth.user_id,
          updatedby_id: auth.user_id,
        }));
        await this.mapListsPersonsRepo.addMany({ rows: rows as OperationDataType<'map_lists_persons', 'insert'>[] });
        try {
          const workflowsController = new WorkflowsController();
          for (const person_id of ids) {
            await workflowsController.triggerWorkflow(auth.tenant_id, person_id, 'list_joined', list.id);
          }
        } catch (err) {
          logger.error({ err }, 'Failed to trigger list_joined workflow in addList (explicit IDs)');
        }
      } else if (ids.length && payload.object === 'households') {
        const rows = ids.map((household_id) => ({
          tenant_id: auth.tenant_id,
          list_id: list.id,
          household_id,
          createdby_id: auth.user_id,
          updatedby_id: auth.user_id,
        }));
        await this.mapListsHouseholdsRepo.addMany({
          rows: rows as OperationDataType<'map_lists_households', 'insert'>[],
        });
      } else if (payload.definition) {
        const definition = scopedDefinition(payload.definition as getAllOptionsType, row.campaign_id);
        if (payload.object === 'people') {
          const result = await this.personsController.getAllWithAddress(auth, definition);
          const rows = result.rows.map((p) => ({
            tenant_id: auth.tenant_id,
            list_id: list.id,
            person_id: String(p['id']),
            createdby_id: auth.user_id,
            updatedby_id: auth.user_id,
          }));
          if (rows.length) {
            await this.mapListsPersonsRepo.addMany({
              rows: rows as OperationDataType<'map_lists_persons', 'insert'>[],
            });
            try {
              const workflowsController = new WorkflowsController();
              for (const r of rows) {
                await workflowsController.triggerWorkflow(auth.tenant_id, r.person_id, 'list_joined', list.id);
              }
            } catch (err) {
              logger.error({ err }, 'Failed to trigger list_joined workflow in addList (definition)');
            }
          }
        } else if (payload.object === 'households') {
          const result = await this.householdsController.getAllWithPeopleCount(auth, definition);
          const rows = result.rows.map((h) => ({
            tenant_id: auth.tenant_id,
            list_id: list.id,
            household_id: h['id'],
            createdby_id: auth.user_id,
            updatedby_id: auth.user_id,
          }));
          if (rows.length) {
            await this.mapListsHouseholdsRepo.addMany({
              rows: rows as OperationDataType<'map_lists_households', 'insert'>[],
            });
          }
        }
      }
    }

    return list;
  }

  public async refreshList(auth: IAuthKeyPayload, id: string): Promise<any> {
    const list = (await super.getOneById({ tenant_id: auth.tenant_id, id })) as any;
    if (!list) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'List not found' });
    }
    if (!list.is_dynamic) {
      return list;
    }

    // Set list status to refreshing
    await this.update({
      tenant_id: auth.tenant_id,
      id,
      row: {
        status: 'refreshing',
        updatedby_id: auth.user_id,
        updated_at: new Date(),
      },
    });

    // Queue background job
    await this.getRepo()
      .db.insertInto('background_jobs')
      .values({
        tenant_id: auth.tenant_id,
        queue: 'default',
        status: 'pending',
        payload: JSON.stringify({
          type: 'refresh_list',
          list_id: id,
          tenant_id: auth.tenant_id,
          user_id: auth.user_id,
        }),
        run_at: new Date(),
      })
      .execute();

    return { ...list, status: 'refreshing' };
  }

  public async executeListRefresh(tenant_id: string, id: string, user_id: string): Promise<any> {
    const auth: IAuthKeyPayload = {
      tenant_id,
      user_id,
      name: 'System Worker',
      session_id: 'worker-session',
    };

    const list = (await this.getOneById({ tenant_id, id })) as any;
    if (!list) {
      throw new Error(`List ${id} not found`);
    }
    if (!list.is_dynamic) {
      return list;
    }

    const definition = scopedDefinition(list.definition as getAllOptionsType, list.campaign_id);
    if (!definition) {
      // Set back to idle if no definition
      await this.update({
        tenant_id,
        id,
        row: {
          status: 'idle',
          updated_at: new Date(),
          updatedby_id: user_id,
        },
      });
      return list;
    }

    try {
      if (list.object === 'people') {
        // Clear current mappings
        await this.mapListsPersonsRepo.db
          .deleteFrom('map_lists_persons')
          .where('tenant_id', '=', tenant_id)
          .where('list_id', '=', id)
          .execute();

        // Resolve and insert new mappings
        const result = await this.personsController.getAllWithAddress(auth, definition);
        const rows = result.rows.map((p) => ({
          tenant_id: tenant_id,
          list_id: list.id,
          person_id: p['id'],
          createdby_id: user_id,
          updatedby_id: user_id,
        }));
        if (rows.length) {
          await this.mapListsPersonsRepo.addMany({
            rows: rows as OperationDataType<'map_lists_persons', 'insert'>[],
          });
        }
      } else if (list.object === 'households') {
        // Clear current mappings
        await this.mapListsHouseholdsRepo.db
          .deleteFrom('map_lists_households')
          .where('tenant_id', '=', tenant_id)
          .where('list_id', '=', id)
          .execute();

        // Resolve and insert new mappings
        const result = await this.householdsController.getAllWithPeopleCount(auth, definition);
        const rows = result.rows.map((h) => ({
          tenant_id: tenant_id,
          list_id: list.id,
          household_id: h['id'],
          createdby_id: user_id,
          updatedby_id: user_id,
        }));
        if (rows.length) {
          await this.mapListsHouseholdsRepo.addMany({
            rows: rows as OperationDataType<'map_lists_households', 'insert'>[],
          });
        }
      }

      // Update refreshed timestamp and status back to idle
      const updated = await this.update({
        tenant_id,
        id,
        row: {
          status: 'idle',
          last_refreshed_at: new Date(),
          updated_at: new Date(),
          updatedby_id: user_id,
        },
      });

      return updated;
    } catch (error) {
      // Set status to failed
      await this.update({
        tenant_id,
        id,
        row: {
          status: 'failed',
          updated_at: new Date(),
          updatedby_id: user_id,
        },
      });
      throw error;
    }
  }

  public async getListStats(auth: IAuthKeyPayload, id: string): Promise<any> {
    const list = (await this.getOneById({ tenant_id: auth.tenant_id, id })) as any;
    if (!list) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'List not found' });
    }

    // Sent newsletters that targeted this list — an indexed join on
    // map_newsletters_lists (FK-backed), instead of the old fetch-everything
    // JS filter over the legacy JSONB target_lists document.
    const targetedNewsletters = await this.getRepo()
      .db.selectFrom('newsletters')
      .innerJoin('map_newsletters_lists', 'map_newsletters_lists.newsletter_id', 'newsletters.id')
      .selectAll('newsletters')
      .where('newsletters.tenant_id', '=', auth.tenant_id)
      .where('newsletters.status', '=', 'sent')
      .where('map_newsletters_lists.tenant_id', '=', auth.tenant_id)
      .where('map_newsletters_lists.list_id', '=', id)
      .where('map_newsletters_lists.mode', '=', 'include')
      .execute();

    // Compute aggregated metrics
    const totalNewsletters = targetedNewsletters.length;
    let totalDelivered = 0;
    let totalOpens = 0;
    let totalClicks = 0;

    for (const n of targetedNewsletters) {
      totalDelivered += Number(n.delivered_count ?? 0);
      totalOpens += Number(n.unique_opens ?? 0);
      totalClicks += Number(n.unique_clicks ?? 0);
    }

    const avgOpenRate = totalDelivered > 0 ? (totalOpens / totalDelivered) * 100 : 0;
    const avgClickRate = totalDelivered > 0 ? (totalClicks / totalDelivered) * 100 : 0;

    return {
      totalNewsletters,
      totalDelivered,
      avgOpenRate,
      avgClickRate,
      newsletters: targetedNewsletters.map((n) => ({
        id: n.id,
        name: n.name,
        subject: n.subject,
        send_date: n.send_date,
        total_recipients: n.total_recipients,
        delivered_count: n.delivered_count,
        open_rate: n.open_rate,
        click_rate: n.click_rate,
      })),
    };
  }

  public getHouseholdsByListId(auth: IAuthKeyPayload, list_id: string) {
    return this.getRepo().getHouseholdsByListId({ tenant_id: auth.tenant_id, list_id });
  }

  public getPersonsByListId(auth: IAuthKeyPayload, list_id: string) {
    return this.getRepo().getPersonsByListId({ tenant_id: auth.tenant_id, list_id });
  }

  public async getMemberCount(auth: IAuthKeyPayload, id: string): Promise<number> {
    const list = (await this.getOneById({ tenant_id: auth.tenant_id, id })) as any;
    if (!list) return 0;
    if (list.is_dynamic && list.definition) {
      const opts = {
        ...scopedDefinition(list.definition as getAllOptionsType, list.campaign_id),
        startRow: 0,
        endRow: 0,
      };
      if (list.object === 'people') {
        const data = await this.personsController.getAllWithAddress(auth, opts);
        return data.count;
      } else {
        const data = await this.householdsController.getAllWithPeopleCount(auth, opts);
        return data.count;
      }
    } else {
      if (list.object === 'people') {
        const result = await this.mapListsPersonsRepo.db
          .selectFrom('map_lists_persons')
          .select(({ fn }) => fn.countAll().as('count'))
          .where('tenant_id', '=', auth.tenant_id)
          .where('list_id', '=', id)
          .executeTakeFirst();
        return Number(result?.count ?? 0);
      } else {
        const result = await this.mapListsHouseholdsRepo.db
          .selectFrom('map_lists_households')
          .select(({ fn }) => fn.countAll().as('count'))
          .where('tenant_id', '=', auth.tenant_id)
          .where('list_id', '=', id)
          .executeTakeFirst();
        return Number(result?.count ?? 0);
      }
    }
  }

  /**
   * The live membership of a list, resolved the way §8 defines each type:
   * smart lists re-run their stored definition; static lists read the saved
   * snapshot. Reusable by turf cutting (§13), automations (§16) and CSV import
   * (§17) — anything that needs "who is in this list today".
   */
  public async getCurrentMembers(auth: IAuthKeyPayload, id: string): Promise<ListCurrentMembers> {
    const raw = await this.getOneById({ tenant_id: auth.tenant_id, id });
    const list = toListShape(raw);
    if (!list) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'List not found' });
    }

    // Smart list: re-run the definition against live data.
    if (list.is_dynamic && list.definition) {
      const definition = scopedDefinition(list.definition, list.campaign_id);
      if (list.object === 'people') {
        const data = await this.personsController.getAllWithAddress(auth, definition);
        const ids = data.rows.map((r) => String(r['id']));
        return { object: 'people', ids, count: data.count };
      }
      const data = await this.householdsController.getAllWithPeopleCount(auth, definition);
      const ids = data.rows.map((r) => String(r['id']));
      return { object: 'households', ids, count: data.count };
    }

    // Static list (or smart with no definition): read the saved snapshot.
    if (list.object === 'people') {
      const rows = await this.mapListsPersonsRepo.db
        .selectFrom('map_lists_persons')
        .select('person_id')
        .where('tenant_id', '=', auth.tenant_id)
        .where('list_id', '=', id)
        .execute();
      const ids = rows.map((r) => String(r.person_id));
      return { object: 'people', ids, count: ids.length };
    }
    const rows = await this.mapListsHouseholdsRepo.db
      .selectFrom('map_lists_households')
      .select('household_id')
      .where('tenant_id', '=', auth.tenant_id)
      .where('list_id', '=', id)
      .execute();
    const ids = rows.map((r) => String(r.household_id));
    return { object: 'households', ids, count: ids.length };
  }

  /**
   * Everything that references a list — newsletters, forms and teams/turfs.
   * Drives the "LAST USED IN" column and the delete-confirm body, which must
   * name a list's consumers before it can be removed (§8).
   */
  public async getConsumers(auth: IAuthKeyPayload, id: string): Promise<ListConsumers> {
    const tenant_id = auth.tenant_id;

    // Newsletters, forms and teams each link to lists through their own
    // FK-backed junction table (the source of truth after the schema
    // remediation). Every arm is tenant-scoped on the junction row.
    const newsletterRows = await this.getRepo()
      .db.selectFrom('newsletters')
      .innerJoin('map_newsletters_lists', 'map_newsletters_lists.newsletter_id', 'newsletters.id')
      .select(['newsletters.id as id', 'newsletters.name as name'])
      .where('map_newsletters_lists.tenant_id', '=', tenant_id)
      .where('map_newsletters_lists.list_id', '=', id)
      .execute();

    const formRows = await this.getRepo()
      .db.selectFrom('web_forms')
      .innerJoin('map_web_forms_lists', 'map_web_forms_lists.web_form_id', 'web_forms.id')
      .select(['web_forms.id as id', 'web_forms.name as name'])
      .where('map_web_forms_lists.tenant_id', '=', tenant_id)
      .where('map_web_forms_lists.list_id', '=', id)
      .execute();

    const teamRows = await this.getRepo()
      .db.selectFrom('teams')
      .innerJoin('map_teams_lists', 'map_teams_lists.team_id', 'teams.id')
      .select(['teams.id as id', 'teams.name as name'])
      .where('map_teams_lists.tenant_id', '=', tenant_id)
      .where('map_teams_lists.list_id', '=', id)
      .execute();

    const newsletters: ListConsumer[] = newsletterRows.map((r) => ({
      id: String(r.id),
      name: r.name,
      kind: 'newsletter' as const,
    }));
    const forms: ListConsumer[] = formRows.map((r) => ({ id: String(r.id), name: r.name, kind: 'form' as const }));
    const teams: ListConsumer[] = teamRows.map((r) => ({ id: String(r.id), name: r.name, kind: 'team' as const }));

    return {
      newsletters,
      forms,
      teams,
      total: newsletters.length + forms.length + teams.length,
    };
  }

  public async updateList(id: string, row: UpdateListType, auth: IAuthKeyPayload) {
    // Built-ins (§8) own their name and their rules — those are what make them
    // recognisable and re-creatable. The description stays editable.
    const existing = await this.getRepo()
      .db.selectFrom('lists')
      .select(['name', 'system_key'])
      .where('tenant_id', '=', auth.tenant_id)
      .where('id', '=', id)
      .executeTakeFirst();
    if (existing?.system_key) {
      const changesIdentity =
        (row.name !== undefined && row.name !== existing.name) ||
        row.object !== undefined ||
        row.is_dynamic !== undefined ||
        row.definition !== undefined;
      if (changesIdentity) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: `“${existing.name}” is a built-in list — its name and rules are fixed. You can still edit its description.`,
        });
      }
    }

    const rowWithUpdatedBy = {
      ...row,
      updatedby_id: auth.user_id,
    };
    const result = await this.update({
      tenant_id: auth.tenant_id,
      id,
      row: rowWithUpdatedBy as OperationDataType<'lists', 'update'>,
    });

    // If the list is dynamic and definition or dynamics was updated, queue a refresh job
    const list = (await this.getOneById({ tenant_id: auth.tenant_id, id })) as any;
    if (list && list.is_dynamic && (row.definition !== undefined || row.is_dynamic === true)) {
      // Update status to refreshing
      await this.update({
        tenant_id: auth.tenant_id,
        id,
        row: {
          status: 'refreshing',
          updatedby_id: auth.user_id,
          updated_at: new Date(),
        },
      });

      await this.getRepo()
        .db.insertInto('background_jobs')
        .values({
          tenant_id: auth.tenant_id,
          queue: 'default',
          status: 'pending',
          payload: JSON.stringify({
            type: 'refresh_list',
            list_id: id,
            tenant_id: auth.tenant_id,
            user_id: auth.user_id,
          }),
          run_at: new Date(),
        })
        .execute();
    }

    return result;
  }

  /**
   * The built-in lists (§8) are product-owned: they can't be deleted, here or
   * in bulk. FORBIDDEN, not UNAUTHORIZED — this is a permission on the row, not
   * a session failure (throwing UNAUTHORIZED would sign the user out).
   */
  private async assertDeletable(tenant_id: string, ids: string[]): Promise<void> {
    if (!ids.length) return;
    const systemRows = await this.getRepo()
      .db.selectFrom('lists')
      .select(['name'])
      .where('tenant_id', '=', tenant_id)
      .where('id', 'in', ids)
      .where('system_key', 'is not', null)
      .execute();
    if (!systemRows.length) return;
    const names = systemRows.map((r) => `“${r.name}”`).join(', ');
    throw new TRPCError({
      code: 'FORBIDDEN',
      message:
        systemRows.length === 1
          ? `${names} is a built-in list and can't be deleted. It keeps itself up to date.`
          : `${names} are built-in lists and can't be deleted. They keep themselves up to date.`,
    });
  }

  /**
   * Deleting a list is a three-table write: its person memberships, its household memberships,
   * and the list row itself. Run unwrapped, a failure between steps left membership rows pointing
   * at a list that no longer exists, or stripped a list's members while leaving the list. One
   * transaction makes it all-or-nothing.
   */
  private async deleteListsWithMemberships(tenant_id: string, ids: string[]): Promise<boolean> {
    return this.getRepo()
      .transaction()
      .execute(async (trx) => {
        await trx
          .deleteFrom('map_lists_persons')
          .where('tenant_id', '=', tenant_id)
          .where('list_id', 'in', ids)
          .execute();

        await trx
          .deleteFrom('map_lists_households')
          .where('tenant_id', '=', tenant_id)
          .where('list_id', 'in', ids)
          .execute();

        const result = await trx
          .deleteFrom('lists')
          .where('tenant_id', '=', tenant_id)
          .where('id', 'in', ids)
          .execute();

        return result.some((r) => Number(r.numDeletedRows ?? 0) > 0);
      });
  }

  public override async delete(tenant_id: string, idToDelete: string, userId?: string) {
    await this.assertDeletable(tenant_id, [idToDelete]);

    const deleted = await this.deleteListsWithMemberships(tenant_id, [idToDelete]);

    // Activity logging stays outside the transaction and best-effort, matching BaseController:
    // a failed audit write must not roll back a delete the user already saw succeed.
    if (userId != null) {
      try {
        await this.userActivity.log({
          tenant_id,
          user_id: String(userId),
          activity: 'delete',
          entity: 'lists',
          entity_id: String(idToDelete),
          quantity: 1,
          metadata: { id: idToDelete },
        });
      } catch (e) {
        logger.error({ err: e }, 'Failed to log list delete activity');
      }
    }

    return deleted;
  }

  public override async deleteMany(tenant_id: string, idsToDelete: string[]) {
    if (idsToDelete.length === 0) return false;
    await this.assertDeletable(tenant_id, idsToDelete);

    return this.deleteListsWithMemberships(tenant_id, idsToDelete);
  }

  public override async getOneById(input: { tenant_id: string; id: string }) {
    const list = (await super.getOneById(input)) as any;
    if (list && list.is_dynamic) {
      const oneDayAgo = new Date(Date.now() - 24 * 3600 * 1000);
      if (!list.last_refreshed_at || new Date(list.last_refreshed_at) < oneDayAgo) {
        if (list.status !== 'refreshing') {
          // Lazily trigger refresh in background
          const mockAuth: IAuthKeyPayload = {
            tenant_id: input.tenant_id,
            user_id: list.createdby_id,
            name: 'System Worker',
            session_id: 'lazy-refresh',
          };
          const promise = this.refreshList(mockAuth, input.id).catch((err) =>
            logger.error({ err }, `Failed to lazily queue refresh for list ${input.id}`),
          );
          (this as any)._lastLazyRefreshPromise = promise;
        }
      }
    }
    if (!list) return list;
    return this.resolveCreatorAndUpdater(input.tenant_id, list);
  }
}
