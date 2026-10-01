// Where to land after signing in. `from` is the location <Protected> bounced
// away from, carried in router state — never read from the URL, so an outside
// link cannot choose the destination. Only in-app role areas are honored;
// <Protected> still re-checks the role on arrival.
const APP_AREAS = ['/client', '/coach', '/admin'];

export function postAuthPath(user, from) {
  const home = user.role === 'client' ? '/client' : '/coach';
  const pathname = typeof from?.pathname === 'string' ? from.pathname : '';
  const inApp = APP_AREAS.some((area) => pathname === area || pathname.startsWith(`${area}/`));
  if (!inApp) return home;
  return `${pathname}${from.search || ''}${from.hash || ''}`;
}
