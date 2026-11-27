import 'server-only';
import {NextResponse} from 'next/server';
import {requirePageAccess,requireAdmin,isAuthResult,type AuthResult} from '@/lib/api-auth';
export function receptionAllowed(userId:number,raw:string|undefined){
 return (raw||'').split(',').map(s=>s.trim()).some(s=>/^\d+$/.test(s)&&Number(s)===userId&&userId>0);
}
export async function requireDecemberReception():Promise<AuthResult|NextResponse>{
 const admin=await requireAdmin();if(isAuthResult(admin))return admin;
 // Additional staff access is explicitly assigned; POS access alone is not enough.
 const staff=await requirePageAccess('/income/pos');if(!isAuthResult(staff))return staff;
 if(!receptionAllowed(staff.userId,process.env.DECEMBER_EXAM_RECEPTION_USER_IDS))return NextResponse.json({ok:false,code:'RECEPTION_ACCESS_REQUIRED'},{status:403});
 return staff;
}
