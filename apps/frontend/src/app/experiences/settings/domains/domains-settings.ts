import { Component, signal, computed, inject, OnInit, linkedSignal } from '@angular/core';
import { DEFAULT_LINK_SUBDOMAIN, isValidDnsLabel, normalizeDnsLabel } from '@common';
import { createLoadingGate } from '@uxcommon/loading-gate';
import { SettingsService } from '../services/settings-service';
import { AlertService } from '@uxcommon/components/alerts/alert-service';
import { Icon } from '@icons/icon';
import { ConfirmDialogService } from '../../../services/shared-dialog.service';
import { EmptyState } from '@uxcommon/components/empty-state/empty-state';
import { StatusBadge } from '@uxcommon/components/status-badge/status-badge';

export interface DNSVerificationRecord {
  host: string;
  type: string;
  data: string;
  valid: boolean;
}

export interface VerifiedDomain {
  domain: string;
  status: 'verified' | 'pending';
  spf: boolean;
  dkim: boolean;
  dmarc: boolean;
  domainAuthId?: number;
  linkBrandingId?: number;
  domainAuthDns?: {
    mail_cname?: DNSVerificationRecord;
    dkim1?: DNSVerificationRecord;
    dkim2?: DNSVerificationRecord;
  };
  linkBrandingDns?: {
    domain?: DNSVerificationRecord;
  };
  linkBranded?: boolean;
  /** The label the click-tracking CNAME lives at. Absent on domains added before it was
   * choosable — those all used the default. */
  linkSubdomain?: string;
}

/** One row of the DNS setup checklist, in plain language for non-technical users. */
export interface DnsRecordRow {
  title: string;
  subtitle: string;
  type: 'CNAME' | 'TXT';
  host: string;
  value: string;
  found: boolean;
}

@Component({
  selector: 'pc-domains-settings',
  imports: [EmptyState, Icon, StatusBadge],
  templateUrl: './domains-settings.html',
})
export class DomainSettingsComponent implements OnInit {
  private readonly settingsSvc = inject(SettingsService);
  private readonly alerts = inject(AlertService);
  private readonly dialogs = inject(ConfirmDialogService);

  private readonly _loading = createLoadingGate();
  protected readonly loaded = this._loading.loaded;

  protected readonly newDomain = signal('');
  protected readonly addingDomain = signal(false);

  /** Click-tracking label for the domain about to be added. Disclosed on demand rather than
   * shown by default: `email` is right for almost everyone, and a field most people should
   * ignore is a field that invites a wrong answer. */
  protected readonly defaultLinkSubdomain = DEFAULT_LINK_SUBDOMAIN;
  protected readonly showLinkSubdomain = signal(false);
  protected readonly newLinkSubdomain = signal(DEFAULT_LINK_SUBDOMAIN);

  /** Which domain's link label is being edited after the fact, and to what. */
  protected readonly editingLinkFor = signal<string | null>(null);
  protected readonly editedLinkSubdomain = signal('');
  protected readonly savingLinkSubdomain = signal(false);
  protected readonly verifyingDomain = signal<string | null>(null);
  protected readonly lastDomainVerificationTimes = signal<Record<string, number>>({});
  protected readonly domainCooldownSeconds = signal<Record<string, number>>({});
  protected readonly expandedDomain = linkedSignal<VerifiedDomain[], string | null>({
    source: () => this.domainsList(),
    computation: (list, prev) => {
      const prevVal = prev?.value;
      if (prevVal && list.some((d) => d.domain === prevVal)) {
        return prevVal;
      }
      return null;
    },
  });

  protected readonly domainsList = computed<VerifiedDomain[]>(() => {
    return this.settingsSvc.getValue<VerifiedDomain[]>('communications.verified_domains') || [];
  });

  ngOnInit() {
    // Ensure settings are loaded; the gate keeps the empty state hidden until they are
    const end = this._loading.begin();
    void this.settingsSvc.load().finally(end);
  }

