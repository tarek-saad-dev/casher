import 'server-only';
import { getPool, sql } from '@/lib/db';
export type PortalAttendance = {day:string;checkIn:string|null;checkOut:string|null;lateMinutes:number;earlyMinutes:number;workedMinutes:number|null;branch:string|null};
export async function getPortalAttendance(tenantId:string,empId:number,month:string):Promise<PortalAttendance[]> {
 const pool=await getPool();
 const result=await pool.request().input('tenantId',sql.UniqueIdentifier,tenantId).input('empId',sql.Int,empId).input('month',sql.VarChar(7),month)
 .query(`SELECT CONVERT(varchar(10),a.WorkDate,23) AS Day,
 CONVERT(varchar(5),a.CheckInTime,108) AS CheckIn,
 CONVERT(varchar(5),a.CheckOutTime,108) AS CheckOut,
 ISNULL(a.LateMinutes,0) AS LateMinutes,ISNULL(a.EarlyLeaveMinutes,0) AS EarlyMinutes,
 b.BranchName
 FROM dbo.TblEmpAttendance a
 INNER JOIN dbo.TblEmp e ON e.EmpID=a.EmpID AND e.TenantId=@tenantId
 LEFT JOIN dbo.TblBranch b ON b.BranchID=a.BranchID
 WHERE a.EmpID=@empId AND CONVERT(char(7),a.WorkDate,126)=@month
 AND EXISTS(SELECT 1 FROM dbo.Location loc WHERE loc.LegacyBranchId=a.BranchID AND loc.TenantId=@tenantId)
 ORDER BY a.WorkDate,a.ID`);
 return result.recordset.map((r:{Day:string;CheckIn:string|null;CheckOut:string|null;LateMinutes:number;EarlyMinutes:number;BranchName:string|null})=>{
  const min=(v:string)=>{const [h,m]=v.split(':').map(Number);return h*60+m};
  const worked=r.CheckIn&&r.CheckOut?(min(r.CheckOut)-min(r.CheckIn)+1440)%1440:null;
  return {day:r.Day,checkIn:r.CheckIn,checkOut:r.CheckOut,lateMinutes:Number(r.LateMinutes||0),earlyMinutes:Number(r.EarlyMinutes||0),workedMinutes:worked,branch:r.BranchName};
 });
}
