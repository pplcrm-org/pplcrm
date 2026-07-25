import { Component, computed, effect, inject, input, OnInit, signal, untracked } from '@angular/core';
import { form, FormField, validateStandardSchema } from '@angular/forms/signals';
import { Router, RouterModule } from '@angular/router';
import { AlertService } from '@uxcommon/components/alerts/alert-service';
import { Card as PcCard } from '@uxcommon/components/card/card';
import { DetailHeader as PcDetailHeader } from '@uxcommon/components/detail-header/detail-header';
import type { PcBreadcrumb } from '@uxcommon/components/breadcrumbs/breadcrumbs';
import { Icon } from '@uxcommon/components/icons/icon';
import { Input as PcInput } from '@uxcommon/components/input/input';
import { Select as PcSelect } from '@uxcommon/components/select/select';
import { Textarea as PcTextarea } from '@uxcommon/components/textarea/textarea';
import { createLoadingGate } from '@uxcommon/loading-gate';
import { AddTeamObj, AddTeamType, IAuthUser, UpdateTeamType } from '../../../../../../../libs/common/src';
import { ConfirmDialogService } from '../../../services/shared-dialog.service';
import { injectUnsavedChanges } from '@frontend/services/unsaved-changes-guard';

import { UserService } from '../../../services/user.service';
import { ListsService } from '../../lists/services/lists-service';
import { PersonsService } from '../../persons/services/persons-service';
import { TasksService } from '../../tasks/services/tasks-service';
import { TeamDetail, TeamsService } from '../services/teams-service';

interface PersonOption {
  email: string | null;
  id: string;
  label: string;
}

import { DatePipe } from '@angular/common';
import { EmptyState } from '@uxcommon/components/empty-state/empty-state';

@Component({
  selector: 'pc-team-form',
  imports: [EmptyState, FormField, RouterModule, Icon, DatePipe, PcDetailHeader, PcInput, PcTextarea, PcSelect, PcCard],
  templateUrl: './team-form.html',
})
export class TeamFormComponent implements OnInit {
  readonly id = input<string>();

  private readonly alerts = inject(AlertService);
  private readonly persons = inject(PersonsService);
  private readonly router = inject(Router);
  private readonly teams = inject(TeamsService);
  private readonly lists = inject(ListsService);
  private readonly userService = inject(UserService);
  private readonly tasksSvc = inject(TasksService);
  private readonly dialogs = inject(ConfirmDialogService);

  protected readonly isNew = computed(() => !this.id());

  protected readonly detail = signal<TeamDetail | null>(null);
  protected readonly error = signal<string | null>(null);

  protected readonly crumbs = computed<PcBreadcrumb[]>(() => {
    const teams: PcBreadcrumb = { label: 'Teams', route: '/teams' };
    const id = this.id();
    if (id) {
      return [teams, { label: this.detail()?.name || 'Team', route: ['/teams', id] }, { label: 'Edit' }];
    }
    return [teams, { label: 'New team' }];
  });

  protected readonly payload = signal({
    name: '',
    description: '',
    team_captain_id: '',
    team_lead_user_id: '',
    volunteer_ids: [] as string[],
    list_ids: [] as string[],
  });

  protected readonly form = form(this.payload, (p) => {
    validateStandardSchema(p, AddTeamObj);
  });

  protected readonly unsavedChanges = injectUnsavedChanges(this.form, this.payload);

  private readonly _loading = createLoadingGate();
  protected readonly loading = this._loading.visible;
  protected signalPeople = signal<PersonOption[]>([]);
  protected readonly people = computed(() => this.signalPeople());
  protected readonly users = signal<IAuthUser[]>([]);
  protected readonly availableLists = signal<any[]>([]);
  protected readonly assignedLists = signal<any[]>([]);
  protected readonly teamTasks = signal<any[]>([]);
  protected readonly saving = signal(false);
  protected readonly volunteers = computed(() => this.detail()?.volunteers ?? []);

  constructor() {
    effect(() => {
      const options = this.people();
      if (options.length === 0) return;

      const current = untracked(this.payload);
      let nextCaptain = current.team_captain_id;
      let changed = false;

      if (nextCaptain && !options.some((p) => p.id === nextCaptain)) {
        nextCaptain = '';
        changed = true;
      }

      const currentVolunteers = current.volunteer_ids ?? [];
      const validIds = currentVolunteers.filter((id) => options.some((p) => p.id === id));
      if (validIds.length !== currentVolunteers.length) {
        changed = true;
      }

      if (changed) {
        this.payload.update((p) => ({
          ...p,
          team_captain_id: nextCaptain,
          volunteer_ids: validIds,
        }));
      }
    });
  }

