import { signal, Service } from '@angular/core';

import { SettingsEntryType } from '../../../../../../../libs/common/src';

import { TRPCService } from '../../../services/api/trpc-service';

export type TenantSettingsSnapshot = Record<string, unknown>;

@Service()
export class SettingsService extends TRPCService<TenantSettingsSnapshot> {
  public readonly snapshotSignal = signal<TenantSettingsSnapshot>({});
  private readonly isPendingSignal = signal<boolean>(false);

  public async load(force = false) {
    if (!force && Object.keys(this.snapshotSignal()).length) return this.snapshotSignal();

    this.isPendingSignal.set(true);
    try {
      const data = (await this.api.settings.getSnapshot.query()) ?? {};
      this.snapshotSignal.set(data);
      return data;
    } finally {
      this.isPendingSignal.set(false);
    }
  }

  public getValue<T = unknown>(key: string, fallback: T): T;
  public getValue<T = unknown>(key: string): T | undefined;
  public getValue<T = unknown>(key: string, fallback?: T) {
    const value = this.snapshotSignal()[key];
    return (value === undefined ? fallback : (value as T)) ?? fallback;
  }

  public async upsert(entries: SettingsEntryType[]) {
    if (!entries.length) return this.snapshotSignal();

    this.isPendingSignal.set(true);
    try {
      const data = await this.api.settings.upsert.mutate({ entries });
      this.snapshotSignal.set(data ?? {});
      return data;
    } finally {
      this.isPendingSignal.set(false);
    }
  }

  public async requestEmailVerification(email: string) {
    return this.api.settings.requestEmailVerification.mutate({ email });
  }

  public async getPhoneVerificationStatus() {
    return this.api.settings.getPhoneVerificationStatus.query();
  }

  public async requestPhoneVerification(phone: string) {
    return this.api.settings.requestPhoneVerification.mutate({ phone });
  }

  public async confirmPhoneVerification(code: string) {
    return this.api.settings.confirmPhoneVerification.mutate({ code });
  }

  public async verifySenderEmail(token: string) {
    return this.api.settings.verifySenderEmail.mutate({ token });
  }

  public async addVerifiedDomain(domain: string, linkSubdomain?: string) {
    this.isPendingSignal.set(true);
    try {
      const data = await this.api.settings.addVerifiedDomain.mutate({ domain, linkSubdomain });
      this.snapshotSignal.update((snap) => ({
        ...snap,
        'communications.verified_domains': data,
      }));
      return data;
    } finally {
      this.isPendingSignal.set(false);
    }
  }

  /** Move a domain's click-tracking CNAME to a different label — the way out of a collision at
   * the default `email.<domain>`. */
  public async setLinkSubdomain(domain: string, subdomain: string) {
    this.isPendingSignal.set(true);
    try {
      const data = await this.api.settings.setLinkSubdomain.mutate({ domain, subdomain });
      this.snapshotSignal.update((snap) => ({
        ...snap,
        'communications.verified_domains': data,
      }));
      return data;
    } finally {
      this.isPendingSignal.set(false);
    }
  }

  public async verifyVerifiedDomain(domain: string) {
    this.isPendingSignal.set(true);
    try {
      const data = await this.api.settings.verifyVerifiedDomain.mutate({ domain });
      this.snapshotSignal.update((snap) => ({
        ...snap,
        'communications.verified_domains': data,
      }));
      return data;
    } finally {
      this.isPendingSignal.set(false);
    }
  }

  public async deleteVerifiedDomain(domain: string) {
    this.isPendingSignal.set(true);
    try {
      const data = await this.api.settings.deleteVerifiedDomain.mutate({ domain });
      this.snapshotSignal.update((snap) => ({
        ...snap,
        'communications.verified_domains': data,
      }));
      return data;
    } finally {
      this.isPendingSignal.set(false);
    }
  }

  public async createApiKey() {
    return this.api.settings.createApiKey.mutate();
  }

  public async listApiKeys() {
    return this.api.settings.listApiKeys.query();
  }

  public async revokeApiKey(slot: number) {
    return this.api.settings.revokeApiKey.mutate({ slot });
  }

  public snapshot(): TenantSettingsSnapshot {
    return this.snapshotSignal();
  }

  public pending(): boolean {
    return this.isPendingSignal();
  }
}
