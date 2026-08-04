import { Component, inject, OnInit } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';

import { Icon } from '@icons/icon';
import { PersonsService } from '@experiences/persons/services/persons-service';
import { DuplicatePageShellComponent, MergeSummaryComponent } from './merge-summary';
import { BaseDuplicateManager, confidenceFor, whyFlaggedFor, type DuplicateGroup } from './base-duplicates-manager';

interface PersonDuplicateItem {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  mobile: string | null;
  /**
   * Every electoral boundary the person's household falls inside, joined into one string by the
   * backend. It replaces the old single `ward` text column, because an address is normally inside a
   * riding AND a ward AND a precinct at once and one column could only ever show one of them.
   * Keyed `any_electoral_area` — everywhere in the app that key means "all boundaries, joined",
   * while `electoral_area` means the single value from the campaign's seat set.
   */
  any_electoral_area: string | null;
  tags: string[];
  created_at: string | Date;
}

@Component({
  selector: 'pc-people-duplicates',
  imports: [DuplicatePageShellComponent, MergeSummaryComponent, Icon, DatePipe, RouterLink],
  templateUrl: './duplicates-people.html',
})
export class PeopleDuplicatesComponent extends BaseDuplicateManager<PersonDuplicateItem> implements OnInit {
  private personsSvc = inject(PersonsService);

  ngOnInit() {
    void this.loadDuplicates();
  }

  protected getEntityName() {
    return 'person';
  }

  protected fetchFromService(opts: { page: number; pageSize: number }) {
    return this.personsSvc.getPotentialDuplicates(opts);
  }

  protected getItemsFromRawGroup(raw: { persons?: PersonDuplicateItem[] }) {
    return raw.persons || [];
  }

  protected async mergeInService(targetId: string, sourceId: string): Promise<void> {
    await this.personsSvc.mergePersons(targetId, sourceId);
  }

  /**
   * Merging two people who both hold a companion volunteer record keeps only the surviving
   * record's, which can revoke a working volunteer's access to the canvassing and delivery apps.
   * The service answers per pair, so this sentence appears only on the merges where it is true.
   */
  protected override mergeWarning(
    targetId: string,
    sourceId: string,
    names: { target: string; source: string },
  ): Promise<string | null> {
    return this.personsSvc.mergeWarning(targetId, sourceId, names);
  }

  protected getItemDisplayName(p: PersonDuplicateItem): string {
    return `${p.first_name || ''} ${p.last_name || ''}`.trim() || 'Unnamed person';
  }

  // Helper for the template
  public getDisplayNameForId(items: PersonDuplicateItem[], id?: string): string {
    if (!id) return '';
    const item = items.find((i) => i.id === id);
    return item ? this.getItemDisplayName(item) : '';
  }

  protected confidence(group: DuplicateGroup<PersonDuplicateItem>): 'high' | 'possible' {
    return confidenceFor(group.reason);
  }

  protected whyFlagged(group: DuplicateGroup<PersonDuplicateItem>): string {
    return whyFlaggedFor(group.reason);
  }

  protected rowHighlighted(group: DuplicateGroup<PersonDuplicateItem>, field: 'name' | 'email'): boolean {
    const reason = group.reason.toLowerCase();
    return field === 'email' ? reason.includes('email') : reason.includes('name');
  }

  /** Spec §9.3 result-preview line: "One record: Mia Osei · both emails kept · tags donor +
   * volunteer · nothing overwritten". Mirrors the field list `PersonsRepo.mergePersons` actually
   * fills (email/mobile/home_phone/notes/company_id/...) so the preview never promises more
   * than the merge does. */
  protected resultPreview(group: DuplicateGroup<PersonDuplicateItem>): string {
    const target = group.items.find((i) => i.id === group.selectedTargetId);
    const source = group.items.find((i) => i.id === group.selectedSourceId);
    if (!target || !source) return '';

    const name = this.getItemDisplayName(target);
    const filled: string[] = [];
    if (!target.email && source.email) filled.push('email');
    if (!target.mobile && source.mobile) filled.push('mobile');

    const mergedTags = Array.from(new Set([...(target.tags ?? []), ...(source.tags ?? [])]));

    const parts = [`One record: ${name}`];
    parts.push(filled.length ? `${filled.join(' and ')} filled in from the duplicate` : 'both records already agreed');
    if (mergedTags.length) parts.push(`tags ${mergedTags.join(' + ')}`);
    parts.push('nothing overwritten');
    return parts.join(' · ');
  }
}