  public ngOnInit(): void {
    void this.initialize();
  }
  private async initialize(): Promise<void> {
    const end = this._loading.begin();
    try {
      await Promise.all([this.loadPeople(), this.loadUsers(), this.loadLists(), this.loadTeam()]);

      if (this.isNew()) {
        const state = window.history.state;
        if (state && state.cloneData) {
          const sourceTeamId = state.cloneData.id;
          if (sourceTeamId) {
            try {
              const teamDetail = await this.teams.getById(sourceTeamId);
              this.payload.set({
                name: teamDetail.name ? `${teamDetail.name} (Copy)` : '',
                description: teamDetail.description ?? '',
                team_captain_id: teamDetail.team_captain_id ?? '',
                team_lead_user_id: teamDetail.team_lead_user_id ?? '',
                volunteer_ids: teamDetail.volunteers?.map((v) => v.id) ?? [],
                list_ids: teamDetail.list_ids ?? [],
              });
              this.assignedLists.set(teamDetail.lists ?? []);
            } catch (err) {
              console.error('Failed to load source team details for cloning', err);
              const data = state.cloneData;
              this.payload.set({
                name: data.name ? `${data.name} (Copy)` : '',
                description: data.description ?? '',
                team_captain_id: data.team_captain_id ?? '',
                team_lead_user_id: data.team_lead_user_id ?? '',
                volunteer_ids: [],
                list_ids: [],
              });
            }
          }
        }
      }
    } finally {
      end();
    }
  }

  protected captainLabel(captainId: string | null) {
    if (!captainId) return '—';
    const person = this.people().find((p) => p.id === captainId);
    return person?.label ?? '—';
  }

  protected isVolunteerSelected(id: string): boolean {
    return this.payload().volunteer_ids?.includes(id) ?? false;
  }

  protected onVolunteersChange(event: Event) {
    const select = event.target as HTMLSelectElement;
    const selectedOptions = Array.from(select.selectedOptions).map((o) => o.value);

    this.payload.update((p) => ({
      ...p,
      volunteer_ids: selectedOptions,
    }));
    this.form.volunteer_ids().markAsDirty();
  }

  protected isListSelected(id: string): boolean {
    return this.payload().list_ids?.includes(id) ?? false;
  }

  protected onListsChange(event: Event) {
    const select = event.target as HTMLSelectElement;
    const selectedOptions = Array.from(select.selectedOptions).map((o) => o.value);

    this.payload.update((p) => ({
      ...p,
      list_ids: selectedOptions,
    }));
    this.form.list_ids().markAsDirty();

    const matching = this.availableLists().filter((l) => selectedOptions.includes(l.id));
    this.assignedLists.set(matching);
  }

  protected async deleteTeam() {
    if (!this.id()) return;
    const confirmed = await this.dialogs.confirm({
      title: 'Delete Team',
      message: 'Are you sure you want to delete this team? This action cannot be undone.',
      variant: 'danger',
      confirmText: 'Delete',
    });
    if (!confirmed) return;
    this.saving.set(true);
    try {
      await this.teams.delete(this.id()!);
      this.teams.triggerRefresh();
      this.alerts.showSuccess('Team deleted');
      await this.router.navigate(['/teams']);
    } catch (err) {
      const message =
        err instanceof Error && err.message
          ? err.message
          : isRecord(err) &&
              isRecord(err['data']) &&
              typeof err['data']['message'] === 'string' &&
              err['data']['message']
            ? err['data']['message']
            : 'Unable to delete team';
      this.error.set(message);
      this.alerts.showError(message);
    } finally {
      this.saving.set(false);
    }
  }

  public canDeactivate(): Promise<boolean> {
    // stayPut: the router is already navigating away, so the guard-time save must not navigate.
    return this.unsavedChanges.confirmDiscardIfDirty(this.detail()?.name || 'this team', () =>
      this.save(undefined, true),
    );
  }

