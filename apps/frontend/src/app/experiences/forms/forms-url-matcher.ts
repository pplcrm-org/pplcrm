import type { UrlMatchResult, UrlSegment } from '@angular/router';

/**
 * Matches every Forms URL onto ONE route config:
 *
 * | URL                | params                        | what the page shows          |
 * | ------------------ | ----------------------------- | ---------------------------- |
 * | `/forms`           | —                             | browse, first form selected  |
 * | `/forms/new`       | `formMode='new'`              | the New-form stepper         |
 * | `/forms/:id`       | `formId`                      | that form, read-only preview |
 * | `/forms/:id/edit`  | `formId`, `formMode='edit'`   | that form, live editing      |
 *
 * One config rather than four sibling routes on purpose: the reuse strategy keeps a
 * component only while `future.routeConfig === curr.routeConfig`, so four separate
 * routes would destroy and rebuild the page — refetching the whole form list — every
 * time the user clicks a different form in the left column.
 *
 * The params are named `formId`/`formMode` rather than `id`/`mode` because
 * `withComponentInputBinding()` binds route params onto same-named component inputs,
 * and the page already owns an internal `mode` signal.
 */
export function formsUrlMatcher(segments: UrlSegment[]): UrlMatchResult | null {
  const [first, second] = segments;

  if (!first) return { consumed: [] };

  if (segments.length === 1) {
    if (first.path === 'new') return { consumed: segments, posParams: { formMode: first } };
    return { consumed: segments, posParams: { formId: first } };
  }

  if (segments.length === 2 && second?.path === 'edit') {
    return { consumed: segments, posParams: { formId: first, formMode: second } };
  }

  return null;
}
