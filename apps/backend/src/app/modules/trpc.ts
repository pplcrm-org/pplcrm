import { router } from '../../trpc';
import { AuthRouter } from './auth/trpc.router';
import { EmailsRouter } from './emails/trpc.router';
import { HouseholdsRouter } from './households/trpc.router';
import { ListsRouter } from './lists/trpc.router';
import { NewslettersRouter } from './newsletters/trpc.router';
import { PersonsRouter } from './persons/trpc.router';
import { TagsRouter } from './tags/trpc.router';
import { TasksRouter } from './tasks/trpc.router';
import { UserProfilesRouter } from './userprofiles/trpc.router';
import { TeamsRouter } from './teams/trpc.router';
import { SettingsRouter } from './settings/trpc.router';
import { ImportsRouter } from './imports/trpc.router';
import { MsSyncRouter } from './ms-sync/trpc.router';
import { GoogleSyncRouter } from './google-sync/trpc.router';
import { CompaniesRouter } from './companies/trpc.router';
import { ActivityRouter } from './activity/trpc.router';
import { FilesRouter } from './files/trpc.router';
import { DashboardRouter } from './dashboard/trpc.router';
import { NotificationsRouter } from './notifications/trpc.router';
import { VolunteerRouter } from './volunteer-events/trpc.router';
import { WebFormsRouter } from './web-forms/trpc.router';
import { BillingRouter } from './billing/trpc.router';
import { WorkflowsRouter } from './workflows/trpc.router';
import { DonationsRouter } from './donations/trpc.router';
import { ExportsRouter } from './exports/trpc.router';
import { UsersRouter } from './users/trpc.router';
import { EventsRouter } from './events/trpc.router';
import { PersonConnectionsRouter } from './person-connections/trpc.router';
import { ZapierRouter } from './zapier/zapier.trpc.router';
import { DuplicatesRouter } from './duplicates/trpc.router';
import { CampaignsRouter } from './campaigns/trpc.router';
import { CanvassingRouter } from './canvassing/trpc.router';
import { DeliveriesRouter } from './deliveries/trpc.router';
import { CompanionAccessRouter } from './companion-access/trpc.router';
import { DemoRouter } from './demo/trpc.router';
import { BugReportsRouter } from './bug-reports/trpc.router';

export type TRPCRouter = typeof trpcRouter;

export const trpcRouter = router({
  auth: AuthRouter,
  authusers: AuthRouter,
  userProfiles: UserProfilesRouter,
  households: HouseholdsRouter,
  persons: PersonsRouter,
  tags: TagsRouter,
  lists: ListsRouter,
  tasks: TasksRouter,
  emails: EmailsRouter,
  newsletters: NewslettersRouter,
  teams: TeamsRouter,
  settings: SettingsRouter,
  imports: ImportsRouter,
  msSync: MsSyncRouter,
  googleSync: GoogleSyncRouter,
  companies: CompaniesRouter,
  activity: ActivityRouter,
  files: FilesRouter,
  dashboard: DashboardRouter,
  notifications: NotificationsRouter,
  volunteer: VolunteerRouter,
  webForms: WebFormsRouter,
  billing: BillingRouter,
  donations: DonationsRouter,
  workflows: WorkflowsRouter,
  exports: ExportsRouter,
  users: UsersRouter,
  events: EventsRouter,
  connections: PersonConnectionsRouter,
  zapier: ZapierRouter,
  duplicates: DuplicatesRouter,
  campaigns: CampaignsRouter,
  canvassing: CanvassingRouter,
  deliveries: DeliveriesRouter,
  companionAccess: CompanionAccessRouter,
  demo: DemoRouter,
  bugReports: BugReportsRouter,
});

// Re-export individual routers for convenience.
export { AuthRouter } from './auth/trpc.router';

export { HouseholdsRouter } from './households/trpc.router';

export { PersonsRouter } from './persons/trpc.router';

export { TagsRouter } from './tags/trpc.router';

export { UserProfilesRouter } from './userprofiles/trpc.router';

export { EmailsRouter } from './emails/trpc.router';

export { ListsRouter } from './lists/trpc.router';

export { TasksRouter } from './tasks/trpc.router';

export { NewslettersRouter } from './newsletters/trpc.router';

export { TeamsRouter } from './teams/trpc.router';

export { SettingsRouter } from './settings/trpc.router';

export { ImportsRouter } from './imports/trpc.router';

export { MsSyncRouter } from './ms-sync/trpc.router';
export { GoogleSyncRouter } from './google-sync/trpc.router';

export { CompaniesRouter } from './companies/trpc.router';

export { ActivityRouter } from './activity/trpc.router';

export { FilesRouter } from './files/trpc.router';

export { DashboardRouter } from './dashboard/trpc.router';

export { NotificationsRouter } from './notifications/trpc.router';

export { VolunteerRouter } from './volunteer-events/trpc.router';

export { WebFormsRouter } from './web-forms/trpc.router';

export { BillingRouter } from './billing/trpc.router';
export { DonationsRouter } from './donations/trpc.router';
export { WorkflowsRouter } from './workflows/trpc.router';
export { ExportsRouter } from './exports/trpc.router';
export { UsersRouter } from './users/trpc.router';
export { EventsRouter } from './events/trpc.router';
export { PersonConnectionsRouter } from './person-connections/trpc.router';
export { CampaignsRouter } from './campaigns/trpc.router';
