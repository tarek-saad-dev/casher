import { NextRequest,NextResponse } from 'next/server';
import { getPool,sql } from '@/lib/db';
import { hashPassword } from '@/lib/auth/passwordHash';
import { requirePageAccess,isAuthResult } from '@/lib/api-auth';
import { pickEmployeeUsername } from '@/lib/employee-portal/username';
export const runtime='nodejs';
export async function POST(request:NextRequest) {
 const auth=await requirePageAccess('/admin/hr');
 if(!isAuthResult(auth))return auth;
 if(auth.userLevel!=='admin'&&!auth.isSuperAdmin)return NextResponse.json({error:'ADMIN_REQUIRED'},{status:403});
 const body=await request.json().catch(()=>null) as {confirm?:unknown}|null;
 if(body?.confirm!=='RESET_ALL_EMPLOYEE_LOGINS')return NextResponse.json({error:'CONFIRMATION_REQUIRED'},{status:400});
 const pool=await getPool();
 const hash=await hashPassword('12341234');
 const tx=new sql.Transaction(pool);
 await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
 try {
  const staff=await new sql.Request(tx).input('tenantId',auth.tenantId).query(`
   SELECT e.EmpID,e.EmpName,a.ID AS AccountID,a.LoginName FROM dbo.TblEmp e WITH (UPDLOCK,HOLDLOCK)
   LEFT JOIN dbo.TblEmployeePortalAccount a WITH (UPDLOCK,HOLDLOCK) ON a.EmpID=e.EmpID AND a.TenantId=e.TenantId
   WHERE e.TenantId=@tenantId AND e.isActive=1 ORDER BY e.EmpID
  `);
  const names=await new sql.Request(tx).query(`SELECT LoginName FROM dbo.TblEmployeePortalAccount WITH (UPDLOCK,HOLDLOCK)`);
  // Existing accounts will be renamed. Reserve only usernames belonging to inactive/other-tenant accounts.
  const ownIds=new Set<number>(staff.recordset.map((r:{AccountID:number|null})=>Number(r.AccountID)).filter(Boolean));
  const existing=await new sql.Request(tx).query('SELECT ID, LoginName FROM dbo.TblEmployeePortalAccount WITH (UPDLOCK,HOLDLOCK)');
  const occupied=new Set<string>((existing.recordset as {ID:number;LoginName:string}[]).filter(r=>!ownIds.has(r.ID)).map(r=>r.LoginName.toLowerCase()));
  const assigned=(staff.recordset as {EmpID:number;EmpName:string;AccountID:number|null}[]).map(r=>({...r,username:pickEmployeeUsername(r.EmpName,occupied)}));
  // Temporary unique usernames avoid collisions during renames and preserve global UNIQUE constraint.
  for(const row of assigned.filter(r=>r.AccountID)){
   await new sql.Request(tx).input('id',row.AccountID).input('name',`employeeportaltemp${row.AccountID}x`).query('UPDATE dbo.TblEmployeePortalAccount SET LoginName=@name WHERE ID=@id');
  }
  for(const row of assigned){
   const req=new sql.Request(tx).input('empId',row.EmpID).input('tenantId',auth.tenantId)
      .input('name',row.username).input('hash',hash);
   if(row.AccountID){
    await req.input('id',row.AccountID).query(`UPDATE dbo.TblEmployeePortalAccount
      SET LoginName=@name,PasswordHash=@hash,MustChangePassword=1,IsEnabled=1,FailedAttempts=0,LockedUntil=NULL,UpdatedAt=SYSUTCDATETIME()
      WHERE ID=@id AND EmpID=@empId AND TenantId=@tenantId`);
   }else{
    await req.query(`INSERT INTO dbo.TblEmployeePortalAccount
      (EmpID,TenantId,LoginName,PasswordHash,MustChangePassword)
      VALUES(@empId,@tenantId,@name,@hash,1)`);
   }
  }
  await tx.commit();
  return NextResponse.json({ok:true,count:assigned.length,users:assigned.map(r=>({empId:r.EmpID,name:r.EmpName,username:r.username}))});
 }catch(error){
  await tx.rollback().catch(()=>{});
  console.error('[employee portal] bulk reset failed',error instanceof Error?error.name:'unknown');
  return NextResponse.json({error:'RESET_FAILED'},{status:500});
 }
}
