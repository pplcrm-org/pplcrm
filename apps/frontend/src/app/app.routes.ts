import type { Routes } from '@angular/router';

import { authGuard } from './auth/auth-guard';
import { loginGuard } from './auth/login/login-guard';

export const appRoutes = [
  // Default redirect to the dashboard inside the app shell
  { path: '', redirectTo: 'dashboard', pathMatch: 'full' },

  // Auth pages
  {
    path: 'signin',
    canActivate: [loginGuard],
    loadComponent: () => import('./auth/signin-page/signin-page').then((m) => m.SignInPage),
  },
  {
    path: 'signup',
    loadComponent: () => import('./auth/signup-page/signup-page').then((m) => m.SignUpPage),
  },
  {
    path: 'resetpassword',
    loadComponent: () => import('./auth/reset-password-page/reset-password-page').then((m) => m.ResetPasswordPage),
  },
  {
    path: 'new-password',
    loadComponent: () => import('./auth/new-password-page/new-password-page').then((m) => m.NewPasswordPage),
  },
  {
    path: 'verify-sender-email',
    loadComponent: () =>
      import('./auth/verify-sender-email-page/verify-sender-email-page').then((m) => m.VerifySenderEmailPage),
  },
  {
    path: 'confirm-subscription',
    loadComponent: () =>
      import('./auth/confirm-subscription-page/confirm-subscription-page').then((m) => m.ConfirmSubscriptionPage),
  },
  {
    path: 'f/:slug',
    // Fallback for the pre-load frame only; PublicPageMeta replaces it with "<form> · <org>" once
    // the config lands. Without a title here AppTitleStrategy title-cases the URL segment ("F").
    title: 'Form',
    loadComponent: () => import('./experiences/forms/ui/public-form').then((m) => m.PublicFormComponent),
  },
  {
    path: 'g/:token',
    title: 'Your giving',
    loadComponent: () => import('./experiences/donations/portal/donor-portal-page').then((m) => m.DonorPortalPage),
  },
  {
    path: 'g',
    title: 'Get your giving link',
    loadComponent: () =>
      import('./experiences/donations/portal/donor-link-request-page').then((m) => m.DonorLinkRequestPage),
  },
  {
    path: 'e/:slug',
    title: 'Event',
    data: { kind: 'event' },
    loadComponent: () => import('./experiences/events/ui/public-event').then((m) => m.PublicEventComponent),
  },
  {
    path: 'v/:slug',
    title: 'Volunteer',
    data: { kind: 'volunteer' },
    loadComponent: () => import('./experiences/events/ui/public-event').then((m) => m.PublicEventComponent),
  },
  {
    path: 'volunteer',
    title: 'Volunteer',
    loadComponent: () =>
      import('./experiences/shifts/ui/public-volunteer-list').then((m) => m.PublicVolunteerListComponent),
  },
  // The volunteer companions (canvass /t/:token, deliveries /r/:token) live in
  // the separate apps/companion build — served path-routed on the same domain.
  {
    path: 'verify-email',
    loadComponent: () => import('./auth/verify-email-page/verify-email-page').then((m) => m.VerifyEmailPage),
  },
  {
    path: 'cancel-deletion',
    loadComponent: () => import('./auth/cancel-deletion-page/cancel-deletion-page').then((m) => m.CancelDeletionPage),
  },
  {
    path: 'resume-account',
    loadComponent: () => import('./auth/resume-account-page/resume-account-page').then((m) => m.ResumeAccountPage),
  },

  // Main dashboard shell + children (protected)
  {
    path: '',
    canActivate: [authGuard],
    // optionally also: canActivateChild: [authGuard],
    loadComponent: () => import('./layout/dashboards/dashboard').then((m) => m.Dashboard),
    loadChildren: () => import('./dashboard.routes').then((m) => m.dashboardRoutes),
  },

  // Fallback
  {
    path: '**',
    loadComponent: () => import('@uxcommon/components/not-found/not-found').then((m) => m.NotFound),
  },
] as const satisfies Routes;
