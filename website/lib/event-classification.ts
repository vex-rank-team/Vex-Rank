// Calendar/filter labels, not rating weights. Upstream level=World means a
// Worlds qualifier, so identify the championship by its name. Signature requires
// the official level to avoid promoting practice events that mention a signature.
export function classifyEvent(name:string, level:string | null) {
  const value = name.toLowerCase();
  const officialLevel = String(level ?? '').trim().toLowerCase();
  const normalizedName = value.replace(/[™®]/g,'').replace(/\s+/g,' ').trim();
  const eventType = value.includes('league') ? 'League' : value.includes('invitational') ? 'Invitational Tournament' : /school[- ]based/.test(value) ? 'School-Based Tournament' : value.includes('remote skills') ? 'Live Remote Skills' : 'Open Tournament';
  const isWorldChampionship = /\bvex(?: v5| iq)? robotics world championship\b/.test(normalizedName)
    && !/\b(scrimmage|checkup|practice)\b/.test(normalizedName)
    && !/\bjrotc\b/.test(normalizedName);
  const levelClass = /\bjrotc\b.*\bbrigade championship\b|\bbrigade championship\b.*\bjrotc\b/.test(normalizedName) ? 'JROTC Brigade Championship'
    : /\bjrotc\b.*\bnational championship\b|\bnational championship\b.*\bjrotc\b/.test(normalizedName) ? 'JROTC National Championship'
    : /\bconference championship\b/.test(normalizedName) ? 'Conference Championship'
    : /\bspotlight\b/.test(normalizedName) ? 'Spotlight Event'
    : /\bshowcase\b/.test(normalizedName) ? 'Showcase Event'
    : officialLevel === 'signature' ? 'Signature Event'
    : isWorldChampionship ? 'World Championship'
    : /\bnational championship\b/.test(normalizedName) ? 'National Championship'
    : /\b(?:state|provincial|event region|regional) championship\b/.test(normalizedName) ? 'Event Region Championship'
    : 'None';
  const format = value.includes('remote') || value.includes('virtual') ? 'Remote' : 'In-Person';
  // Elementary is VEX IQ's younger grade. V5 events never name it, so they
  // classify exactly as before; an IQ event open to both grades is Mixed.
  const elementary = /\belementary\b/.test(value) || value.includes('viqrc_es');
  const grade = elementary && value.includes('middle school') ? 'Mixed'
    : value.includes('middle school') || value.includes(' ms ') ? 'Middle School'
    : value.includes('high school') || value.includes(' hs ') ? 'High School'
    : elementary ? 'Elementary School' : 'Mixed';
  return { eventType, levelClass, format, grade, worldQualifier: officialLevel === 'world' };
}
