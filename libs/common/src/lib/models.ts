import type { z } from 'zod';

import type {
  AddCampaignObj,
  UpdateCampaignObj,
  UpsertCampaignPersonFactObj,
  SetCampaignSubscriptionObj,
  CarryOverCampaignObj,
  AddTagObj,
  AddListObj,
  AddMarketingEmailObj,
  AddTaskObj,
  AddTeamObj,
  AddBugReportObj,
  AddTurfObj,
  UpdateTurfObj,
  CutTurfsObj,
  AssignTurfObj,
  FieldReportRangeObj,
  LogKnockObj,
  EmailCommentObj,
  EmailFolderObj,
  EmailObj,
  MarketingEmailObj,
  marketingEmailTopLinkObj,
  NewsletterReportObj,
  NewsletterReportBounceObj,
  NewsletterReportEngagedObj,
  NewsletterReportLinkObj,
  NewsletterReportPreviousSendObj,
  CreateClickersListResultObj,
  EmailDraftObj,
  PersonsObj,
  SettingsEntryObj,
  SettingsObj,
  UpsertSettingsInputObj,
  UpdateHouseholdsObj,
  UpdatePersonsObj,
  UpdateTagObj,
  ListsObj,
  UpdateMarketingEmailObj,
  UpdateListObj,
  UpdateTaskObj,
  UpdateTeamObj,
  TasksObj,
  getAllOptions,
  exportCsvInput,
  exportCsvResponse,
  queueExportInput,
  logInstantExportInput,
  dataExportRecord,
  sortModelItem,
  InviteAuthUserObj,
  ProfilePreferencesObj,
  UpdateAuthUserObj,
  Verify2FAObj,
  ImportListItemObj,
  AddVolunteerEventObj,
  VolunteerEventsObj,
  UpdateVolunteerEventObj,
  AddVolunteerShiftObj,
  VolunteerShiftsObj,
  UpdateVolunteerShiftObj,
  AddWebFormObj,
  UpdateWebFormObj,
  WebFormsObj,
  CreateFormObj,
  UpdateFormObj,
  FormSubmissionObj,
  QueryBuilderRuleNode,
  QueryBuilderGroupNode,
  QueryBuilderNode,
  WorkflowObj,
  AddWorkflowObj,
  UpdateWorkflowObj,
  WorkflowStepObj,
  AddWorkflowStepObj,
  UpdateWorkflowStepObj,
  WorkflowEnrollmentObj,
  AddEventObj,
  EventObj,
  UpdateEventObj,
  AddTicketTypeObj,
  TicketTypeObj,
  UpdateTicketTypeObj,
  ReorderTicketTypesObj,
  AddRegistrationObj,
  RegistrationObj,
  UpdateRegistrationObj,
  AddConnectionObj,
} from './schema';

export interface INow {
  now: string;
}

export type AddTagType = z.infer<typeof AddTagObj>;

export type EmailCommentType = z.infer<typeof EmailCommentObj>;

export type EmailFolderType = z.infer<typeof EmailFolderObj>;

export type EmailType = z.infer<typeof EmailObj>;

export type MarketingEmailType = z.infer<typeof MarketingEmailObj>;

export type AddMarketingEmailType = z.infer<typeof AddMarketingEmailObj>;

export type UpdateMarketingEmailType = z.infer<typeof UpdateMarketingEmailObj>;

export type MarketingEmailTopLinkType = z.infer<typeof marketingEmailTopLinkObj>;

export type NewsletterReportType = z.infer<typeof NewsletterReportObj>;

export type NewsletterReportBounceType = z.infer<typeof NewsletterReportBounceObj>;

export type NewsletterReportEngagedType = z.infer<typeof NewsletterReportEngagedObj>;

export type NewsletterReportLinkType = z.infer<typeof NewsletterReportLinkObj>;

export type NewsletterReportPreviousSendType = z.infer<typeof NewsletterReportPreviousSendObj>;

export type CreateClickersListResultType = z.infer<typeof CreateClickersListResultObj>;

export type EmailDraftType = z.infer<typeof EmailDraftObj>;

export type ImportListItem = z.infer<typeof ImportListItemObj>;

export type PERSONINHOUSEHOLDTYPE = {
  first_name: string;
  full_name: string;
  id: string;
  last_name: string;
  middle_names: string;
};

export type PersonsType = z.infer<typeof PersonsObj>;

export type SettingsType = z.infer<typeof SettingsObj>;

export type SettingsEntryType = z.infer<typeof SettingsEntryObj>;

export type UpsertSettingsInputType = z.infer<typeof UpsertSettingsInputObj>;

export type SortModelType = z.infer<typeof sortModelItem>;

export type UpdateHouseholdsType = z.infer<typeof UpdateHouseholdsObj>;

export type UpdatePersonsType = z.infer<typeof UpdatePersonsObj>;

