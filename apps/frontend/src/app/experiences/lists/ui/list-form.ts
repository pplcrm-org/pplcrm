import { Component, OnInit, computed, inject, input, resource, signal, viewChild } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';

import { FormField, form, required } from '@angular/forms/signals';
import { AddListType, UpdateListType } from '../../../../../../../libs/common/src';
import { HouseholdsService } from '@experiences/households/services/households-service';
import { ListsService } from '@experiences/lists/services/lists-service';
import { ListsRefreshService } from '@experiences/lists/services/lists-refresh.service';
import { buildDeleteConfirmMessage } from '@experiences/lists/services/list-consumers';
import { PersonsService } from '@experiences/persons/services/persons-service';
import { TagsService } from '@experiences/tags/services/tags-service';
import { Icon } from '@icons/icon';
import { AbstractAPIService } from '../../../services/api/abstract-api.service';
import { FormActions } from '@uxcommon/components/form-actions/form-actions';
import { AlertService } from '@uxcommon/components/alerts/alert-service';
import { DataGrid } from '@frontend/shared/components/datagrid/datagrid';
import { createLoadingGate } from '@uxcommon/loading-gate';

import type { ColumnDef as ColDef } from '@frontend/shared/components/datagrid/grid-defaults';
import { ConfirmDialogService } from '../../../services/shared-dialog.service';

import { QueryBuilderField, QueryBuilderComponent } from '@frontend/shared/components/query-builder/query-builder';
import { QueryBuilderNode, QueryBuilderGroupNode, cloneQueryBuilderNode } from '../../../../../../../libs/common/src';

@Component({
  selector: 'pc-household-filter-grid',
  imports: [DataGrid],
  template: `<pc-datagrid
    #grid
    [colDefs]="col"
    [disableDelete]="true"
    [disableExport]="true"
    [disableImport]="true"
    [disableRefresh]="true"
    [disableView]="disableView()"
    [limitToTags]="tags()"
    [allowFilter]="allowFilter()"
    [showToolbar]="showToolbar()"
    [enableSelection]="enableSelection()"
    [externalAdvancedFilterModel]="externalAdvancedFilterModel()"
  ></pc-datagrid>`,
  providers: [{ provide: AbstractAPIService, useExisting: HouseholdsService }],
})
export class HouseholdFilterGrid {
  private readonly grid = viewChild(DataGrid);

  protected col: ColDef[] = [
    {
      field: 'address',
      headerName: 'Address',
      valueGetter: (params: any) => {
        const data = params?.data;
        if (!data) return '';
        const parts: string[] = [];
        const streetParts = [data.apt ? `Apt ${data.apt}` : null, data.street_num, data.street1, data.street2].filter(
          Boolean,
        );
        const locationParts = [data.city, data.state, data.zip, data.country].filter(Boolean);
        if (streetParts.length) parts.push(streetParts.join(' ').trim());
        if (locationParts.length) parts.push(locationParts.join(', ').trim());
        return parts.join(', ').trim() || 'No household assigned';
      },
    },
    { field: 'people_count', headerName: 'People' },
    { field: 'tags', headerName: 'Tags' },
  ];

  public allowFilter = input<boolean>(true);
  public showToolbar = input<boolean>(true);
  public enableSelection = input<boolean>(true);
  public disableView = input<boolean>(true);
  public externalAdvancedFilterModel = input<any | null>(null);
  public readonly tags = input<string[]>([]);

  public getCountRowSelected() {
    return this.grid()?.getCountRowSelected() ?? 0;
  }
  public getDefinition() {
    return this.grid()?.getDefinition();
  }
  public triggerFilterChanged() {
    this.grid()?.triggerFilterChanged();
  }
}

