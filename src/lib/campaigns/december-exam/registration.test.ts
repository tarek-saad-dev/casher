import { describe, expect, it } from "vitest";
import { normalizeEgyptianMobile, parseRegistration } from "./registration";

describe("December registration",()=>{
  it("normalizes the same mobile in local, Arabic and international formats",()=>{
    for(const phone of ["01012345678","+201012345678","00201012345678","٠١٠١٢٣٤٥٦٧٨","010-1234-5678"])
      expect(normalizeEgyptianMobile(phone)).toBe("+201012345678");
  });
  it("rejects invalid numbers",()=>{
    for(const phone of ["0123","01912345678","+441012345678","01012345678ext9"])
      expect(()=>normalizeEgyptianMobile(phone)).toThrow("INVALID_PHONE");
  });
  const base={name:"Ahmed",phone:"01012345678",student:true};
  it("requires university and faculty or school or institute and specialization",()=>{
    expect(()=>parseRegistration({...base,education:{type:"UNIVERSITY",university:"Alexandria"}})).toThrow();
    expect(parseRegistration({...base,education:{type:"UNIVERSITY",university:"Alexandria",faculty:"Engineering"}}).education).toMatchObject({type:"UNIVERSITY",faculty:"Engineering"});
    expect(()=>parseRegistration({...base,education:{type:"SCHOOL"}})).toThrow();
    expect(parseRegistration({...base,education:{type:"SCHOOL",school:"Example school"}}).education).toMatchObject({type:"SCHOOL"});
    expect(()=>parseRegistration({...base,education:{type:"INSTITUTE",institute:"Example"}})).toThrow();
  });
  it("does not accept self-reported verification or marketing opt-in by default",()=>{
    const result=parseRegistration({...base,student:false,studentVerified:true,clubActive:true,referralCode:"cut-ab12"});
    expect(result).toEqual({name:"Ahmed",phone:"+201012345678",student:false,marketingConsent:false,referralCode:"CUT-AB12"});
  });
});
