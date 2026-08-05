import { inject } from '@angular/core';
import { type CanActivateFn, Router } from '@angular/router';
import { isPrivilegedRole } from '@common';

import { AuthService } from 'apps/frontend/src/app/auth/auth-service';

export const roleGuard: CanActivateFn = async (_route, _state) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  let user = auth.getUser();
  if (!user) {
    user = await auth.getCurrentUser();
  }
  if (!user) {
    return router.parseUrl('/signin');
  }

  // Admin-only routes admit admins and owners and nobody else. Naming the roles that are turned
  // away instead let Viewers — and an account with no role at all — walk in and collect 403s.
  if (!isPrivilegedRole(user.role)) {
    return router.parseUrl('/dashboard');
  }

  return true;
};