@Component({
  selector: 'pc-people-filter-grid',
  imports: [DataGrid],
  template: `<pc-datagrid
    #grid
    [colDefs]="col"
    [disableDelete]="true"
    [disableExport]="true"
    [disableImport]="true"
    [disableRefresh]="true"
    [disableView]="disableView()"
    [limitToTags]="tags()"
    [allowFilter]="allowFilter()"
    [showToolbar]="showToolbar()"
    [enableSelection]="enableSelection()"
    [externalAdvancedFilterModel]="externalAdvancedFilterModel()"
  ></pc-datagrid>`,
  providers: [{ provide: AbstractAPIService, useExisting: PersonsService }],
})
export class PeopleFilterGrid {
  private readonly grid = viewChild(DataGrid);

  protected col: ColDef[] = [
    { field: 'first_name', headerName: 'First Name' },
    { field: 'last_name', headerName: 'Last Name' },
    { field: 'email', headerName: 'Email' },
    { field: 'mobile', headerName: 'Mobile' },
    { field: 'tags', headerName: 'Tags' },
    {
      field: 'address',
      headerName: 'Address',
      valueGetter: (params: any) => {
        const data = params?.data;
        if (!data) return '';
        const parts: string[] = [];
        const streetParts = [data.apt ? `Apt ${data.apt}` : null, data.street_num, data.street1, data.street2].filter(
          Boolean,
        );
        const locationParts = [data.city, data.state, data.zip, data.country].filter(Boolean);
        if (streetParts.length) parts.push(streetParts.join(' ').trim());
        if (locationParts.length) parts.push(locationParts.join(', ').trim());
        return parts.join(', ').trim() || 'No household assigned';
      },
    },
  ];

  public allowFilter = input<boolean>(true);
  public showToolbar = input<boolean>(true);
  public enableSelection = input<boolean>(true);
  public disableView = input<boolean>(true);
  public externalAdvancedFilterModel = input<any | null>(null);
  public readonly tags = input<string[]>([]);

  public getCountRowSelected() {
    return this.grid()?.getCountRowSelected() ?? 0;
  }
  public getDefinition() {
    return this.grid()?.getDefinition();
  }
  public triggerFilterChanged() {
    this.grid()?.triggerFilterChanged();
  }
}