  /**
   * The four records a domain needs before it can send. DKIM is one verified flag on the
   * backend but two DNS records for the user to add, so it appears twice here.
   */
  protected requiredRecords(item: VerifiedDomain): DnsRecordRow[] {
    return [
      {
        title: 'Sending permission (SPF)',
        subtitle: 'Tells email providers that pplCRM is allowed to send mail for your domain.',
        type: 'CNAME',
        host: item.domainAuthDns?.mail_cname?.host || 'em.' + item.domain,
        value: item.domainAuthDns?.mail_cname?.data || '',
        found: !!item.spf,
      },
      {
        title: 'Email signature 1 (DKIM)',
        subtitle: 'Adds a digital signature that proves your emails really came from you.',
        type: 'CNAME',
        host: item.domainAuthDns?.dkim1?.host || 's1._domainkey.' + item.domain,
        value: item.domainAuthDns?.dkim1?.data || '',
        found: !!item.dkim,
      },
      {
        title: 'Email signature 2 (DKIM)',
        subtitle: 'A backup signature key. Both signature records are needed.',
        type: 'CNAME',
        host: item.domainAuthDns?.dkim2?.host || 's2._domainkey.' + item.domain,
        value: item.domainAuthDns?.dkim2?.data || '',
        found: !!item.dkim,
      },
      {
        title: 'Branded links',
        subtitle:
          'Makes the links inside your emails use your own domain instead of ours. If this host is ' +
          'already in use, pick a different one below.',
        type: 'CNAME',
        host: item.linkBrandingDns?.domain?.host || this.linkSubdomainOf(item) + '.' + item.domain,
        value: item.linkBrandingDns?.domain?.data || '',
        found: !!item.linkBranded,
      },
    ];
  }

  /** DMARC is recommended, not required: shown separately so it never blocks setup. */
  protected dmarcRecord(item: VerifiedDomain): DnsRecordRow {
    return {
      title: 'Spoofing protection (DMARC)',
      subtitle: 'Tells email providers what to do with mail that pretends to be from you. Optional, but recommended.',
      type: 'TXT',
      host: '_dmarc.' + item.domain,
      value: 'v=DMARC1; p=none',
      found: !!item.dmarc,
    };
  }

  protected foundCount(item: VerifiedDomain): number {
    return this.requiredRecords(item).filter((r) => r.found).length;
  }

