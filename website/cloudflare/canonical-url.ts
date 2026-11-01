import { VCR_VERSION } from '../lib/vcr3.mjs';

// Allowlist routes and query fields before constructing a stable shared-cache key.
// Unknown query fields are dropped. Add new data-affecting parameters here as well
// as in their route, or distinct requests can incorrectly share cached responses.
export function canonicalUrl(request: Request) {
  const incoming = new URL(request.url);
  if (!/^\/api\/(archive-source(?:\/\d{1,10})?|events(?:\/\d{1,10})?|teams\/[0-9]{1,8}[A-Za-z0-9-]{0,12}|rankings|skills)$/.test(incoming.pathname)) return null;
  const url = new URL(incoming.pathname, incoming.origin);
  for (const key of ['season', 'teamId', 'division', 'page']) {
    const value = incoming.searchParams.get(key);
    if (value) {
      if (!/^\d{1,10}$/.test(value)) return null;
      url.searchParams.set(key, value);
    }
  }
  // Only the non-default program is written into the key, so every V5 request
  // keeps the cache key it had before VEX IQ existed. Anything else is refused
  // rather than silently served V5 under an IQ address.
  const program=incoming.searchParams.get('program');
  if(program&&program!=='V5RC'){if(program!=='VIQRC')return null;url.searchParams.set('program',program)}
  const mode=incoming.searchParams.get('mode');
  if(mode){if(!['metadata','teams','matches'].includes(mode))return null;url.searchParams.set('mode',mode)}
  // Model-version namespace prevents a new rating model from reusing old responses.
  if (url.pathname === '/api/rankings' || url.pathname.startsWith('/api/teams/')) url.searchParams.set('model', VCR_VERSION);
  return url;
}
