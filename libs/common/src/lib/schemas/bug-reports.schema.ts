import { z } from 'zod';
import { idSchema } from './core.schema';

/**
 * A user-submitted bug report (fire-and-forget). `description` is the only field the
 * user types; the rest is context the dialog captures automatically. Server-derived
 * facts (tenant, reporter, campaign, timestamp) never come from the client.
 */
export const AddBugReportObj = z.object({
  description: z.string().trim().min(1, 'Please describe what happened').max(5000, 'Description is too long'),
  page_url: z.string().trim().max(2000, 'URL is too long').nullable().optional(),
  user_agent: z.string().trim().max(1000, 'User agent is too long').nullable().optional(),
  viewport: z.string().trim().max(50, 'Viewport is too long').nullable().optional(),
  screenshot_file_id: idSchema.nullable().optional(),
});
