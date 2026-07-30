import { signal } from '@angular/core';
import { describe, expect, it, vi } from 'vitest';

import type { CompanionVolunteerRow } from '@common';

import { VolunteerAccessService } from './volunteer-access-service';

function row(id: string, status: CompanionVolunteerRow['status']): CompanionVolunteerRow {
  return {
    id,
    person_id: `p-${id}`,
    first_name: 'Ada',
    last_name: 'Byron',
    email: 'ada@example.com',
    mobile: null,
    status,
    verify_channel: 'email',
    verified_at: new Date('2026-07-29T12:00:00Z').toISOString(),
    approved_at: status === 'approved' ? new Date('2026-07-29T12:05:00Z').toISOString() : null,
    can_roam: null,
    approved_by_name: status === 'approved' ? 'Sam Organizer' : null,
    created_at: new Date('2026-07-29T11:00:00Z').toISOString(),
  };
}

/**
 * Bare instance without Angular's inject()s — the house pattern for TRPCService-backed
 * services. Field initializers are skipped by Object.create, so the shared pending-count
 * signal is wired here the way the class wires it.
 */
function makeService(rows: CompanionVolunteerRow[]): { svc: VolunteerAccessService; getAll: ReturnType<typeof vi.fn> } {
  const getAll = vi.fn().mockResolvedValue(rows);
  const pendingCount = vi.fn().mockResolvedValue(7);
  const svc = Object.create(VolunteerAccessService.prototype) as VolunteerAccessService;
  const pending = signal<number | null>(null);
  const writable: Record<string, unknown> = svc;
  writable['pending'] = pending;
  writable['pendingApprovals'] = pending.asReadonly();
  writable['api'] = { companionAccess: { getAll: { query: getAll }, pendingCount: { query: pendingCount } } };
  return { svc, getAll };
}

describe('VolunteerAccessService — shared pending count', () => {
  /**
   * The regression this exists for: the sidebar's Approvals badge was fetched once per
   * session, so approving a volunteer left a "1 pending" badge on screen pointing at a
   * page with nothing pending. Reading the list is now what restamps the badge.
   */
  it('restamps the pending count from the rows getAll returned', async () => {
    const { svc } = makeService([row('a', 'approved'), row('b', 'approved')]);
    await svc.getAll();
    expect(svc.pendingApprovals()).toBe(0);
  });

  it('counts only volunteers still awaiting approval', async () => {
    const { svc } = makeService([row('a', 'verified'), row('b', 'approved'), row('c', 'revoked'), row('d', 'invited')]);
    await svc.getAll();
    expect(svc.pendingApprovals()).toBe(1);
  });

  it('falls back to the server count for sessions that never open the page', async () => {
    const { svc } = makeService([]);
    await svc.refreshPendingCount();
    expect(svc.pendingApprovals()).toBe(7);
  });
});
