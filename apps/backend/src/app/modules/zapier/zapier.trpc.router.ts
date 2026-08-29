import { z } from 'zod';
import { authProcedure, router } from '../../../trpc';
import type { ZapierEventType } from './zapier.service';
import { ZAPIER_EVENT_TYPES, ZapierService } from './zapier.service';

const zapierService = new ZapierService();

const eventTypeSchema = z.enum(ZAPIER_EVENT_TYPES);

export const ZapierRouter = router({
  // Zapier authenticates with the workspace API key (settings.generateApiKey / the API Keys
  // settings page) — there is no separate Zapier key.
  getSubscriptions: authProcedure.query(({ ctx }) => zapierService.getSubscriptions(ctx.auth.tenant_id)),

  subscribe: authProcedure
    .input(
      z.object({
        event_type: eventTypeSchema,
        webhook_url: z.string().url('Must be a valid URL').max(2048),
      }),
    )
    .mutation(({ input, ctx }) =>
      zapierService.subscribe(ctx.auth.tenant_id, input.event_type as ZapierEventType, input.webhook_url),
    ),

  unsubscribe: authProcedure
    .input(z.object({ event_type: eventTypeSchema }))
    .mutation(({ input, ctx }) => zapierService.unsubscribe(ctx.auth.tenant_id, input.event_type as ZapierEventType)),
});