export type UpdateTagType = z.infer<typeof UpdateTagObj>;

export type getAllOptionsType = z.infer<typeof getAllOptions>;

export type AddListType = z.infer<typeof AddListObj>;

export type AddCampaignType = z.infer<typeof AddCampaignObj>;

export type UpdateCampaignType = z.infer<typeof UpdateCampaignObj>;

export type UpsertCampaignPersonFactType = z.infer<typeof UpsertCampaignPersonFactObj>;

export type SetCampaignSubscriptionType = z.infer<typeof SetCampaignSubscriptionObj>;

export type CarryOverCampaignType = z.infer<typeof CarryOverCampaignObj>;

export type AddTeamType = z.infer<typeof AddTeamObj>;

export type AddBugReportType = z.infer<typeof AddBugReportObj>;

export type InviteAuthUserType = z.infer<typeof InviteAuthUserObj>;

export type Verify2FAType = z.infer<typeof Verify2FAObj>;

export type ListsType = z.infer<typeof ListsObj>;

export type UpdateListType = z.infer<typeof UpdateListObj>;

export type UpdateTeamType = z.infer<typeof UpdateTeamObj>;

export type AddTurfType = z.infer<typeof AddTurfObj>;

export type UpdateTurfType = z.infer<typeof UpdateTurfObj>;

export type CutTurfsType = z.infer<typeof CutTurfsObj>;

export type AssignTurfType = z.infer<typeof AssignTurfObj>;

export type FieldReportRangeType = z.infer<typeof FieldReportRangeObj>;

export type LogKnockType = z.infer<typeof LogKnockObj>;

export type UpdateAuthUserType = z.infer<typeof UpdateAuthUserObj>;

export type ProfilePreferencesType = z.infer<typeof ProfilePreferencesObj>;

export type AddTaskType = z.infer<typeof AddTaskObj>;
export type TasksType = z.infer<typeof TasksObj>;
export type UpdateTaskType = z.infer<typeof UpdateTaskObj>;
export type ExportCsvInputType = z.infer<typeof exportCsvInput>;
export type ExportCsvResponseType = z.infer<typeof exportCsvResponse>;
export type QueueExportInputType = z.infer<typeof queueExportInput>;
export type LogInstantExportInputType = z.infer<typeof logInstantExportInput>;
export type DataExportRecordType = z.infer<typeof dataExportRecord>;

export type AddVolunteerEventType = z.infer<typeof AddVolunteerEventObj>;
export type VolunteerEventsType = z.infer<typeof VolunteerEventsObj>;
export type UpdateVolunteerEventType = z.infer<typeof UpdateVolunteerEventObj>;

export type AddVolunteerShiftType = z.infer<typeof AddVolunteerShiftObj>;
export type VolunteerShiftsType = z.infer<typeof VolunteerShiftsObj>;
export type UpdateVolunteerShiftType = z.infer<typeof UpdateVolunteerShiftObj>;

export type AddWebFormType = z.infer<typeof AddWebFormObj>;
export type UpdateWebFormType = z.infer<typeof UpdateWebFormObj>;
export type WebFormsType = z.infer<typeof WebFormsObj>;
export type CreateFormType = z.infer<typeof CreateFormObj>;
export type UpdateFormType = z.infer<typeof UpdateFormObj>;
export type FormSubmissionType = z.infer<typeof FormSubmissionObj>;

export type WorkflowsType = z.infer<typeof WorkflowObj>;
export type AddWorkflowType = z.infer<typeof AddWorkflowObj>;
export type UpdateWorkflowType = z.infer<typeof UpdateWorkflowObj>;
export type WorkflowStepsType = z.infer<typeof WorkflowStepObj>;
export type AddWorkflowStepType = z.infer<typeof AddWorkflowStepObj>;
export type UpdateWorkflowStepType = z.infer<typeof UpdateWorkflowStepObj>;
export type WorkflowEnrollmentsType = z.infer<typeof WorkflowEnrollmentObj>;

export type AddEventType = z.infer<typeof AddEventObj>;
export type EventType = z.infer<typeof EventObj>;
export type UpdateEventType = z.infer<typeof UpdateEventObj>;

export type AddTicketTypeType = z.infer<typeof AddTicketTypeObj>;
export type TicketTypeType = z.infer<typeof TicketTypeObj>;
export type UpdateTicketTypeType = z.infer<typeof UpdateTicketTypeObj>;
export type ReorderTicketTypesType = z.infer<typeof ReorderTicketTypesObj>;

export type AddRegistrationType = z.infer<typeof AddRegistrationObj>;
export type RegistrationType = z.infer<typeof RegistrationObj>;
export type UpdateRegistrationType = z.infer<typeof UpdateRegistrationObj>;

export type AddConnectionType = z.infer<typeof AddConnectionObj>;

export type { QueryBuilderRuleNode, QueryBuilderGroupNode, QueryBuilderNode };
