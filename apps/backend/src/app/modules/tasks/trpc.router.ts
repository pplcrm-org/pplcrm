import {
  AddTaskObj,
  ReorderSubtasksObj,
  ReorderTasksObj,
  UpdateTaskObj,
  exportCsvInput,
  exportCsvResponse,
  getAllOptions,
  idSchema,
  MAX_BULK_IDS,
} from '../../../../../../libs/common/src';
import { z } from 'zod';

import type { OperationDataType } from '../../../../../../libs/common/src/lib/kysely.models';
import { authProcedure, router } from '../../../trpc';
import { TasksController } from './controller';
import { TaskCommentsController } from './comments.controller';
import { TaskAttachmentsController } from './attachments.controller';
import { TaskSubtasksController } from './subtasks.controller';

const tasks = new TasksController();

export const TasksRouter = router({
  add: authProcedure.input(AddTaskObj).mutation(({ input, ctx }) => tasks.addTask(input, ctx.auth)),

  import: authProcedure
    .input(
      z.object({
        rows: z.array(
          z.object({
            name: z.string().trim().min(1, 'Task name is required').max(200, 'Task name is too long'),
            details: z.string().trim().max(10000).optional().nullable(),
            status: z.string().trim().max(50).optional().nullable(),
            priority: z.string().trim().max(50).optional().nullable(),
            due_at: z.string().trim().max(50).optional().nullable(),
            assigned_to: z.string().trim().max(50).optional().nullable(),
          }),
        ),
        skipped: z.number().int().nonnegative().optional(),
        file_name: z.string().trim().min(1).max(255).optional(),
        source_csv: z.string().max(10_000_000).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      ctx.res.status(202);
      return tasks.importRows(input, ctx.auth);
    }),

  count: authProcedure.query(({ ctx }) => tasks.getCount(ctx.auth.tenant_id)),
  countSlaBreaches: authProcedure.query(({ ctx }) => tasks.countSlaBreaches(ctx.auth)),
  getSummaryCounts: authProcedure.query(({ ctx }) => tasks.getSummaryCounts(ctx.auth)),
  delete: authProcedure
    .input(idSchema)
    .mutation(({ input, ctx }) => tasks.delete(ctx.auth.tenant_id, input, ctx.auth.user_id)),
  deleteMany: authProcedure
    .input(
      z
        .array(idSchema)
        .min(1, 'At least one ID is required')
        .max(MAX_BULK_IDS, 'Too many items selected for one action'),
    )
    .mutation(({ input, ctx }) => tasks.deleteMany(ctx.auth.tenant_id, input)),
  getAll: authProcedure.input(getAllOptions).query(({ input, ctx }) => tasks.getAllTasks(ctx.auth, input)),
  getArchived: authProcedure.input(getAllOptions).query(({ input, ctx }) => tasks.getArchivedTasks(ctx.auth, input)),
  exportCsv: authProcedure
    .input(exportCsvInput)
    .output(exportCsvResponse)
    .mutation(({ input, ctx }) => tasks.exportCsv({ tenant_id: ctx.auth.tenant_id, ...(input ?? {}) }, ctx.auth)),
  getById: authProcedure
    .input(idSchema)
    .query(({ input, ctx }) => tasks.getOneById({ tenant_id: ctx.auth.tenant_id, id: input })),
  update: authProcedure
    .input(z.object({ id: idSchema, data: UpdateTaskObj }))
    .mutation(({ input, ctx }) => tasks.updateTask(input.id, input.data, ctx.auth)),
  reorder: authProcedure.input(ReorderTasksObj).mutation(({ input, ctx }) => tasks.reorderTasks(ctx.auth, input)),
  reorderSubtasks: authProcedure
    .input(ReorderSubtasksObj)
    .mutation(({ input, ctx }) => new TaskSubtasksController().reorderSubtasks(ctx.auth, input)),
  getComments: authProcedure
    .input(idSchema)
    .query(({ input, ctx }) =>
      new TaskCommentsController().getByTaskId({ tenant_id: ctx.auth.tenant_id, task_id: input }),
    ),
  addComment: authProcedure
    .input(
      z.object({
        task_id: idSchema,
        comment: z.string().trim().min(1, 'Comment cannot be empty').max(5000, 'Comment too long'),
      }),
    )
    .mutation(({ input, ctx }) =>
      new TaskCommentsController().add({
        tenant_id: ctx.auth.tenant_id,
        task_id: input.task_id,
        author_id: ctx.auth.user_id,
        comment: input.comment,
      } as any),
    ),
  getAttachments: authProcedure
    .input(idSchema)
    .query(({ input, ctx }) =>
      new TaskAttachmentsController().getByTaskId({ tenant_id: ctx.auth.tenant_id, task_id: input }),
    ),
  addAttachment: authProcedure
    .input(
      z.object({
        task_id: idSchema,
        filename: z.string().trim().min(1, 'Filename cannot be empty').max(255, 'Filename is too long'),
        url: z.string().url('Invalid URL format').optional(),
        content_type: z.string().trim().max(100).optional(),
        size_bytes: z.number().int().nonnegative().optional(),
      }),
    )
    .mutation(({ input, ctx }) =>
      (new TaskAttachmentsController() as any).add({
        tenant_id: ctx.auth.tenant_id,
        task_id: input.task_id,
        filename: input.filename,
        url: input.url,
        content_type: input.content_type,
        size_bytes: input.size_bytes ?? null,
        createdby_id: ctx.auth.user_id,
        updatedby_id: ctx.auth.user_id,
      }),
    ),
  getSubtasks: authProcedure
    .input(idSchema)
    .query(({ input, ctx }) =>
      new TaskSubtasksController().getByTaskId({ tenant_id: ctx.auth.tenant_id, task_id: input }),
    ),
  addSubtask: authProcedure
    .input(
      z.object({
        task_id: idSchema,
        name: z.string().trim().min(1, 'Subtask name cannot be empty').max(200, 'Subtask name too long'),
      }),
    )
    .mutation(({ input, ctx }) =>
      new TaskSubtasksController().add({
        tenant_id: ctx.auth.tenant_id,
        task_id: input.task_id,
        name: input.name,
        status: 'todo',
        createdby_id: ctx.auth.user_id,
        updatedby_id: ctx.auth.user_id,
      } as OperationDataType<'task_subtasks', 'insert'>),
    ),
  updateSubtask: authProcedure
    .input(
      z.object({
        id: idSchema,
        data: z.object({
          name: z.string().trim().min(1, 'Subtask name cannot be empty').max(200, 'Subtask name too long').optional(),
          status: z.string().trim().max(50).optional(),
          position: z.number().int().optional(),
        }),
      }),
    )
    .mutation(({ input, ctx }) =>
      new TaskSubtasksController().updateSubtask({
        tenant_id: ctx.auth.tenant_id,
        id: input.id,
        row: { ...(input.data ?? {}), updatedby_id: ctx.auth.user_id } as OperationDataType<'task_subtasks', 'update'>,
      }),
    ),
});