  protected async save(done?: (() => void) | Event, stayPut = false): Promise<boolean> {
    if (done instanceof Event) {
      done.preventDefault();
    }

    this.form().markAsTouched();
    if (this.form().invalid()) {
      return false;
    }

    const raw = this.payload();

    this.saving.set(true);
    this.error.set(null);

    try {
      let result: TeamDetail;
      if (this.isNew()) {
        const payload: AddTeamType = {
          name: raw.name?.trim() ?? '',
          description: raw.description?.trim()?.length ? raw.description.trim() : null,
          team_captain_id: raw.team_captain_id || undefined,
          team_lead_user_id: raw.team_lead_user_id || undefined,
          volunteer_ids: raw.volunteer_ids ?? [],
          list_ids: raw.list_ids ?? [],
        };
        result = await this.teams.add(payload);
        this.teams.triggerRefresh();
        if (typeof done === 'function') {
          done();
        } else if (!stayPut) {
          await this.router.navigate(['/teams']);
        }
      } else if (this.id()) {
        const payload: UpdateTeamType = {
          name: raw.name?.trim() ?? null,
          description: raw.description?.trim()?.length ? raw.description.trim() : null,
          team_captain_id: raw.team_captain_id || null,
          team_lead_user_id: raw.team_lead_user_id || null,
          volunteer_ids: raw.volunteer_ids ?? [],
          list_ids: raw.list_ids ?? [],
        };
        result = await this.teams.update(this.id()!, payload);
        this.teams.triggerRefresh();
        this.detail.set(result);
        this.setForm(result);
        this.form().reset();
        this.alerts.showSuccess('Team updated');
        if (typeof done === 'function') {
          done();
        } else if (!stayPut) {
          await this.router.navigate(['/teams', this.id()]);
        }
        return true;
      } else {
        throw new Error('Missing team identifier');
      }
      this.detail.set(result);
      this.setForm(result);
      this.form().reset();
      this.alerts.showSuccess(this.isNew() ? 'Team created' : 'Team updated');
      return true;
    } catch (err) {
      const message =
        err instanceof Error && err.message
          ? err.message
          : isRecord(err) &&
              isRecord(err['data']) &&
              typeof err['data']['message'] === 'string' &&
              err['data']['message']
            ? err['data']['message']
            : 'Unable to save team';
      this.error.set(message);
      this.alerts.showError(message);
      return false;
    } finally {
      this.saving.set(false);
    }
  }

  private async loadPeople() {
    try {
      // Volunteers are first-class person status now (§15); 'former' is excluded
      // from the eligible-to-add list — someone who quit shouldn't be re-added silently.
      const res = await this.persons.getAll({ limit: 500, volunteerStatus: ['prospective', 'active', 'inactive'] });
      const items = (res?.rows ?? []).map((person: any) => ({
        id: String(person.id ?? ''),
        label: `${person.first_name ?? ''} ${person.last_name ?? ''}`.trim() || person.email || 'Unknown',
        email: person.email ?? null,
      }));
      this.signalPeople.set(items);
    } catch (err) {
      console.error('Failed to load volunteers list', err);
      this.signalPeople.set([]);
    }
  }

  private async loadUsers() {
    try {
      const us = await this.userService.getUsers();
      this.users.set(us || []);
    } catch (err) {
      console.error('Failed to load teammates list', err);
      this.users.set([]);
    }
  }

  private async loadLists() {
    try {
      const res = await this.lists.getAll({ limit: 1000 });
      this.availableLists.set(res?.rows ?? []);
    } catch (err) {
      console.error('Failed to load lists', err);
      this.availableLists.set([]);
    }
  }

  private async loadTeam() {
    if (this.isNew()) {
      this.detail.set(null);
      this.setForm(null);
      return;
    }
    if (!this.id()) {
      this.error.set('Missing team identifier');
      return;
    }

    try {
      const team = await this.teams.getById(this.id()!);
      this.detail.set(team);
      this.setForm(team);
      const res = await this.tasksSvc.getAll({
        filterModel: { team_id: { value: this.id() } },
      } as any);
      this.teamTasks.set(res?.rows ?? []);
    } catch (err) {
      const message =
        err instanceof Error && err.message
          ? err.message
          : isRecord(err) &&
              isRecord(err['data']) &&
              typeof err['data']['message'] === 'string' &&
              err['data']['message']
            ? err['data']['message']
            : 'Failed to load team';
      this.error.set(message);
      this.alerts.showError(message);
    }
  }

  private setForm(team: TeamDetail | null) {
    this.payload.set({
      name: team?.name ?? '',
      description: team?.description ?? '',
      team_captain_id: team?.team_captain_id ?? '',
      team_lead_user_id: team?.team_lead_user_id ?? '',
      volunteer_ids: team?.volunteers?.map((v) => v.id) ?? [],
      list_ids: team?.list_ids ?? [],
    });
    this.assignedLists.set(team?.lists ?? []);
  }

  protected getPriorityClass(priority: string | null | undefined): string {
    const p = String(priority || '').toLowerCase();
    switch (p) {
      case 'urgent':
        return 'badge-error text-error-content';
      case 'high':
        return 'badge-warning text-warning-content';
      case 'medium':
        return 'badge-info text-info-content';
      default:
        return 'badge-ghost';
    }
  }

  protected getStatusClass(status: string | null | undefined): string {
    const s = String(status || '').toLowerCase();
    switch (s) {
      case 'done':
        return 'badge-success text-success-content';
      case 'in_progress':
        return 'badge-info text-info-content';
      case 'waiting':
        return 'badge-error text-error-content';
      case 'archived':
        return 'badge-neutral text-neutral-content';
      default:
        return 'badge-ghost';
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