@Component({
  selector: 'pc-list-form',
  imports: [FormField, FormActions, PeopleFilterGrid, HouseholdFilterGrid, Icon, QueryBuilderComponent],
  templateUrl: './list-form.html',
})
export class ListForm implements OnInit {
  private readonly alertSvc = inject(AlertService);
  private readonly householdsSvc = inject(HouseholdsService);
  private readonly listsSvc = inject(ListsService);
  private readonly personsSvc = inject(PersonsService);
  private readonly listsRefresh = inject(ListsRefreshService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly dialogs = inject(ConfirmDialogService);

  private _loading = createLoadingGate();
  private readonly householdGrid = viewChild(HouseholdFilterGrid);
  private readonly peopleGrid = viewChild(PeopleFilterGrid);

  protected readonly tagSvc = inject(TagsService);

  protected readonly id = signal<string | null>(null);
  protected readonly isNew = signal<boolean>(true);

  /** Disables Save immediately on click — the loading gate stays false for its first
   *  300ms by design, which would leave a double-click window. */
  protected readonly saving = signal(false);

  protected readonly payload = signal({
    name: '',
    description: '',
    object: 'people' as 'people' | 'households',
    is_dynamic: false,
  });

  protected readonly form = form(this.payload, (p) => {
    required(p.name);
  });

  protected readonly listType = computed<'people' | 'households'>(() => this.payload().object);

  protected readonly isDynamic = computed<boolean>(() => this.payload().is_dynamic);

  protected setObject(object: 'people' | 'households'): void {
    this.payload.update((p) => ({ ...p, object }));
  }

  protected setDynamic(is_dynamic: boolean): void {
    this.payload.update((p) => ({ ...p, is_dynamic }));
  }

  public ngOnInit(): void {
    void this.loadOnInit();
  }

  private async loadOnInit(): Promise<void> {
    const id = this.route.snapshot.paramMap.get('id');
    const mode = this.route.snapshot.data['mode'] as 'new' | 'edit' | undefined;
    this.isNew.set(mode !== 'edit');
    if (id && mode === 'edit') {
      this.id.set(id);
      await this.loadList();
    }
  }

  private async loadList() {
    const id = this.id();
    if (!id) return;
    const end = this._loading.begin();
    try {
      const list = (await this.listsSvc.getById(id)) as any;
      if (list) {
        this.payload.set({
          name: list.name ?? '',
          description: list.description ?? '',
          object: list.object === 'households' ? 'households' : 'people',
          is_dynamic: list.is_dynamic === true,
        });

        const definition = list.definition as any;
        if (definition) {
          if (definition.advancedFilterModel) {
            this.rulesRoot.set(definition.advancedFilterModel);
          } else if (definition.filterModel?.tags_expression) {
            this.rulesRoot.set(definition.filterModel.tags_expression);
          }
        }
      }
    } catch (_err) {
      this.alertSvc.showError('Failed to load list details');
    } finally {
      end();
    }
  }

  protected readonly countRowSelected = computed(() => {
    const type = this.listType();
    if (type === 'people') {
      return this.peopleGrid()?.getCountRowSelected() ?? 0;
    } else {
      return this.householdGrid()?.getCountRowSelected() ?? 0;
    }
  });

  protected readonly btnLabel = computed(() => {
    const isDynamic = this.isDynamic();
    const count = this.countRowSelected();
    return !isDynamic && count > 0 ? `SAVE (${count} selected)` : 'SAVE';
  });

  /** "1,284 people" / "1 household" — noun agrees with count and object (§8). */
  protected readonly matchNoun = computed<string>(() => {
    const n = this.matchCount() ?? 0;
    const people = n === 1 ? 'person' : 'people';
    const households = n === 1 ? 'household' : 'households';
    return this.listType() === 'people' ? people : households;
  });

  private formatCount(value: number | null): string {
    return new Intl.NumberFormat().format(value ?? 0);
  }

  /** Live preview headline — the count does its math in public (§8). */
  protected readonly matchSentence = computed<string>(() => {
    if (this.counting()) return 'Counting matches…';
    const n = this.matchCount();
    if (n == null) return '';
    return `Matches ${this.formatCount(n)} ${this.matchNoun()} right now`;
  });

  /** Verbatim §8 mode note beneath the live count — differs by list type. */
  protected readonly modeNote = computed<string>(() =>
    this.isDynamic()
      ? 'this count keeps changing on its own; the rules re-run automatically as records change.'
      : "the rules run once when you create the list. Today's matches are saved as fixed members. New matching people are NOT added later.",
  );

  /** Verbatim §8 create-button label — carries the scale it will act on. */
  protected readonly createLabel = computed<string>(() => {
    const n = this.formatCount(this.matchCount());
    return this.isDynamic() ? `Create smart list (${n} now)` : `Create static list (snapshot ${n})`;
  });

  protected readonly rulesRoot = signal<QueryBuilderGroupNode>({
    kind: 'group',
    id: 'root',
    conjunction: 'AND',
    rules: [],
  });

  protected readonly listFields = computed<QueryBuilderField[]>(() => {
    const isPeople = this.listType() === 'people';
    const tagOperators = [
      { value: 'eq', label: 'is' },
      { value: 'neq', label: 'is not' },
      { value: 'contains', label: 'contains' },
      { value: 'notContains', label: 'does not contain' },
      { value: 'equals', label: 'equals' },
      { value: 'notEquals', label: 'does not equal' },
      { value: 'startsWith', label: 'starts with' },
      { value: 'endsWith', label: 'ends with' },
      { value: 'isEmpty', label: 'is empty' },
      { value: 'isNotEmpty', label: 'is not empty' },
    ];
    const textOperators = [
      { value: 'contains', label: 'contains' },
      { value: 'notContains', label: 'does not contain' },
      { value: 'equals', label: 'equals' },
      { value: 'notEquals', label: 'does not equal' },
      { value: 'startsWith', label: 'starts with' },
      { value: 'endsWith', label: 'ends with' },
      { value: 'isEmpty', label: 'is empty' },
      { value: 'isNotEmpty', label: 'is not empty' },
    ];

    if (isPeople) {
      return [
        { name: 'tags', label: 'Tags', operators: tagOperators, inputType: 'autocomplete' as const },
        { name: 'issues', label: 'Issues', operators: tagOperators, inputType: 'autocomplete' as const },
        { name: 'first_name', label: 'First Name', operators: textOperators, inputType: 'text' as const },
        { name: 'last_name', label: 'Last Name', operators: textOperators, inputType: 'text' as const },
        { name: 'email', label: 'Email', operators: textOperators, inputType: 'text' as const },
        { name: 'mobile', label: 'Mobile', operators: textOperators, inputType: 'text' as const },
        { name: 'company_name', label: 'Company', operators: textOperators, inputType: 'text' as const },
        { name: 'city', label: 'City', operators: textOperators, inputType: 'text' as const },
        { name: 'state', label: 'State/Province', operators: textOperators, inputType: 'text' as const },
        { name: 'street1', label: 'Street 1', operators: textOperators, inputType: 'text' as const },
        { name: 'street_num', label: 'Street Number', operators: textOperators, inputType: 'text' as const },
        { name: 'zip', label: 'Zip Code', operators: textOperators, inputType: 'text' as const },
      ];
    } else {
      return [
        { name: 'tags', label: 'Tags', operators: tagOperators, inputType: 'autocomplete' as const },
        { name: 'issues', label: 'Issues', operators: tagOperators, inputType: 'autocomplete' as const },
        { name: 'city', label: 'City', operators: textOperators, inputType: 'text' as const },
        { name: 'state', label: 'State/Province', operators: textOperators, inputType: 'text' as const },
        { name: 'street1', label: 'Street 1', operators: textOperators, inputType: 'text' as const },
        { name: 'street2', label: 'Street 2', operators: textOperators, inputType: 'text' as const },
        { name: 'street_num', label: 'Street Number', operators: textOperators, inputType: 'text' as const },
        { name: 'zip', label: 'Zip Code', operators: textOperators, inputType: 'text' as const },
        { name: 'home_phone', label: 'Home Phone', operators: textOperators, inputType: 'text' as const },
      ];
    }
  });

  protected externalRowFilter = (row: any) => {
    const tags: string[] = Array.isArray(row?.tags) ? row.tags.filter(Boolean) : [];
    return this.evalGroupWithRow(this.rulesRoot(), new Set(tags), row);
  };
  protected isLoading = this._loading.visible;

  protected readonly rulesError = computed(() => {
    return this.validateRules();
  });

  protected readonly matchCountResource = resource({
    params: () => ({
      rules: this.rulesRoot(),
      object: this.listType(),
      hasRules: this.hasAnyRule(this.rulesRoot()),
      hasError: !!this.rulesError(),
    }),
    loader: async ({ params }) => {
      if (params.hasError) {
        return 0;
      }

      const svc = params.object === 'people' ? this.personsSvc : this.householdsSvc;
      if (!params.hasRules) {
        return await svc.count();
      } else {
        const res = (await svc.getAll({
          advancedFilterModel: params.rules,
          limit: 1,
        })) as { count: number };
        return res?.count ?? 0;
      }
    },
  });

  protected readonly matchCount = computed(() => {
    const val = this.matchCountResource.value();
    return val !== undefined ? val : null;
  });

  protected readonly counting = this.matchCountResource.isLoading;

  protected readonly previewTags = computed(() => this.flattenPositiveTags(this.rulesRoot()));

  // Wizard state
  protected step = signal<1 | 2 | 3 | 4>(1);

  protected back() {
    const s = this.step();
    if (s > 1) this.step.set((s - 1) as unknown as 1 | 2 | 3 | 4);
  }

  protected flattenPositiveTags(group: QueryBuilderGroupNode): string[] {
    const out: string[] = [];
    const walk = (rules: QueryBuilderNode[]) => {
      for (const it of rules) {
        if (it.kind === 'rule') {
          const r = it as { kind: 'rule'; op: 'eq' | 'neq'; value: string };
          if (r.op === 'eq' && r.value) out.push(r.value);
        } else if (it.kind === 'group') {
          walk(it.rules as QueryBuilderNode[]);
        }
      }
    };
    walk(group.rules);
    return Array.from(new Set(out));
  }

  protected goto(step: 1 | 2 | 3 | 4) {
    this.step.set(step);
  }

  protected next() {
    const s = this.step();
    if (s < 4) this.step.set((s + 1) as unknown as 1 | 2 | 3 | 4);
  }

  protected onRulesChanged() {
    this.rulesRoot.update((g) => cloneQueryBuilderNode(g) as QueryBuilderGroupNode);
    this.peopleGrid()?.triggerFilterChanged();
    this.householdGrid()?.triggerFilterChanged();
  }

  protected save(done: (() => void) | Event) {
    let doneFn: () => void = () => {
      /* no-op default */
    };
    if (done instanceof Event) {
      done.preventDefault();
    } else if (typeof done === 'function') {
      doneFn = done;
    }

    this.form().markAsTouched();
    if (this.form().invalid()) return;
    if (this.saving()) return;

    const formValue = this.payload();
    const listId = this.id();
    if (!this.isNew() && !listId) return;

    this.saving.set(true);
    const end = this._loading.begin();
    let savePromise;

    if (this.isNew()) {
      const payload: AddListType = {
        name: formValue.name,
        description: formValue.description || null,
        object: formValue.object,
        is_dynamic: formValue.is_dynamic,
      };

      if (payload.is_dynamic) {
        // Dynamic lists: use current filters/search as definition
        const def =
          payload.object === 'people' ? this.peopleGrid()?.getDefinition() : this.householdGrid()?.getDefinition();
        const tags_expression = this.rulesRoot();
        payload.definition = {
          ...(def ?? {}),
          filterModel: { ...(def?.filterModel ?? {}), tags_expression },
          advancedFilterModel: tags_expression,
          // provide a simplified positive-tags list for compatibility
          tags: this.flattenPositiveTags(tags_expression),
        };
      } else {
        // Static lists: persist a snapshot based on the full filter definition
        const def =
          payload.object === 'people' ? this.peopleGrid()?.getDefinition() : this.householdGrid()?.getDefinition();
        const tags_expression = this.rulesRoot();
        payload.definition = {
          ...(def ?? {}),
          filterModel: { ...(def?.filterModel ?? {}), tags_expression },
          advancedFilterModel: tags_expression,
          tags: this.flattenPositiveTags(tags_expression),
        };
        // Do not send member_ids limited to the current page; backend will expand definition to all matches
        delete (payload as Record<string, unknown>)['member_ids'];
      }
      savePromise = this.listsSvc.add(payload);
    } else {
      const payload: UpdateListType = {
        name: formValue.name,
        description: formValue.description || null,
      };
      savePromise = this.listsSvc.update(listId ?? '', payload);
    }

    savePromise
      .then(async () => {
        this.alertSvc.showSuccess(this.isNew() ? 'List added' : 'List updated');
        this.listsRefresh.trigger();
        doneFn();
        if (this.isNew()) {
          await this.router.navigate(['/lists']);
        } else {
          await this.router.navigate(['/lists', listId ?? '']);
        }
      })
      .catch((err: any) => {
        const message =
          err instanceof Error && err.message
            ? err.message
            : isRecord(err) &&
                isRecord(err['data']) &&
                typeof err['data']['message'] === 'string' &&
                err['data']['message']
              ? err['data']['message']
              : this.isNew()
                ? 'Failed to add list'
                : 'Failed to update list';
        this.alertSvc.showError(message);
        doneFn();
      })
      .finally(() => {
        end();
        this.saving.set(false);
      });
  }

  protected async deleteList() {
    const id = this.id();
    if (this.isNew() || !id) return;
    let consumers: unknown = null;
    try {
      consumers = await this.listsSvc.getConsumers(id);
    } catch {
      // Fall back to the generic body if consumers can't be loaded.
    }
    const listName = this.payload().name;
    const confirmed = await this.dialogs.confirm({
      title: 'Delete list',
      message: buildDeleteConfirmMessage(listName, consumers),
      variant: 'danger',
      confirmText: 'Delete list',
      // Safe action styled primary (§8): "Keep list" is the reassuring default.
      cancelText: 'Keep list',
    });
    if (!confirmed) return;

    const end = this._loading.begin();
    try {
      await this.listsSvc.delete(id);
      this.listsRefresh.trigger();
      this.alertSvc.showSuccess('List deleted');
      await this.router.navigate(['/lists']);
    } catch (err) {
      const message =
        err instanceof Error && err.message
          ? err.message
          : isRecord(err) &&
              isRecord(err['data']) &&
              typeof err['data']['message'] === 'string' &&
              err['data']['message']
            ? err['data']['message']
            : 'Unable to delete list';
      this.alertSvc.showError(message);
    } finally {
      end();
    }
  }

  private evalGroupWithRow(group: QueryBuilderGroupNode, tagSet: Set<string>, row: any): boolean {
    const results = group.rules.map((it) =>
      this.isRule(it)
        ? this.evalRule(it, tagSet, row)
        : this.evalGroupWithRow(it as QueryBuilderGroupNode, tagSet, row),
    );
    if (group.conjunction === 'AND') return results.every(Boolean);
    return results.some(Boolean);
  }

  private evalRule(rule: { field: string; op: string; value?: any }, tagSet: Set<string>, row: any): boolean {
    const field = rule.field;
    const op = rule.op;
    const val = rule.value;

    if (field === 'tag' || field === 'tags' || field === 'issues') {
      if (!val) return false;
      const has = tagSet.has(val);
      return op === 'eq' || op === 'equals' || op === 'contains' ? has : !has;
    }

    // For other fields, retrieve the row value
    const rowVal = String(row?.[field] ?? '')
      .trim()
      .toLowerCase();
    const searchVal = String(val ?? '')
      .trim()
      .toLowerCase();

    const isEmpty = rowVal.length === 0;

    switch (op) {
      case 'empty':
      case 'isEmpty':
        return isEmpty;
      case 'notempty':
      case 'isNotEmpty':
        return !isEmpty;
      case 'equals':
      case 'eq':
        return rowVal === searchVal;
      case 'notEquals':
      case 'neq':
        return rowVal !== searchVal;
      case 'contains':
        return rowVal.includes(searchVal);
      case 'notContains':
        return !rowVal.includes(searchVal);
      case 'startsWith':
        return rowVal.startsWith(searchVal);
      case 'endsWith':
        return rowVal.endsWith(searchVal);
      default:
        return true;
    }
  }

  private isRule(item: QueryBuilderNode): item is {
    kind: 'rule';
    id: string;
    field: string;
    op: string;
    value?: any;
  } {
    return item.kind === 'rule';
  }

  private validateRules(): string | null {
    let invalid = false;
    const walk = (rules: QueryBuilderNode[]) => {
      for (const it of rules) {
        if (it.kind === 'rule') {
          const r = it as { field: string; op: string; value?: string };
          const valueless = ['isEmpty', 'isNotEmpty', 'empty', 'notempty'].includes(r.op);
          if (!valueless && (!r.value || !String(r.value).trim())) {
            invalid = true;
          }
        } else if (it.kind === 'group') {
          walk(it.rules as QueryBuilderNode[]);
        }
      }
    };
    walk(this.rulesRoot().rules);
    if (invalid) return 'Complete all rules (enter a search term or value)';
    return null;
  }

  private hasAnyRule(group: QueryBuilderGroupNode): boolean {
    const stack: QueryBuilderNode[] = [...group.rules];
    while (stack.length) {
      const item = stack.pop();
      if (!item) break;
      if (item.kind === 'rule') return true;
      if (item.kind === 'group') stack.push(...item.rules);
    }
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
