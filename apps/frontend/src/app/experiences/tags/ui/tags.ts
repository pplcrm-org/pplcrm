import { Component, inject, input, model, output, signal } from '@angular/core';
import { TagsService } from '@experiences/tags/services/tags-service';
import { AutoComplete } from '@uxcommon/components/autocomplete/autocomplete';
import { TagOptionsService } from '@frontend/shared/components/datagrid/services/tag-options.service';

import { TagItem } from '@uxcommon/components/tags/tagitem';
import { TagPaletteService } from './tag-palette.service';

interface TagView {
  name: string;
  color: string | null;
}

@Component({
  selector: 'pc-tags',
  imports: [TagItem, AutoComplete],
  template: `@let tagViews = displayTags();
    @if (!readonly()) {
      <!-- Editable: chips live inside the input box, before the text field (combobox / token input) -->
      <pc-autocomplete
        (valueChange)="add($event)"
        (backspaceEmpty)="removeLast()"
        [placeholder]="placeholder()"
        [filterSvc]="enableAutoComplete() ? this : null"
      >
        @for (tag of tagViews; track tag.name) {
          <pc-tagitem
            [name]="tag.name"
            [color]="tag.color"
            [canDelete]="canDelete()"
            [compact]="true"
            (click)="clicked(tag.name)"
            (close)="closed(tag.name)"
          ></pc-tagitem>
        }
      </pc-autocomplete>
    } @else if (tagViews.length) {
      <!-- Readonly: chips only, in their own row -->
      <div class="flex flex-wrap items-center gap-1">
        @for (tag of tagViews; track tag.name) {
          <pc-tagitem
            [name]="tag.name"
            [color]="tag.color"
            [canDelete]="canDelete()"
            [compact]="compact()"
            (click)="clicked(tag.name)"
            (close)="closed(tag.name)"
          ></pc-tagitem>
        }
        @if (limit() !== undefined && !expanded() && tags().length > limit()!) {
          @let remainingCount = tags().length - limit()!;
          <span
            class="badge badge-neutral badge-sm cursor-pointer align-middle hover:bg-neutral-focus"
            (click)="expanded.set(true); $event.stopPropagation()"
          >
            +{{ remainingCount }}
          </span>
        }
      </div>
    } `,
})
export class Tags {
  protected displayedTags: string[] = [];
  protected expanded = signal(false);
  private readonly paletteSvc = inject(TagPaletteService);
  private readonly tagOptionsSvc = inject(TagOptionsService);

  public readonly tagAdded = output<string>();

  public readonly tagClicked = output<string>();

  public readonly tagRemoved = output<string>();

  public animateRemoval = input<boolean>(true);

  public canDelete = input<boolean>(true);

  public enableAutoComplete = input<boolean>(true);

  public placeholder = input<string>('Enter tags, separated by comma');

  public readonly = input<boolean>(false);
  public readonly type = input<'tag' | 'issue'>('tag');
  public compact = input<boolean>(false);
  public tagSvc = inject(TagsService);
  /** Two-way model: every add/remove produces a NEW array reference so parent
   *  signals and computed()s re-run. Never mutate the bound array in place. */
  public tags = model<string[]>([]);
  public limit = input<number | undefined>(undefined);

  protected displayTags(): TagView[] {
    const raw = this.tags() ?? [];
    const limitVal = this.limit();
    const isExpanded = this.expanded();
    const palette = this.paletteSvc.palette();
    const seen = new Set<string>();
    const out: TagView[] = [];
    for (const entry of raw) {
      if (typeof entry !== 'string') continue;
      const name = entry.trim();
      if (!name || seen.has(name)) continue;
      seen.add(name);
      const lower = name.toLowerCase();
      const color = palette[name] ?? palette[lower] ?? this.paletteSvc.colorFor(name);
      out.push({ name, color: color ?? null });
    }
    return limitVal !== undefined && !isExpanded ? out.slice(0, limitVal) : out;
  }

  public async filter(key: string) {
    if (!key || key.length === 0) {
      return [];
    }
    const names = (await this.tagSvc.findByName(key, this.type())) as { name: string }[];
    return names.map((m) => m.name);
  }

  protected add(tagName: string) {
    if (!tagName || typeof tagName !== 'string') return;

    if (tagName.indexOf(',') >= 0) {
      tagName = tagName.replace(',', '').trim();
    }

    tagName = tagName.toLowerCase().trim();

    if (tagName.length === 0) return;

    const name = tagName;
    const index = this.tags().findIndex((tag) => (tag || '').toLowerCase().trim() === name);
    if (index === -1) {
      this.tags.update((tags) => [name, ...tags]);
      this.tagAdded.emit(name);
      // Invalidate the options cache so the grid's inline dropdown reflects this new value
      void this.tagOptionsSvc.invalidate(this.type());
    } else {
      // Bring the tag that matches to the front.
      this.tags.update((tags) => [...tags.slice(index, index + 1), ...tags.slice(0, index), ...tags.slice(index + 1)]);
    }
  }

  protected clicked(tag: string) {
    this.tagClicked.emit(tag);
  }

  /** Remove the chip nearest the cursor (the last/rightmost one) — Backspace on an empty field. */
  protected removeLast() {
    const tags = this.tags();
    if (tags.length) {
      const last = tags[tags.length - 1];
      if (last) this.remove(last);
    }
  }

  protected closed(tag: string) {
    this.remove(tag);
  }

  protected remove(tagName: string) {
    const target = (tagName || '').toLowerCase().trim();
    const index = this.tags().findIndex((tag) => (tag || '').toLowerCase().trim() === target);
    if (index > -1) {
      const removed = this.tags()[index];
      this.tags.update((tags) => tags.filter((_, i) => i !== index));
      if (removed != null) this.tagRemoved.emit(removed);
    }
  }
}
