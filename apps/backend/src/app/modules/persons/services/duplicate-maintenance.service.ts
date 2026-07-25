import { sql } from 'kysely';
import type { Kysely, Transaction } from 'kysely';
import type { Models, OperationDataType } from '../../../../../../../libs/common/src/lib/kysely.models';
import { PersonsRepo } from '../repositories/persons.repo';
import { DuplicatesRepo } from '../../duplicates/repositories/duplicates.repo';

export class DuplicateMaintenanceService {
  private readonly personsRepo = new PersonsRepo();
  private readonly duplicatesRepo = new DuplicatesRepo();

  /**
   * Rebuilds the tenant's `potential_duplicates` queue from scratch. Normally the nightly
   * `recompute_all_duplicates` cron calls this; pass `trx` to run it inside an open
   * transaction (demo seeding at signup) so it sees the rows that transaction just wrote.
   */
  public async recomputeAllDuplicates(tenantId: string, trx?: Transaction<Models>): Promise<void> {
    const db: Kysely<Models> = trx ?? this.personsRepo.db;

    // §9.3 rule: "'Not duplicates' remembered so the pair isn't re-flagged." Read the
    // tenant's dismissals up front and filter every candidate group against it below.
    const dismissedGroupKeys = await this.duplicatesRepo.getDismissedGroupKeys(tenantId, trx);

    // 1. Delete all potential duplicates for the tenant
    await db.deleteFrom('potential_duplicates').where('tenant_id', '=', tenantId).execute();

    // 2. Fetch the placeholder household id
    const tenantRow = await db
      .selectFrom('tenants')
      .select('placeholder_household_id')
      .where('id', '=', tenantId)
      .executeTakeFirst();
    const placeholderHhId = tenantRow?.placeholder_household_id;

    // 3. Find duplicates using bulk queries (equivalent to the old findPotentialDuplicates logic)
    // Email duplicates
    const duplicateEmails = await db
      .selectFrom('persons')
      .select([sql<string>`lower(email)`.as('email_lower')])
      .select((eb) => [eb.fn.agg<string[]>('array_agg', ['persons.id']).as('ids')])
      .where('tenant_id', '=', tenantId)
      .where('email', 'is not', null)
      .where(sql`trim(email)`, '!=', '')
      .groupBy(sql`lower(email)`)
      .having(sql`count(persons.id)`, '>', 1)
      .execute();

    // Household name duplicates
    const duplicateNamesInSameHousehold = await db
      .selectFrom('persons')
      .select([
        sql<string>`lower(first_name)`.as('first_name_lower'),
        sql<string>`lower(last_name)`.as('last_name_lower'),
        'household_id',
      ])
      .select((eb) => [eb.fn.agg<string[]>('array_agg', ['persons.id']).as('ids')])
      .where('tenant_id', '=', tenantId)
      .where('first_name', 'is not', null)
      .where('last_name', 'is not', null)
      .where(sql`trim(first_name)`, '!=', '')
      .where(sql`trim(last_name)`, '!=', '')
      .where('household_id', 'is not', null)
      .$if(!!placeholderHhId, (qb) => qb.where('household_id', '!=', placeholderHhId as string))
      .groupBy([sql`lower(first_name)`, sql`lower(last_name)`, 'household_id'])
      .having(sql`count(persons.id)`, '>', 1)
      .execute();

    // Address name duplicates
    const duplicateNamesInSameAddress = await db
      .selectFrom('persons')
      .innerJoin('households', 'persons.household_id', 'households.id')
      .select([
        sql<string>`lower(persons.first_name)`.as('first_name_lower'),
        sql<string>`lower(persons.last_name)`.as('last_name_lower'),
        'households.address_fp_full',
      ])
      .select((eb) => [eb.fn.agg<string[]>('array_agg', ['persons.id']).as('ids')])
      .where('persons.tenant_id', '=', tenantId)
      .where('persons.first_name', 'is not', null)
      .where('persons.last_name', 'is not', null)
      .where(sql`trim(persons.first_name)`, '!=', '')
      .where(sql`trim(persons.last_name)`, '!=', '')
      .where('households.address_fp_full', 'is not', null)
      .where(sql`trim(households.address_fp_full)`, '!=', '')
      .groupBy([sql`lower(persons.first_name)`, sql`lower(persons.last_name)`, 'households.address_fp_full'])
      .having(sql`count(persons.id)`, '>', 1)
      // Only CROSS-household matches: two people with one name inside a single household are
      // already the "Same Household" group above, and flagging them here too would put the
      // identical pair on the Duplicates page twice under two different reasons.
      .having(sql`count(distinct persons.household_id)`, '>', 1)
      .execute();

    // 4. Collect names of people to construct friendly reasons
    const allMatchingPersonIds = new Set<string>();
    const collectIds = (groups: Array<{ ids: string[] }>) => {
      for (const g of groups) {
        if (Array.isArray(g.ids)) {
          g.ids.forEach((id) => allMatchingPersonIds.add(String(id)));
        }
      }
    };
    collectIds(duplicateEmails);
    collectIds(duplicateNamesInSameHousehold);
    collectIds(duplicateNamesInSameAddress);

    const personsMap = new Map<string, { first_name: string | null; last_name: string | null }>();
    if (allMatchingPersonIds.size > 0) {
      const dbRows = await db
        .selectFrom('persons')
        .select(['id', 'first_name', 'last_name'])
        .where('tenant_id', '=', tenantId)
        .where('id', 'in', Array.from(allMatchingPersonIds))
        .execute();
      for (const row of dbRows) {
        personsMap.set(String(row.id), { first_name: row.first_name, last_name: row.last_name });
      }
    }

    const inserts: OperationDataType<'potential_duplicates', 'insert'>[] = [];

    // Email duplicates
    for (const group of duplicateEmails) {
      const email = group.email_lower;
      const key = `email:${email}`;
      const reason = `Matching Email: "${email}"`;
      for (const id of group.ids) {
        inserts.push({
          tenant_id: tenantId,
          group_key: key,
          person_id: String(id),
          reason,
        });
      }
    }

    // Household name duplicates
    for (const group of duplicateNamesInSameHousehold) {
      const key = `household:${group.household_id}:${group.first_name_lower}:${group.last_name_lower}`;
      const firstPerson = personsMap.get(String(group.ids[0]));
      const reason =
        `Matching Name at Same Household: "${firstPerson?.first_name || ''} ${firstPerson?.last_name || ''}"`
          .replace(/\s{2,}/g, ' ')
          .trim();
      for (const id of group.ids) {
        inserts.push({
          tenant_id: tenantId,
          group_key: key,
          person_id: String(id),
          reason,
        });
      }
    }

    // Address name duplicates
    for (const group of duplicateNamesInSameAddress) {
      const key = `address:${group.address_fp_full}:${group.first_name_lower}:${group.last_name_lower}`;
      const firstPerson = personsMap.get(String(group.ids[0]));
      const reason = `Matching Name at Same Address: "${firstPerson?.first_name || ''} ${firstPerson?.last_name || ''}"`
        .replace(/\s{2,}/g, ' ')
        .trim();
      for (const id of group.ids) {
        inserts.push({
          tenant_id: tenantId,
          group_key: key,
          person_id: String(id),
          reason,
        });
      }
    }
    // --- HOUSEHOLDS DUPLICATES ---
    const duplicateAddresses = await db
      .selectFrom('households')
      .select(['address_fp_full'])
      .select((eb) => [
        eb.fn.count('households.id').as('match_count'),
        eb.fn.agg<string[]>('array_agg', ['households.id']).as('ids'),
      ])
      .where('tenant_id', '=', tenantId)
      .where('address_fp_full', 'is not', null)
      .where(sql`trim(address_fp_full)`, '!=', '')
      .$if(!!placeholderHhId, (qb) => qb.where('id', '!=', placeholderHhId as string))
      .groupBy('address_fp_full')
      .having(sql`count(households.id)`, '>', 1)
      .execute();

    const hhIds = new Set<string>();
    for (const group of duplicateAddresses) {
      if (Array.isArray(group.ids)) {
        group.ids.forEach((id) => hhIds.add(String(id)));
      }
    }

    if (hhIds.size > 0) {
      const dbRows = await db
        .selectFrom('households')
        .select(['id', 'street_num', 'street1', 'street2', 'city', 'state', 'zip', 'country', 'apt'])
        .where('tenant_id', '=', tenantId)
        .where('id', 'in', Array.from(hhIds))
        .execute();

      // Typed off the query itself rather than Record<string, unknown> — the frontend
      // type-checks this file through the tRPC router graph under
      // noPropertyAccessFromIndexSignature, where `first.street_num` on an index type fails.
      type HouseholdRow = (typeof dbRows)[number];
      const hhMap = new Map<string, HouseholdRow>();
      for (const row of dbRows) {
        hhMap.set(String(row.id), row);
      }

      for (const group of duplicateAddresses) {
        const groupHouseholds = group.ids
          .map((id) => hhMap.get(String(id)))
          .filter((x): x is HouseholdRow => x != null);

        if (groupHouseholds.length > 1) {
          const first = groupHouseholds[0];
          const addrStr = [first?.street_num, first?.street1, first?.apt, first?.city, first?.state, first?.zip]
            .filter(Boolean)
            .join(' ');
          const reason = `Matching Address: "${addrStr}"`;
          const key = `household:fp:${group.address_fp_full}`;

          for (const hh of groupHouseholds) {
            inserts.push({
              tenant_id: tenantId,
              group_key: key,
              household_id: String(hh.id),
              person_id: null,
              reason,
            });
          }
        }
      }
    }

    // --- COMPANIES DUPLICATES ---
    const duplicateNames = await db
      .selectFrom('companies')
      .select([sql<string>`lower(trim(name))`.as('name_lower')])
      .select((eb) => [
        eb.fn.count('companies.id').as('match_count'),
        eb.fn.agg<string[]>('array_agg', ['companies.id']).as('ids'),
      ])
      .where('tenant_id', '=', tenantId)
      .where('name', 'is not', null)
      .where(sql`trim(name)`, '!=', '')
      .groupBy(sql`lower(trim(name))`)
      .having(sql`count(companies.id)`, '>', 1)
      .execute();

    const companyIds = new Set<string>();
    for (const group of duplicateNames) {
      if (Array.isArray(group.ids)) {
        group.ids.forEach((id) => companyIds.add(String(id)));
      }
    }

    if (companyIds.size > 0) {
      const dbRows = await db
        .selectFrom('companies')
        .select(['id', 'name'])
        .where('tenant_id', '=', tenantId)
        .where('id', 'in', Array.from(companyIds))
        .execute();

      type CompanyRow = (typeof dbRows)[number];
      const companyMap = new Map<string, CompanyRow>();
      for (const row of dbRows) {
        companyMap.set(String(row.id), row);
      }

      for (const group of duplicateNames) {
        const groupCompanies = group.ids
          .map((id) => companyMap.get(String(id)))
          .filter((x): x is CompanyRow => x != null);

        if (groupCompanies.length > 1) {
          const first = groupCompanies[0];
          const reason = `Matching Company Name: "${first?.name}"`;
          const key = `company:name:${group.name_lower}`;

          for (const c of groupCompanies) {
            inserts.push({
              tenant_id: tenantId,
              group_key: key,
              company_id: String(c.id),
              person_id: null,
              reason,
            });
          }
        }
      }
    }

    const keptInserts =
      dismissedGroupKeys.size > 0 ? inserts.filter((row) => !dismissedGroupKeys.has(String(row.group_key))) : inserts;

    if (keptInserts.length > 0) {
      // Use chunked inserts just in case the list is very large
      const chunkSize = 1000;
      for (let i = 0; i < keptInserts.length; i += chunkSize) {
        const chunk = keptInserts.slice(i, i + chunkSize);
        await db.insertInto('potential_duplicates').values(chunk).execute();
      }
    }
  }
}
