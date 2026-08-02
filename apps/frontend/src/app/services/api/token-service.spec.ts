import { TokenService } from './token-service';

// The access token now lives in memory only; the refresh token is an HttpOnly cookie the JS never
// sees (SECURITY-REVIEW.md 2.1). Persistence is just the remember-me preference in localStorage.
describe('TokenService', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('holds the access token in memory, not web storage', () => {
    const service = new TokenService();

    service.setAuthToken('access-token');

    expect(service.getAuthToken()).toBe('access-token');
    // Nothing is persisted to web storage where an XSS payload could read it.
    expect(localStorage.getItem('ppl-crm-auth-token')).toBeNull();
    expect(sessionStorage.getItem('ppl-crm-auth-token')).toBeNull();
  });

  it('set() takes only the access token from the response body', () => {
    const service = new TokenService();

    service.set({ auth_token: 'a1' });
    expect(service.getAuthToken()).toBe('a1');

    service.set({ auth_token: null });
    expect(service.getAuthToken()).toBeNull();
  });

  it('clearAll() and removeAuthToken() drop the in-memory token', () => {
    const service = new TokenService();
    service.setAuthToken('a1');

    service.removeAuthToken();
    expect(service.getAuthToken()).toBeNull();

    service.setAuthToken('a2');
    service.clearAll();
    expect(service.getAuthToken()).toBeNull();
  });

  it('persistence is the remember-me preference, stored in localStorage', () => {
    const service = new TokenService();
    expect(service.getPersistence()).toBe(false);

    service.setPersistence(true);
    expect(service.getPersistence()).toBe(true);
    expect(localStorage.getItem('pc-persistence')).toBe('1');

    service.setPersistence(false);
    expect(service.getPersistence()).toBe(false);
    expect(localStorage.getItem('pc-persistence')).toBe('0');
  });

  it('records a pending sign-out in localStorage so it outlives the tab that started it', () => {
    const service = new TokenService();
    expect(service.isSignOutPending()).toBe(false);

    service.markSignOutPending();
    expect(service.isSignOutPending()).toBe(true);
    // A new instance (a fresh page load) must still see it — that is the whole point.
    expect(new TokenService().isSignOutPending()).toBe(true);

    service.clearSignOutPending();
    expect(service.isSignOutPending()).toBe(false);
  });

  it('a fresh sign-in clears a pending sign-out, but a silent token refresh does not', () => {
    const service = new TokenService();
    service.markSignOutPending();

    service.setAuthToken('refreshed');
    expect(service.isSignOutPending()).toBe(true);

    service.set({ auth_token: 'a1' });
    expect(service.isSignOutPending()).toBe(false);
  });

  it('picks up an existing persistence flag from localStorage on construction', () => {
    localStorage.setItem('pc-persistence', '1');

    const service = new TokenService();

    expect(service.getPersistence()).toBe(true);
  });
});
