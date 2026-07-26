import {
  AddMarketingEmailObj,
  AddNewsletterTemplateObj,
  RunPreflightObj,
  UpdateMarketingEmailObj,
  UpdateNewsletterTemplateObj,
  idSchema,
} from '../../../../../../libs/common/src';
import { z } from 'zod';

import { authProcedure, router } from '../../../trpc';
import { NewslettersController } from './controller';
import { NewsletterTemplatesController } from './templates.controller';
import { createCrudRouter } from '../../lib/crud-router';

const newsletters = new NewslettersController();
const templates = new NewsletterTemplatesController();

const crud = createCrudRouter(newsletters, AddMarketingEmailObj, UpdateMarketingEmailObj);

const sendTestSchema = z.object({
  subject: z.string(),
  html: z.string(),
  text: z.string().optional(),
  to: z.email(),
  fromName: z.string().optional(),
  fromEmail: z.email().optional(),
});

export const NewslettersRouter = router({
  ...crud,

  getReport: authProcedure.input(idSchema).query(({ input, ctx }) => newsletters.getReport(ctx.auth.tenant_id, input)),

  createClickersList: authProcedure
    .input(idSchema)
    .mutation(({ input, ctx }) => newsletters.createClickersList(ctx.auth, input)),

  send: authProcedure
    .input(idSchema)
    .mutation(async ({ input, ctx }) => newsletters.sendNewsletter(ctx.auth.tenant_id, input, ctx.auth.user_id)),

  cancelSchedule: authProcedure
    .input(idSchema)
    .mutation(async ({ input, ctx }) => newsletters.cancelSchedule(ctx.auth.tenant_id, input, ctx.auth.user_id)),

  resendToNonOpeners: authProcedure
    .input(z.object({ id: idSchema, subject: z.string().min(1).max(200) }))
    .mutation(async ({ input, ctx }) =>
      newsletters.resendToNonOpeners(ctx.auth.tenant_id, input.id, input.subject, ctx.auth.user_id),
    ),

  sendTest: authProcedure
    .input(sendTestSchema)
    .mutation(async ({ input, ctx }) => newsletters.sendTestEmail(ctx.auth, input)),

  runPreflight: authProcedure
    .input(RunPreflightObj)
    .mutation(async ({ input, ctx }) => newsletters.runPreflight(ctx.auth.tenant_id, input)),

  sendQuota: authProcedure.query(({ ctx }) => newsletters.getSendQuota(ctx.auth.tenant_id)),

  /** User-saved templates — the wizard's "Save as template" / "Your templates" library. */
  templates: router({
    getAll: authProcedure.query(({ ctx }) => templates.listTemplates(ctx.auth.tenant_id)),

    add: authProcedure
      .input(AddNewsletterTemplateObj)
      .mutation(({ input, ctx }) => templates.addTemplate(ctx.auth, input)),

    rename: authProcedure
      .input(z.object({ id: idSchema, data: UpdateNewsletterTemplateObj }))
      .mutation(({ input, ctx }) => templates.renameTemplate(ctx.auth, input.id, input.data)),

    delete: authProcedure.input(idSchema).mutation(({ input, ctx }) => templates.deleteTemplate(ctx.auth, input)),
  }),
});
