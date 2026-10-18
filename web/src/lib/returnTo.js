// "Return to" targets for sign-in. The only place we ever send a person after
// logging in, other than a normal in-app route, is the OIDC authorization
// endpoint of this same service (another Loadbyton domain started the sign-in).
// It must be a relative path on this origin — never an absolute URL, a
// protocol-relative one, or anything outside /api/oidc/authorize.

const OIDC_AUTHORIZE = /^\/api\/oidc\/authorize\?[A-Za-z0-9\-._~%&=+:/]*$/;

export function safeOidcReturn(search) {
  const value = new URLSearchParams(search || '').get('return_to');
  if (!value || value.length > 2048 || value.includes('\\') || value.startsWith('//')) return null;
  return OIDC_AUTHORIZE.test(value) ? value : null;
}
