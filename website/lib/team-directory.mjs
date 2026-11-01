export const normalizeCountry=value=>/^(usa|us|united states of america)$/i.test(value??'')?'United States':value||'Unassigned';
const normalized=value=>String(value??'').trim().toLocaleLowerCase();
const teamOrder=new Intl.Collator(undefined,{numeric:true,sensitivity:'base'});
export function directoryLocations(teams,country='All'){
  return {
    countries:[...new Set(teams.map(t=>normalizeCountry(t.country)))].sort(),
    regions:[...new Set(teams.filter(t=>country==='All'||normalizeCountry(t.country)===country).map(t=>t.region||'Unassigned'))].sort(),
  };
}
export function searchDirectory(teams,query,filters={}){
  const q=normalized(query),tokens=q.split(/\s+/).filter(Boolean);
  return teams.filter(t=>{
    if(filters.country&&filters.country!=='All'&&normalizeCountry(t.country)!==filters.country)return false;
    if(filters.region&&filters.region!=='All'&&t.region!==filters.region)return false;
    if(filters.grade&&filters.grade!=='All'&&t.grade!==filters.grade)return false;
    const haystack=normalized(`${t.number} ${t.name} ${t.organization}`);
    return tokens.every(token=>haystack.includes(token));
  }).sort((a,b)=>{
    const priority=t=>normalized(t.number)===q?0:normalized(t.number).startsWith(q)?1:2;
    return priority(a)-priority(b)||teamOrder.compare(a.number,b.number)||a.id-b.id;
  });
}


/** What a reader sees when VEX IQ was asked for and the IQ list is not there. */
export const IQ_DIRECTORY_UNAVAILABLE="The VEX IQ team directory isn't available yet.";

/**
 * Whether a directory file is the one asked for. Files built before VEX IQ
 * carry no `program` and are V5's. A server that predates IQ support answers
 * the IQ request with that V5 file, so an IQ request is satisfied only by a
 * file that says VIQRC.
 */
export function directoryMatchesProgram(directory,program='V5RC'){
  return (directory?.program??'V5RC')===program;
}
