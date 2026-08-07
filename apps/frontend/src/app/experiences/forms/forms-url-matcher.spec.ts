import { UrlSegment } from '@angular/router';
import { describe, expect, it } from 'vitest';

import { formsUrlMatcher } from './forms-url-matcher';

function segments(...paths: string[]): UrlSegment[] {
  return paths.map((p) => new UrlSegment(p, {}));
}

describe('formsUrlMatcher', () => {
  it('matches /forms with no params', () => {
    const result = formsUrlMatcher(segments());
    expect(result).toEqual({ consumed: [] });
  });

  it('matches /forms/new as the New-form stepper, not as a form id', () => {
    const result = formsUrlMatcher(segments('new'));
    expect(result?.consumed).toHaveLength(1);
    expect(result?.posParams?.['formMode']?.path).toBe('new');
    expect(result?.posParams?.['formId']).toBeUndefined();
  });

  it('matches /forms/:id and exposes the id as formId', () => {
    const result = formsUrlMatcher(segments('42'));
    expect(result?.posParams?.['formId']?.path).toBe('42');
    expect(result?.posParams?.['formMode']).toBeUndefined();
  });

  it('matches /forms/:id/edit and exposes both params', () => {
    const result = formsUrlMatcher(segments('42', 'edit'));
    expect(result?.consumed).toHaveLength(2);
    expect(result?.posParams?.['formId']?.path).toBe('42');
    expect(result?.posParams?.['formMode']?.path).toBe('edit');
  });

  it('rejects a second segment that is not "edit", so the URL falls through to not-found', () => {
    expect(formsUrlMatcher(segments('42', 'delete'))).toBeNull();
  });

  it('rejects anything deeper than two segments', () => {
    expect(formsUrlMatcher(segments('42', 'edit', 'extra'))).toBeNull();
  });
});
