import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { hashPassword } from '@/lib/auth/passwordHash';
import { requirePageAccess, isAuthResult } from '@/lib/api-auth';

export const runtime = 'nodejs';
export async function POST(request:NextRequest) {
  const auth=await requirePageAccess('/admin/hr');
  if(!isAuthResult(auth))return auth;
  if(auth.userLevel!=='admin' && !auth.isSuperAdmin) return NextResponse.json({error:'ADMIN_REQUIRED'},{status:403});
  const body=await request.json().catch(()=>null) as {temporaryPassword?:unknown}|null;
  if(typeof body?.temporaryPassword!=='string' || body.temporaryPassword.length<12 || body.temporaryPassword.length>128)
    return NextResponse.json({error:'PASSWORD_TOO_SHORT'},{status:400});
  const pool=await getPool();
  const hash=await hashPassword(body.temporaryPassword);
  const employees=await pool.request().input('tenantId',auth.tenantId).query(`
    SELECT e.EmpID, e.EmpName FROM dbo.TblEmp e
    WHERE e.TenantId=@tenantId AND e.isActive=1
    AND NOT EXISTS(SELECT 1 FROM dbo.TblEmployeePortalAccount a WHERE a.EmpID=e.EmpID)
    ORDER BY e.EmpID
  `);
  const created:{empId:number;name:string;username:string}[]=[];
  // IDs make usernames unique and stable even when Arabic names are duplicated.
  for(const row of employees.recordset as {EmpID:number;EmpName:string}[]) {
    const prefix=String(row.EmpName||'employee').toLowerCase().normalize('NFKD')
      .replace(/[^\p{L}\p{N}]+/gu,'.').replace(/^\.+|\.+$/g,'').slice(0,40)||'employee';
    const username=`${prefix}.${row.EmpID}`;
    const result=await pool.request().input('empId',row.EmpID).input('tenantId',auth.tenantId)
      .input('username',username).input('hash',hash).query(`
      INSERT INTO dbo.TblEmployeePortalAccount(EmpID,TenantId,LoginName,PasswordHash,MustChangePassword)
      SELECT e.EmpID,e.TenantId,@username,@hash,1 FROM dbo.TblEmp e
      WHERE e.EmpID=@empId AND e.TenantId=@tenantId AND e.isActive=1
      AND NOT EXISTS(SELECT 1 FROM dbo.TblEmployeePortalAccount a WHERE a.EmpID=e.EmpID)
    `);
    if(result.rowsAffected[0]===1)created.push({empId:row.EmpID,name:row.EmpName,username});
  }
  return NextResponse.json({created, count:created.length});
}
