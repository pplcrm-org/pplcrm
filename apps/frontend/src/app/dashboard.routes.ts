import type { Routes } from '@angular/router';
import { roleGuard } from './auth/role-guard';
import {
  companyRecordIdResolver,
  householdRecordIdResolver,
  personRecordIdResolver,
} from './services/record-slug.resolver';
import { unsavedChangesGuard } from './services/unsaved-changes-guard';
import { PersonalSettingsRedirect } from './experiences/settings/personal-settings-redirect';
import { formsUrlMatcher } from './experiences/forms/forms-url-matcher';

export const dashboardRoutes: Routes = [
  { path: '', redirectTo: 'dashboard', pathMatch: 'full' },

  {
    path: 'dashboard',
    loadComponent: () => import('./experiences/summary/summary').then((m) => m.Summary),
    // `breadcrumb` feeds BreadcrumbDefaultsService: every route publishes a navbar
    // trail on NavigationEnd, so no page ever shows an empty or stale strip.
    data: { breadcrumb: 'Dashboard' },
  },
  // Back-compat: old /summary links (bookmarks, pins, deep links) redirect to /dashboard.
  { path: 'summary', redirectTo: 'dashboard', pathMatch: 'full' },

  {
    path: 'people',
    data: { breadcrumb: 'People' },
    children: [
      {
        path: '',
        loadComponent: () => import('./experiences/persons/ui/persons-grid').then((m) => m.PersonsGrid),
        data: { shouldReuse: true, key: 'persongridroot' },
      },
      {
        path: 'add',
        loadComponent: () => import('./experiences/persons/ui/person-form').then((m) => m.PersonForm),
        canDeactivate: [unsavedChangesGuard],
        data: { breadcrumb: 'New person' },
      },
      {
        path: ':id',
        loadComponent: () => import('./experiences/persons/ui/person-view').then((m) => m.PersonView),
        // Slug-aware: the URL may carry /people/amira-hassan; the component's
        // `id` input always receives the numeric id (route data wins over params).
        resolve: { id: personRecordIdResolver },
      },
      {
        path: ':id/edit',
        loadComponent: () => import('./experiences/persons/ui/person-form').then((m) => m.PersonForm),
        canDeactivate: [unsavedChangesGuard],
        resolve: { id: personRecordIdResolver },
      },
    ],
  },

  {
    path: 'households',
    data: { breadcrumb: 'Households' },
    children: [
      {
        path: '',
        loadComponent: () => import('./experiences/households/ui/households-grid').then((m) => m.HouseholdsGrid),
        data: { shouldReuse: true, key: 'householdsgridroot' },
      },
      {
        path: 'add',
        loadComponent: () => import('./experiences/households/ui/household-form').then((m) => m.HouseholdForm),
        canDeactivate: [unsavedChangesGuard],
        data: { breadcrumb: 'New household' },
      },
      {
        path: ':id',
        loadComponent: () => import('./experiences/households/ui/household-view').then((m) => m.HouseholdView),
        resolve: { id: householdRecordIdResolver },
      },
      {
        path: ':id/edit',
        loadComponent: () => import('./experiences/households/ui/household-form').then((m) => m.HouseholdForm),
        canDeactivate: [unsavedChangesGuard],
        resolve: { id: householdRecordIdResolver },
      },
    ],
  },
  {
    path: 'duplicates',
    data: { breadcrumb: 'Duplicates' },
    children: [
      {
        path: '',
        loadComponent: () =>
          import('./experiences/duplicates/duplicate-selection').then((m) => m.DuplicateSelectionComponent),
      },
      {
        path: 'people',
        loadComponent: () =>
          import('./experiences/duplicates/duplicates-people').then((m) => m.PeopleDuplicatesComponent),
        data: { breadcrumb: 'People' },
      },
      {
        path: 'households',
        loadComponent: () =>
          import('./experiences/duplicates/duplicates-households').then((m) => m.HouseholdDuplicatesComponent),
        data: { breadcrumb: 'Households' },
      },
      {
        path: 'companies',
        loadComponent: () =>
          import('./experiences/duplicates/duplicates-companies').then((m) => m.CompanyDuplicatesComponent),
        data: { breadcrumb: 'Companies' },
      },
    ],
  },
  {
    path: 'tags',
    loadComponent: () => import('./experiences/tags/ui/tags-admin').then((m) => m.TagsAdmin),
    data: { shouldReuse: true, key: 'tagsadminroot', breadcrumb: 'Tags' },
  },

  {
    path: 'issues',
    loadComponent: () => import('./experiences/tags/ui/issues-admin').then((m) => m.IssuesAdmin),
    data: { shouldReuse: true, key: 'issuesadminroot', breadcrumb: 'Issues' },
  },

  {
    path: 'lists',
    data: { breadcrumb: 'Lists' },
    children: [
      {
        path: '',
        loadComponent: () => import('./experiences/lists/ui/lists-grid').then((m) => m.ListsGridComponent),
        data: { shouldReuse: true, key: 'listsgridroot' },
      },
      {
        path: 'add',
        loadComponent: () => import('./experiences/lists/ui/list-form').then((m) => m.ListForm),
        canDeactivate: [unsavedChangesGuard],
        data: { mode: 'new', breadcrumb: 'New list' },
      },
      {
        path: ':id',
        loadComponent: () => import('./experiences/lists/ui/list-view').then((m) => m.ListView),
      },
      {
        path: ':id/edit',
        loadComponent: () => import('./experiences/lists/ui/list-form').then((m) => m.ListForm),
        canDeactivate: [unsavedChangesGuard],
        data: { mode: 'edit', breadcrumb: 'Edit list' },
      },
    ],
  },

  {
    path: 'newsletters',
    data: { breadcrumb: 'Newsletters' },
    children: [
      {
        path: '',
        loadComponent: () => import('./experiences/newsletters/ui/newsletters-page').then((m) => m.NewslettersPage),
        pathMatch: 'full',
        data: { shouldReuse: true, key: 'newslettersgridroot' },
      },
      {
        path: 'add',
        loadComponent: () =>
          import('./experiences/newsletters/ui/newsletter-add').then((m) => m.NewsletterAddComponent),
        canDeactivate: [unsavedChangesGuard],
        data: { breadcrumb: 'New newsletter' },
      },
      {
        path: ':id/edit',
        loadComponent: () =>
          import('./experiences/newsletters/ui/newsletter-add').then((m) => m.NewsletterAddComponent),
        canDeactivate: [unsavedChangesGuard],
        data: { breadcrumb: 'Edit draft' },
      },
      {
        path: ':id',
        loadComponent: () =>
          import('./experiences/newsletters/ui/newsletter-detail').then((m) => m.NewsletterDetailComponent),
      },
    ],
  },

  {
    path: 'automations',
    data: { breadcrumb: 'Automations' },
    children: [
      {
        path: '',
        loadComponent: () => import('./experiences/workflows/ui/workflows-grid').then((m) => m.WorkflowsGridComponent),
        pathMatch: 'full',
        data: { shouldReuse: true, key: 'workflowsgridroot' },
      },
      {
        path: 'add',
        loadComponent: () => import('./experiences/workflows/ui/workflow-form').then((m) => m.WorkflowFormComponent),
        canDeactivate: [unsavedChangesGuard],
        data: { breadcrumb: 'New automation' },
      },
      {
        path: ':id',
        loadComponent: () => import('./experiences/workflows/ui/workflow-form').then((m) => m.WorkflowFormComponent),
        canDeactivate: [unsavedChangesGuard],
      },
    ],
  },
  // Back-compat: old /workflows links redirect to /automations (prefix keeps :id/add).
  { path: 'workflows', redirectTo: 'automations', pathMatch: 'prefix' },

  {
    path: 'events',
    children: [
      {
        path: 'shifts',
        children: [
          {
            path: 'add',
            loadComponent: () => import('./experiences/shifts/ui/shift-form').then((m) => m.ShiftFormComponent),
            canDeactivate: [unsavedChangesGuard],
          },
          {
            path: ':id',
            loadComponent: () => import('./experiences/shifts/ui/shift-view').then((m) => m.ShiftViewComponent),
          },
          {
            path: ':id/edit',
            loadComponent: () => import('./experiences/shifts/ui/shift-form').then((m) => m.ShiftFormComponent),
            canDeactivate: [unsavedChangesGuard],
          },
        ],
      },
      {
        path: 'pages',
        children: [
          {
            path: 'add',
            loadComponent: () => import('./experiences/events/ui/event-form').then((m) => m.EventFormComponent),
            canDeactivate: [unsavedChangesGuard],
          },
          {
            path: ':id',
            loadComponent: () => import('./experiences/events/ui/event-view').then((m) => m.EventViewComponent),
          },
          {
            path: ':id/edit',
            loadComponent: () => import('./experiences/events/ui/event-form').then((m) => m.EventFormComponent),
            canDeactivate: [unsavedChangesGuard],
          },
        ],
      },
    ],
  },

  {
    path: 'donations',
    data: { breadcrumb: { term: 'nav.donations' } },
    children: [
      {
        path: '',
        loadComponent: () => import('./experiences/donations/ui/donations-grid').then((m) => m.DonationsGridComponent),
        data: { shouldReuse: true, key: 'donationsgridroot', scope: 'all' },
      },
      {
        path: 'one-time',
        loadComponent: () => import('./experiences/donations/ui/donations-grid').then((m) => m.DonationsGridComponent),
        data: { shouldReuse: true, key: 'donationsgridonetime', breadcrumb: 'One-time', scope: 'one-time' },
      },
      {
        path: 'pledges',
        loadComponent: () => import('./experiences/donations/ui/pledges-grid').then((m) => m.PledgesGridComponent),
        data: { shouldReuse: true, key: 'pledgesgridroot', breadcrumb: 'Monthly pledges' },
      },
      {
        path: 'receipts',
        loadComponent: () =>
          import('./experiences/donations/ui/donation-receipts-page').then((m) => m.DonationReceiptsPageComponent),
        data: { shouldReuse: true, key: 'donationreceiptspage', breadcrumb: 'Receipts & statements' },
      },
      {
        path: ':id',
        loadComponent: () => import('./experiences/donations/ui/donation-view').then((m) => m.DonationViewComponent),
        data: { breadcrumb: 'Gift' },
      },
    ],
  },

  {
    path: 'inbox',
    loadComponent: () => import('./experiences/emails/ui/email-client/email-client').then((m) => m.EmailClient),
    data: { breadcrumb: 'Inbox' },
  },
  {
    path: 'tasks',
    data: { breadcrumb: 'Tasks' },
    children: [
      {
        path: '',
        loadComponent: () => import('./experiences/tasks/ui/tasks-list').then((m) => m.TasksList),
        data: { shouldReuse: true, key: 'taskslistroot' },
      },
      {
        path: 'add',
        loadComponent: () => import('./experiences/tasks/ui/task-add').then((m) => m.TaskAddComponent),
        data: { breadcrumb: 'New task' },
      },
      // Must precede ':id' — otherwise the wildcard param route would swallow it.
      {
        path: 'board',
        loadComponent: () => import('./experiences/tasks/ui/tasks-board').then((m) => m.TasksBoard),
        data: { shouldReuse: true, key: 'tasksboardroot', breadcrumb: 'Board' },
      },
      {
        path: ':id',
        loadComponent: () => import('./experiences/tasks/ui/task-view').then((m) => m.TaskView),
      },
    ],
  },
  // Back-compat: old /board links (bookmarks, the `g b` shortcut chord) redirect to /tasks/board.
  { path: 'board', redirectTo: 'tasks/board', pathMatch: 'full' },

  {
    path: 'canvassing',
    data: { breadcrumb: { term: 'nav.canvassing' } },
    children: [
      {
        path: '',
        loadComponent: () => import('./experiences/canvassing/ui/canvassing-page').then((m) => m.CanvassingPage),
      },
      {
        path: ':id',
        loadComponent: () => import('./experiences/canvassing/ui/turf-detail-page').then((m) => m.TurfDetailPage),
      },
    ],
  },

  // Back-compat: campaign pages used to live at the top level. They are Workspace
  // settings pages, so they now live under /workspace/campaigns and the old URLs
  // (bookmarks, links in older help articles) redirect there.
  { path: 'campaigns', redirectTo: '/workspace/campaigns', pathMatch: 'full' },
  { path: 'campaigns/add', redirectTo: '/workspace/campaigns/add' },
  { path: 'campaigns/:id/edit', redirectTo: '/workspace/campaigns/:id/edit' },
  { path: 'campaigns/:id', redirectTo: '/workspace/campaigns/:id' },

  {
    path: 'teams',
    data: { breadcrumb: 'Teams' },
    children: [
      {
        path: '',
        loadComponent: () => import('./experiences/teams/ui/teams-grid').then((m) => m.TeamsGridComponent),
        data: { shouldReuse: true, key: 'teamsgridroot' },
      },
      {
        path: 'add',
        loadComponent: () => import('./experiences/teams/ui/team-form').then((m) => m.TeamFormComponent),
        data: { mode: 'new', breadcrumb: 'New team' },
        canDeactivate: [unsavedChangesGuard],
      },
      {
        path: ':id',
        loadComponent: () => import('./experiences/teams/ui/team-view').then((m) => m.TeamViewComponent),
      },
      {
        path: ':id/edit',
        loadComponent: () => import('./experiences/teams/ui/team-form').then((m) => m.TeamFormComponent),
        data: { mode: 'edit' },
        canDeactivate: [unsavedChangesGuard],
      },
    ],
  },
  {
    path: 'deliveries',
    data: { breadcrumb: { term: 'nav.deliveries' } },
    children: [
      {
        path: '',
        loadComponent: () =>
          import('./experiences/deliveries/ui/deliveries-requests').then((m) => m.DeliveriesRequests),
        data: { shouldReuse: true, key: 'deliveriesrequestsroot' },
      },
      {
        path: 'plan',
        loadComponent: () => import('./experiences/deliveries/ui/deliveries-plan').then((m) => m.DeliveriesPlan),
        data: { breadcrumb: 'Plan routes' },
      },
      {
        path: 'routes',
        loadComponent: () => import('./experiences/deliveries/ui/deliveries-routes').then((m) => m.DeliveriesRoutes),
        data: { breadcrumb: 'Routes' },
      },
      {
        path: 'routes/:id',
        loadComponent: () =>
          import('./experiences/deliveries/ui/deliveries-route-detail').then((m) => m.DeliveriesRouteDetail),
        // Default until the page loads and publishes the route's name itself.
        data: { breadcrumb: [{ label: 'Routes', route: '/deliveries/routes' }] },
      },
    ],
  },
  {
    path: 'users',
    canActivate: [roleGuard],
    data: { breadcrumb: 'Users' },
    children: [
      {
        path: '',
        loadComponent: () => import('./experiences/users/ui/users-page').then((m) => m.UsersPageComponent),
        data: { shouldReuse: true, key: 'usersgridroot' },
      },
      {
        // View and edit merged into one page (approved 2026-07-10 design) — the
        // unsaved-changes guard now protects the view, and old edit links redirect.
        path: ':id',
        loadComponent: () => import('./experiences/users/ui/user-view').then((m) => m.UserViewComponent),
        canDeactivate: [unsavedChangesGuard],
      },
      { path: ':id/edit', redirectTo: ':id' },
    ],
  },
  {
    // Companion access approvals: volunteers who verified their contact and
    // are waiting for an admin to unlock their turf/route link.
    path: 'volunteer-access',
    canActivate: [roleGuard],
    loadComponent: () =>
      import('./experiences/volunteer-access/ui/volunteer-access-page').then((m) => m.VolunteerAccessPage),
    data: { breadcrumb: 'Approvals' },
  },
  {
    // One matcher child rather than four sibling routes — see forms-url-matcher.ts for why.
    // /forms, /forms/new, /forms/:id and /forms/:id/edit all land on the same page instance.
    path: 'forms',
    data: { breadcrumb: 'Forms' },
    children: [
      {
        matcher: formsUrlMatcher,
        loadComponent: () => import('./experiences/forms/ui/forms-page').then((m) => m.FormsPageComponent),
        data: { shouldReuse: true, key: 'formspageroot' },
      },
    ],
  },
  {
    path: 'donation-pages',
    children: [
      {
        path: 'add',
        loadComponent: () =>
          import('./experiences/fundraising/ui/fundraising-form').then((m) => m.FundraisingFormComponent),
        canDeactivate: [unsavedChangesGuard],
        // Flat route that conceptually nests under Donations — pre-built trail.
        data: { breadcrumb: [{ label: 'Donations', route: '/donations' }, { label: 'New donation page' }] },
      },
      {
        path: ':id',
        loadComponent: () => import('./experiences/forms/ui/form-view').then((m) => m.FormViewComponent),
        data: { backRoute: '/donations' },
      },
      {
        path: ':id/edit',
        loadComponent: () =>
          import('./experiences/fundraising/ui/fundraising-form').then((m) => m.FundraisingFormComponent),
        canDeactivate: [unsavedChangesGuard],
        data: { breadcrumb: [{ label: 'Donations', route: '/donations' }, { label: 'Edit donation page' }] },
      },
    ],
  },

  // Personal settings are the avatar-menu dialog, not a page. These routes stay because
  // notification emails link to /settings/notifications and old bookmarks exist: they land on
  // the dashboard with ?settings=<section>, which the navbar reads to open the dialog.
  {
    path: 'settings',
    children: [
      { path: '', redirectTo: 'notifications', pathMatch: 'full' },
      { path: ':section', component: PersonalSettingsRedirect },
    ],
  },
  {
    path: 'workspace',
    canActivate: [roleGuard],
    data: { breadcrumb: 'Workspace' },
    children: [
      { path: '', redirectTo: 'organization', pathMatch: 'full' },
      // Campaigns §15 — the Campaigns settings section lists the campaigns; these
      // deep pages are its detail/add/edit views, so they nest under its own URL.
      // They must be declared before ':section', which would otherwise be tried first.
      {
        path: 'campaigns/add',
        loadComponent: () => import('./experiences/campaigns/ui/campaign-form').then((m) => m.CampaignFormComponent),
        data: { mode: 'new' },
        canDeactivate: [unsavedChangesGuard],
      },
      {
        path: 'campaigns/:id/edit',
        loadComponent: () => import('./experiences/campaigns/ui/campaign-form').then((m) => m.CampaignFormComponent),
        data: { mode: 'edit' },
        canDeactivate: [unsavedChangesGuard],
      },
      {
        path: 'campaigns/:id',
        loadComponent: () => import('./experiences/campaigns/ui/campaign-view').then((m) => m.CampaignViewComponent),
      },
      {
        path: ':section',
        loadComponent: () => import('./experiences/settings/settings-page').then((m) => m.SettingsPage),
        canDeactivate: [unsavedChangesGuard],
        data: { mode: 'workspace' },
      },
    ],
  },
  // Back-compat: old /configuration links (bookmarks, help articles pre-rename) redirect to /workspace
  {
    path: 'configuration',
    redirectTo: '/workspace',
    pathMatch: 'prefix',
  },
  {
    path: 'billing',
    redirectTo: '/workspace/billing',
    pathMatch: 'full',
  },
  // Back-compat: Files moved into Workspace settings → Storage.
  {
    path: 'files',
    redirectTo: '/workspace/storage',
    pathMatch: 'full',
  },
  {
    path: 'profile',
    loadComponent: () => import('./experiences/profile/profile-page').then((m) => m.ProfilePage),
    canDeactivate: [unsavedChangesGuard],
    data: { breadcrumb: 'Profile' },
  },
  {
    // A route rather than a modal: resumable, deep-linkable, back-button honest, and the sidebar
    // stays visible so "where am I" keeps its answer. Admin/owner only, because demo.exit and
    // most of what it writes are adminOrOwnerProcedure — an editor landing here would collect a
    // string of 403s instead of a setup flow.
    path: 'go-live',
    canActivate: [roleGuard],
    loadComponent: () => import('./experiences/go-live/go-live-page').then((m) => m.GoLivePage),
    data: { breadcrumb: 'Go live' },
  },
  {
    path: 'imports/new',
    loadComponent: () => import('./experiences/imports/ui/import-wizard').then((m) => m.ImportWizard),
    // Flat route that conceptually nests under the Imports tab of the history page.
    data: { breadcrumb: [{ label: 'Imports', route: '/imports' }, { label: 'New import' }] },
  },
  {
    path: 'imports',
    loadComponent: () => import('./experiences/imports/ui/imports-page').then((m) => m.ImportsPage),
    // Default matches the page's initial tab — the page publishes the tab-aware
    // crumb ("Imports"/"Exports") itself on every tab switch.
    data: { breadcrumb: 'Imports' },
  },
  {
    // Wave 1E (spec §17): Exports folded into the Import/export History page's
    // Exports tab — redirect the old standalone route rather than 404 stale links.
    path: 'exports',
    redirectTo: '/imports',
    pathMatch: 'full',
  },
  {
    path: 'companies',
    data: { breadcrumb: 'Companies' },
    children: [
      {
        path: '',
        loadComponent: () => import('./experiences/companies/ui/companies-grid').then((m) => m.CompaniesGrid),
        data: { shouldReuse: true, key: 'companiesgridroot' },
      },
      {
        path: 'add',
        loadComponent: () => import('./experiences/companies/ui/company-form').then((m) => m.CompanyForm),
        canDeactivate: [unsavedChangesGuard],
        data: { breadcrumb: 'New company' },
      },
      {
        path: ':id',
        loadComponent: () => import('./experiences/companies/ui/company-view').then((m) => m.CompanyView),
        resolve: { id: companyRecordIdResolver },
      },
      {
        path: ':id/edit',
        loadComponent: () => import('./experiences/companies/ui/company-form').then((m) => m.CompanyForm),
        canDeactivate: [unsavedChangesGuard],
        resolve: { id: companyRecordIdResolver },
      },
    ],
  },
  {
    path: 'activity',
    loadComponent: () => import('./experiences/activity/ui/activity-feed').then((m) => m.ActivityFeed),
    data: { breadcrumb: 'Activity' },
  },
  // Back-compat: old /activities links redirect to /activity.
  { path: 'activities', redirectTo: 'activity', pathMatch: 'full' },
  {
    path: 'help',
    data: { breadcrumb: 'Help' },
    children: [
      {
        path: '',
        loadComponent: () => import('./experiences/help/ui/help-home').then((m) => m.HelpHomePage),
      },
      {
        path: ':id',
        loadComponent: () => import('./experiences/help/ui/help-article').then((m) => m.HelpArticlePage),
      },
    ],
  },
];
