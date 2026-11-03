declare const __VEX_API_BASE__: string;
declare const __VEX_ASSET_BASE__: string;

/** A file in `public/`, beneath the Pages repository path when there is one. */
export function assetUrl(path:string) {
  const assetBase=typeof __VEX_ASSET_BASE__==='undefined'?'/':__VEX_ASSET_BASE__;
  return `${assetBase}${path.replace(/^\//,'')}`;
}

/** Separate API and asset origins for GitHub Pages; keep same-origin hosting working. */
export async function siteFetch(path:string, init?:RequestInit) {
  // Team profiles come from events.vex directly when the build has a token,
  // and from the Worker otherwise or whenever that fails. Loaded on demand so
  // the profile builder stays out of the first page load.
  if(path.startsWith('/api/teams/')){
    const { directTeamProfile }=await import('./direct-profile');
    const direct=await directTeamProfile(path);
    if(direct)return direct;
  }
  // Event pages likewise, so live standings and matches arrive as soon as they
  // are posted. A poll (header x-vexrank-live) reads only events.vex.
  const eventMatch=/^\/api\/events\/(\d+)(\?|$)/.exec(path);
  if(eventMatch){
    const live=new Headers(init?.headers).get('x-vexrank-live')==='1';
    const { directEventDetail }=await import('./direct-profile');
    const direct=await directEventDetail(eventMatch[1],live?undefined:()=>fetch(`${typeof __VEX_API_BASE__==='undefined'?'':__VEX_API_BASE__}${path}`,{signal:init?.signal}));
    if(direct)return direct;
  }
  // Build-time constants: the API can live on a Worker while assets live beneath
  // a GitHub Pages repository path. Undefined constants support same-origin dev.
  const apiBase=typeof __VEX_API_BASE__==='undefined'?'':__VEX_API_BASE__;
  const assetBase=typeof __VEX_ASSET_BASE__==='undefined'?'/':__VEX_ASSET_BASE__;
  // Versioned archives use the API origin when configured because the Worker
  // serves its archive assets there; ordinary static files use the Pages base.
  const archive=/^\/rankings-20\d{2}-\d{2}-vcr3\.json$/.test(path);
  const url=path.startsWith('/api/')||archive&&apiBase?`${apiBase}${path}`:path.startsWith('/')?`${assetBase}${path.slice(1)}`:path;
  // The poll marker is for the direct path only: a custom header would make a
  // cross-origin request to the Worker fail its preflight.
  if(init?.headers){const headers=new Headers(init.headers);headers.delete('x-vexrank-live');init={...init,headers}}
  return fetch(url,init);
}

