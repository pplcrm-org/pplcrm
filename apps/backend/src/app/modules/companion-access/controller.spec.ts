import { hashToken } from '../../lib/token-hash';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { IAuthKeyPayload } from '@common';

import { BaseRepository } from '../../lib/base.repo';
import { generateTurfToken } from '../canvassing/repositories/turf-assignments.repo';
import { CompanionAccessController } from './controller';

type Db = typeof BaseRepository.dbInstance;

const rand = (): string => String(Math.floor(Math.random() * 100000000) + 10000000);

interface Seed {
  tenantId: string;
  adminId: string;
  organizerId: string;
  campaignId: string;
  turfId: string;
  personId: string;
  token: string;
}

/** Seed a tenant with an admin, an organizer, a person, and an assigned turf link. */
async function seed(db: Db, opts?: { email?: string | null; mobile?: string | null }): Promise<Seed> {
  const tenantId = rand();
  const adminId = rand();
  const organizerId = rand();
  const campaignId = rand();
  const turfId = rand();
  const personId = rand();
  const token = generateTurfToken();

  await db.insertInto('tenants').values({ id: tenantId, name: 'Companion Test' }).execute();
  for (const [id, role, first] of [
    [adminId, 'admin', 'Avery'],
    [organizerId, 'user', 'Sam'],
  ] as const) {
    await db
      .insertInto('authusers')
      .values({
        id,
        tenant_id: tenantId,
        email: `t-${id}@example.com`,
        password: 'x',
        first_name: first,
        last_name: 'Staff',
        role,
        verified: true,
        createdby_id: id,
        updatedby_id: id,
      })
      .execute();
  }
  await db
    .insertInto('campaigns')
    .values({
      id: campaignId,
      tenant_id: tenantId,
      admin_id: adminId,
      name: 'C',
      createdby_id: adminId,
      updatedby_id: adminId,
    })
    .execute();
  const householdId = rand();
  await db
    .insertInto('households')
    .values({
      id: householdId,
      tenant_id: tenantId,
      campaign_id: campaignId,
      createdby_id: organizerId,
      updatedby_id: organizerId,
    })
    .execute();
  await db
    .insertInto('persons')
    .values({
      id: personId,
      tenant_id: tenantId,
      household_id: householdId,
      first_name: 'Jordan',
      last_name: 'Rivera',
      email: opts?.email === undefined ? 'jordan@example.com' : opts.email,
      mobile: opts?.mobile === undefined ? '(613) 555-0142' : opts.mobile,
      createdby_id: organizerId,
      updatedby_id: organizerId,
    })
    .execute();
  await db
    .insertInto('turfs')
    .values({
      id: turfId,
      tenant_id: tenantId,
      campaign_id: campaignId,
      name: 'Maple Heights',
      status: 'active',
      createdby_id: organizerId,
      updatedby_id: organizerId,
    })
    .execute();
  await db
    .insertInto('turf_assignments')
    .values({
      tenant_id: tenantId,
      turf_id: turfId,
      // Tokens are stored hashed now (M5) — the raw value is only ever in the volunteer's link.
      token_hash: hashToken(token),
      status: 'active',
      volunteer_person_id: personId,
      createdby_id: organizerId,
      updatedby_id: organizerId,
    })
    .execute();

  return { tenantId, adminId, organizerId, campaignId, turfId, personId, token };
}

async function cleanup(db: Db, tenantId: string): Promise<void> {
  await db.deleteFrom('companion_sessions').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('companion_volunteers').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('background_jobs').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('user_activity').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('turf_assignments').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('turfs').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('persons').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('households').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('campaigns').where('tenant_id', '=', tenantId).execute();
  await db.updateTable('tenants').set({ admin_id: null, createdby_id: null }).where('id', '=', tenantId).execute();
  await db.deleteFrom('authusers').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('tenants').where('id', '=', tenantId).execute();
}

/** Pull the 6-digit code back out of the enqueued outbox job. */
async function lastCodeFromOutbox(db: Db, tenantId: string): Promise<string> {
  const rows = await db
    .selectFrom('background_jobs')
    .select(['payload'])
    .where('tenant_id', '=', tenantId)
    .orderBy('id', 'desc')
    .execute();
  for (const row of rows) {
    const payload = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
    const haystack = `${payload?.text ?? ''} ${payload?.body ?? ''}`;
    const match = haystack.match(/\b(\d{6})\b/);
    if (match?.[1]) return match[1];
  }
  throw new Error('no verification code found in outbox');
}

