export type Education =
  | { type: "UNIVERSITY"; university: string; faculty: string; year?: string }
  | { type: "SCHOOL"; school: string; stage?: string }
  | { type: "INSTITUTE"; institute: string; specialization: string; year?: string };
export type Registration = { name: string; phone: string; student: boolean; education?: Education; referralCode?: string; marketingConsent: boolean };

function record(input:unknown): Record<string,unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("INVALID_REGISTRATION");
  return input as Record<string,unknown>;
}
function field(value:unknown, max=120):string {
  if(typeof value!=="string") throw new Error("INVALID_REGISTRATION");
  const clean=value.trim().replace(/\s+/g," ");
  if(!clean || clean.length>max || /[\u0000-\u001f\u007f]/.test(clean)) throw new Error("INVALID_REGISTRATION");
  return clean;
}
function optional(value:unknown, max=60):string|undefined {
  if(value===undefined || value==="")return undefined;
  return field(value,max);
}
export function normalizeEgyptianMobile(value:unknown):string {
  if(typeof value!=="string" || value.length>32)throw new Error("INVALID_PHONE");
  const digits=value.replace(/[٠-٩]/g,c=>String(c.charCodeAt(0)-0x660))
    .replace(/[۰-۹]/g,c=>String(c.charCodeAt(0)-0x6f0)).replace(/[\s()-]/g,"");
  const local=digits.replace(/^(?:\+20|0020|20)(?=1[0125]\d{8}$)/,"0");
  if(!/^01[0125]\d{8}$/.test(local))throw new Error("INVALID_PHONE");
  return "+20"+local.slice(1);
}
/** Validate self-reported campaign data only. It grants no membership, identity or student verification. */
export function parseRegistration(input:unknown): Registration {
  const r=record(input);
  if(typeof r.student!=="boolean" || (r.marketingConsent!==undefined && typeof r.marketingConsent!=="boolean"))throw new Error("INVALID_REGISTRATION");
  const name=field(r.name,100);
  const phone=normalizeEgyptianMobile(r.phone);
  const result:Registration={name,phone,student:r.student,marketingConsent:r.marketingConsent===true};
  if(r.referralCode!==undefined && r.referralCode!==""){
    const code=field(r.referralCode,32).toUpperCase();
    if(!/^[A-Z0-9-]{4,32}$/.test(code))throw new Error("INVALID_REFERRAL_CODE");
    result.referralCode=code;
  }
  if(r.student){
    const e=record(r.education);
    if(e.type==="UNIVERSITY") result.education={type:e.type,university:field(e.university),faculty:field(e.faculty),year:optional(e.year)};
    else if(e.type==="SCHOOL") result.education={type:e.type,school:field(e.school),stage:optional(e.stage)};
    else if(e.type==="INSTITUTE") result.education={type:e.type,institute:field(e.institute),specialization:field(e.specialization),year:optional(e.year)};
    else throw new Error("INVALID_EDUCATION");
  }
  return result;
}