  protected async copyRecord(value: string) {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      this.alerts.showSuccess('Copied to your clipboard.');
    } catch {
      this.alerts.showError('Couldn’t copy. Select the text and copy it manually.');
    }
  }

  protected toggleExpand(domainName: string) {
    if (this.expandedDomain() === domainName) {
      this.expandedDomain.set(null);
    } else {
      this.expandedDomain.set(domainName);
    }
  }

  protected async addDomain() {
    const domainVal = this.newDomain().trim().toLowerCase();
    if (!domainVal) return;

    // Basic domain validation
    const domainRegex = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*\.[a-z]{2,24}$/i;
    if (!domainRegex.test(domainVal)) {
      this.alerts.showError('Please provide a valid domain name (e.g. example.com).');
      return;
    }

    const currentList = this.domainsList();
    if (currentList.some((d) => d.domain === domainVal)) {
      this.alerts.showError('This domain is already added.');
      return;
    }

    const linkLabel = normalizeDnsLabel(this.newLinkSubdomain() || DEFAULT_LINK_SUBDOMAIN);
    if (!isValidDnsLabel(linkLabel)) {
      this.alerts.showError(
        'The link subdomain must be a single label — lowercase letters, numbers and hyphens, no dots.',
      );
      return;
    }

    this.addingDomain.set(true);

    try {
      await this.settingsSvc.addVerifiedDomain(domainVal, linkLabel);
      this.newDomain.set('');
      this.showLinkSubdomain.set(false);
      this.newLinkSubdomain.set(DEFAULT_LINK_SUBDOMAIN);
      this.expandedDomain.set(domainVal); // Auto-expand to show DNS records
      this.alerts.showSuccess(`${domainVal} added. Next, add the DNS records shown below.`);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Failed to add domain.';
      this.alerts.showError(errMsg);
    } finally {
      this.addingDomain.set(false);
    }
  }

  /** The label in use for a domain's click-tracking CNAME, defaulted for older entries. */
  protected linkSubdomainOf(item: VerifiedDomain): string {
    return item.linkSubdomain || DEFAULT_LINK_SUBDOMAIN;
  }

  protected startEditingLink(item: VerifiedDomain) {
    this.editedLinkSubdomain.set(this.linkSubdomainOf(item));
    this.editingLinkFor.set(item.domain);
  }

  protected cancelEditingLink() {
    this.editingLinkFor.set(null);
  }

  /**
   * Move the click-tracking CNAME to a different label. The collision that makes this necessary
   * usually surfaces after the domain is added — you find out `email.<domain>` is taken when you
   * go to create the record — so this has to work without discarding an already-validated DKIM
   * setup.
   */
  protected async saveLinkSubdomain(domainName: string) {
    const label = normalizeDnsLabel(this.editedLinkSubdomain());
    if (!isValidDnsLabel(label)) {
      this.alerts.showError(
        'The link subdomain must be a single label — lowercase letters, numbers and hyphens, no dots.',
      );
      return;
    }

    this.savingLinkSubdomain.set(true);
    try {
      await this.settingsSvc.setLinkSubdomain(domainName, label);
      this.editingLinkFor.set(null);
      this.alerts.showSuccess(`Branded links now use ${label}.${domainName}. Add the new CNAME, then check again.`);
    } catch (err) {
      this.alerts.showError(err instanceof Error ? err.message : 'Could not change the link subdomain.');
    } finally {
      this.savingLinkSubdomain.set(false);
    }
  }

  protected isDomainVerifyCooldown(domainName: string): boolean {
    const lastTime = this.lastDomainVerificationTimes()[domainName];
    if (!lastTime) return false;
    return Date.now() - lastTime < 60000;
  }

  private startDomainCooldown(domainName: string) {
    this.domainCooldownSeconds.update((prev) => ({ ...prev, [domainName]: 60 }));
    const interval = setInterval(() => {
      const current = this.domainCooldownSeconds()[domainName] || 0;
      if (current <= 1) {
        clearInterval(interval);
        this.domainCooldownSeconds.update((prev) => {
          const next = { ...prev };
          delete next[domainName];
          return next;
        });
      } else {
        this.domainCooldownSeconds.update((prev) => ({ ...prev, [domainName]: current - 1 }));
      }
    }, 1000);
  }

  protected async verifyDomain(domainName: string) {
    if (this.isDomainVerifyCooldown(domainName)) {
      this.alerts.showError('Please wait at least one minute before verifying this domain again.');
      return;
    }

    this.verifyingDomain.set(domainName);

    try {
      const updatedList = (await this.settingsSvc.verifyVerifiedDomain(domainName)) as VerifiedDomain[];
      this.lastDomainVerificationTimes.update((prev) => ({
        ...prev,
        [domainName]: Date.now(),
      }));
      this.startDomainCooldown(domainName);
      const updatedDomain = updatedList.find((d: VerifiedDomain) => d.domain === domainName);

      if (updatedDomain && updatedDomain.status === 'verified') {
        this.alerts.showSuccess(`${domainName} is verified. You can now send from addresses on this domain.`);
      } else {
        this.alerts.showWarn(
          `Checked ${domainName}. Some records haven’t been found yet; DNS changes can take up to 48 hours to appear.`,
        );
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Failed to verify domain.';
      this.alerts.showError(errMsg);
    } finally {
      this.verifyingDomain.set(null);
    }
  }

  protected async deleteDomain(domainName: string) {
    const confirmed = await this.dialogs.confirm({
      title: 'Remove domain',
      message: `Removing ${domainName} means you can no longer send newsletters from addresses on it. You can add and verify it again later.`,
      variant: 'danger',
      confirmText: 'Remove domain',
    });
    if (!confirmed) return;

    try {
      await this.settingsSvc.deleteVerifiedDomain(domainName);
      this.alerts.showSuccess(`Domain ${domainName} removed.`);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Failed to remove domain.';
      this.alerts.showError(errMsg);
    }
  }
}