async function outboxTypes(db: Db, tenantId: string): Promise<string[]> {
  const rows = await db
    .selectFrom('background_jobs')
    .select(['payload'])
    .where('tenant_id', '=', tenantId)
    .orderBy('id', 'asc')
    .execute();
  return rows.map((r) => {
    const payload = typeof r.payload === 'string' ? JSON.parse(r.payload) : r.payload;
    return String(payload?.type ?? '');
  });
}

describe('CompanionAccessController', () => {
  const controller = new CompanionAccessController();
  const db = BaseRepository.dbInstance;
  let s: Seed;
  let adminAuth: IAuthKeyPayload;

  beforeEach(async () => {
    s = await seed(db);
    adminAuth = { tenant_id: s.tenantId, user_id: s.adminId, name: 'Avery Staff', session_id: 'sess', role: 'admin' };
  });

  afterEach(async () => {
    await cleanup(db, s.tenantId);
  });

  it('reports dead for an unknown token and unassigned when no volunteer is attached', async () => {
    expect((await controller.getAccess('turf', 'not-a-real-token', null)).state).toBe('dead');

    await db
      .updateTable('turf_assignments')
      .set({ volunteer_person_id: null })
      .where('tenant_id', '=', s.tenantId)
      .execute();
    const access = await controller.getAccess('turf', s.token, null);
    expect(access.state).toBe('unassigned');
    expect(access.organizerName).toBe('Sam');
  });

  it('asks a fresh device to verify, exposing only masked contacts', async () => {
    const access = await controller.getAccess('turf', s.token, null);
    expect(access.state).toBe('need_verification');
    expect(access.volunteerName).toBe('Jordan');
    expect(access.contacts).toEqual([
      { channel: 'email', masked: 'j•••@example.com' },
      { channel: 'sms', masked: '(•••) •••-0142' },
    ]);
    // Payload minimization: never the raw email/phone anywhere in the response.
    const json = JSON.stringify(access);
    expect(json).not.toContain('jordan@example.com');
    expect(json).not.toContain('0142142');
  });

  it('runs the full journey: code → pending approval → admin approves → ready; new device for an approved volunteer is ready immediately', async () => {
    // Send an email code.
    const start = await controller.verifyStart('turf', s.token, 'email');
    expect(start.masked).toBe('j•••@example.com');
    const code = await lastCodeFromOutbox(db, s.tenantId);

    // Confirm it — session minted, but pending admin approval.
    const confirm = await controller.verifyConfirm('turf', s.token, code, 'vitest');
    expect(confirm.status).toBe('pending_approval');
    expect(confirm.sessionToken).toBeTruthy();

    // Admins were notified by email through the outbox.
    const types = await outboxTypes(db, s.tenantId);
    expect(types.filter((t) => t === 'send-transactional-email').length).toBeGreaterThanOrEqual(2); // code + admin notice

    // ...and by an in-app bell notification linking to the approval page.
    const bell = await db
      .selectFrom('notifications')
      .selectAll()
      .where('tenant_id', '=', s.tenantId)
      .where('user_id', '=', s.adminId)
      .execute();
    expect(bell).toHaveLength(1);
    expect(bell[0]?.title).toMatch(/waiting for approval/i);
    expect(bell[0]?.link).toBe('/volunteer-access');

    // The session exists but the guard blocks unapproved volunteers.
    const link = { tenant_id: s.tenantId, volunteer_person_id: s.personId };
    await expect(controller.requireSession(confirm.sessionToken, link)).rejects.toThrow(/approval/i);
    expect((await controller.getAccess('turf', s.token, confirm.sessionToken)).state).toBe('pending_approval');

    // Admin approves — same session becomes usable without a second code.
    const volunteers = await controller.getAllVolunteers(s.tenantId);
    expect(volunteers).toHaveLength(1);
    expect(volunteers[0]?.status).toBe('verified');
    await controller.approveVolunteer(adminAuth, String(volunteers[0]?.id));

    await expect(controller.requireSession(confirm.sessionToken, link)).resolves.toBeUndefined();
    expect((await controller.getAccess('turf', s.token, confirm.sessionToken)).state).toBe('ready');

    // A new device for the now-approved volunteer: one code, ready immediately.
    const start2 = await controller.verifyStart('turf', s.token, 'sms');
    expect(start2.masked).toBe('(•••) •••-0142');
    const smsCode = await lastCodeFromOutbox(db, s.tenantId);
    const confirm2 = await controller.verifyConfirm('turf', s.token, smsCode, 'vitest-2');
    expect(confirm2.status).toBe('ready');
    expect((await outboxTypes(db, s.tenantId)).includes('send-sms')).toBe(true);
  });

  it('locks a code after five wrong attempts and requires a resend', async () => {
    await controller.verifyStart('turf', s.token, 'email');
    const code = await lastCodeFromOutbox(db, s.tenantId);
    const wrong = code === '000000' ? '000001' : '000000';

    for (let i = 0; i < 5; i++) {
      await expect(controller.verifyConfirm('turf', s.token, wrong, null)).rejects.toThrow(/didn't match/i);
    }
    // Sixth attempt — even the right code is dead now.
    await expect(controller.verifyConfirm('turf', s.token, code, null)).rejects.toThrow(/too many attempts/i);
    await expect(controller.verifyConfirm('turf', s.token, code, null)).rejects.toThrow(/request a new code/i);
  });

  it('rate-limits code sends per token', async () => {
    await controller.verifyStart('turf', s.token, 'email');
    await controller.verifyStart('turf', s.token, 'email');
    await controller.verifyStart('turf', s.token, 'email');
    await expect(controller.verifyStart('turf', s.token, 'email')).rejects.toThrow(/too many requests/i);
  });

  it('refuses to send verification codes while the organization is suspended', async () => {
    await db.updateTable('tenants').set({ suspended_at: new Date() }).where('id', '=', s.tenantId).execute();
    await expect(controller.verifyStart('turf', s.token, 'email')).rejects.toThrow(/temporarily unavailable/i);
    // No code email was queued to the outbox.
    expect((await outboxTypes(db, s.tenantId)).includes('send-transactional-email')).toBe(false);
  });

  it('still sends verification codes when sending is only tripwire-paused, not suspended', async () => {
    // A hard-bounce pause halts newsletters, but must NOT knock out field-ops verification codes —
    // only a full suspension (abuse review) gates the companion path.
    await db.updateTable('tenants').set({ sending_paused_at: new Date() }).where('id', '=', s.tenantId).execute();
    const start = await controller.verifyStart('turf', s.token, 'email');
    expect(start.masked).toBe('j•••@example.com');
    expect((await outboxTypes(db, s.tenantId)).includes('send-transactional-email')).toBe(true);
  });

  it('rejects a channel that is not on file', async () => {
    await db.updateTable('persons').set({ mobile: null }).where('tenant_id', '=', s.tenantId).execute();
    await expect(controller.verifyStart('turf', s.token, 'sms')).rejects.toThrow(/not on file/i);
    const access = await controller.getAccess('turf', s.token, null);
    expect(access.contacts).toEqual([{ channel: 'email', masked: 'j•••@example.com' }]);
  });

  it('revoking a volunteer kills every session and dead-ends the link', async () => {
    await controller.verifyStart('turf', s.token, 'email');
    const code = await lastCodeFromOutbox(db, s.tenantId);
    const confirm = await controller.verifyConfirm('turf', s.token, code, null);
    const volunteers = await controller.getAllVolunteers(s.tenantId);
    const volunteerId = String(volunteers[0]?.id);
    await controller.approveVolunteer(adminAuth, volunteerId);

    const link = { tenant_id: s.tenantId, volunteer_person_id: s.personId };
    await expect(controller.requireSession(confirm.sessionToken, link)).resolves.toBeUndefined();

    await controller.revokeVolunteer(adminAuth, volunteerId);
    await expect(controller.requireSession(confirm.sessionToken, link)).rejects.toThrow();
    expect((await controller.getAccess('turf', s.token, confirm.sessionToken)).state).toBe('dead');
  });

  it('rejects sessions across tenants and expired assignments', async () => {
    await controller.verifyStart('turf', s.token, 'email');
    const code = await lastCodeFromOutbox(db, s.tenantId);
    const confirm = await controller.verifyConfirm('turf', s.token, code, null);

    // Wrong tenant/link pairing → unauthorized.
    await expect(
      controller.requireSession(confirm.sessionToken, { tenant_id: rand(), volunteer_person_id: s.personId }),
    ).rejects.toThrow(/verification/i);

    // Expired capability link → dead, regardless of session.
    await db
      .updateTable('turf_assignments')
      .set({ expires_at: new Date(Date.now() - 1000) })
      .where('tenant_id', '=', s.tenantId)
      .execute();
    expect((await controller.getAccess('turf', s.token, confirm.sessionToken)).state).toBe('dead');
  });
});
