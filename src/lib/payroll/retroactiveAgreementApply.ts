import 'server-only';
import { getPool, sql } from '@/lib/db';
import { previewRetroVip, prorateSalary, validateRetroInput, type RetroInput } from './retroactiveAgreementPreview';
import { buildMonthlySalaryRefType, buildMonthlySalaryNote } from '@/lib/services/employeeLedgerMonthlySalaryService';

export type ApplyRetroResult = {
  success: true;
  revisionId: number;
  alreadyApplied: boolean;
  month: string;
  voidedWageLedgerEntries: number;
  supersededDailyRows: number;
  newSalaryTotal: number;
};

/**
 * Applies a current-month retroactive hourly/daily -> per-branch monthly agreement.
 * Never deletes attendance, daily payroll, cash moves or payouts.
 * Requires the V2 migration and an explicit approved impact preview.
 */
export async function applyRetroVip(params: {
  empId: number; tenantId: string; userId: number | null;
  input: RetroInput;
}): Promise<ApplyRetroResult> {
  validateRetroInput(params.input);
  const key = params.input.requestKey;
  if (typeof key !== 'string' || !/^[a-zA-Z0-9_-]{16,80}$/.test(key)) {
    throw new Error('مفتاح تنفيذ فريد مطلوب لمنع الترحيل المكرر');
  }
  const canonicalInput = JSON.stringify({
    effectiveFrom: params.input.effectiveFrom,
    reason: params.input.reason.trim(),
    branches: [...params.input.branches].sort((a,b)=>a.branchId-b.branchId),
  });
  const db = await getPool();
  const tx = new sql.Transaction(db);
  await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
  const req = () => new sql.Request(tx);
  let committed = false;
  try {
    const existing = await req().input('key',sql.NVarChar(80),key)
      .query('SELECT RevisionID, EmpID, AgreementJson, ImpactJson FROM dbo.TblEmpPayrollAgreementRevision WITH (UPDLOCK, HOLDLOCK) WHERE RequestKey=@key');
    if (existing.recordset.length) {
      const old = existing.recordset[0];
      if (Number(old.EmpID)!==params.empId || String(old.AgreementJson)!==canonicalInput) {
        throw new Error('مفتاح العملية مستخدم بالفعل لتعديل آخر');
      }
      const impact = JSON.parse(String(old.ImpactJson));
      await tx.commit();
      committed=true;
      return {success:true,revisionId:Number(old.RevisionID),alreadyApplied:true,
        month:impact.month,voidedWageLedgerEntries:Number(impact.voidedWageLedgerEntries||0),
        supersededDailyRows:Number(impact.dailyCount||0),newSalaryTotal:Number(impact.proposedMonthlyAmount||0)};
    }

    const preview = await previewRetroVip({
      empId:params.empId,tenantId:params.tenantId,input:params.input,transaction:tx,
    });
    if (preview.blockers.length) throw new Error(preview.blockers.join(' | '));

    const oldPlans = await req().input('emp',sql.Int,params.empId)
      .query('SELECT PlanID, BranchID, PayType, EffectiveFrom, EffectiveTo, HourlyRate, DailyRate, MonthlySalary FROM dbo.TblEmpBranchPayrollPlan WITH (UPDLOCK, HOLDLOCK) WHERE EmpID=@emp AND IsActive=1');
    const revision = await req()
      .input('emp',sql.Int,params.empId)
      .input('key',sql.NVarChar(80),key)
      .input('effective',sql.Date,params.input.effectiveFrom)
      .input('agreement',sql.NVarChar(sql.MAX),canonicalInput)
      .input('before',sql.NVarChar(sql.MAX),JSON.stringify(oldPlans.recordset))
      .input('impact',sql.NVarChar(sql.MAX),JSON.stringify(preview))
      .input('count',sql.Int,preview.dailyCount)
      .input('amount',sql.Decimal(14,2),preview.previousDailyAmount)
      .input('userId',sql.Int,params.userId)
      .query([
        'INSERT dbo.TblEmpPayrollAgreementRevision',
        '(EmpID, RequestKey, EffectiveFrom, NewScope, AgreementJson, BeforeJson, ImpactJson,',
        'ReversedDailyCount, ReversedDailyAmount, CreatedByUserID)',
        "OUTPUT INSERTED.RevisionID VALUES (@emp,@key,@effective,N'branch_monthly',",
        '@agreement,@before,@impact,@count,@amount,@userId)'
      ].join(' '));
    const revisionId = Number(revision.recordset[0].RevisionID);

    // Mark the source, not just the ledger; otherwise reconciliation regenerates old wage credits.
    const superseded = await req().input('emp',sql.Int,params.empId)
      .input('effective',sql.Date,params.input.effectiveFrom)
      .input('today',sql.Date,preview.month+'-'+String(new Date(Date.UTC(Number(preview.month.slice(0,4)),Number(preview.month.slice(5,7)),0)).getUTCDate()).padStart(2,'0'))
      .input('revision',sql.BigInt,revisionId)
      .query([
        'UPDATE dbo.TblEmpDailyPayroll SET SupersededByPayrollRevisionID=@revision',
        'WHERE EmpID=@emp AND WorkDate>=@effective AND WorkDate<=@today',
        "AND Status=N'Generated' AND SupersededByPayrollRevisionID IS NULL"
      ].join(' '));
    if (Number(superseded.rowsAffected[0]||0)!==preview.dailyCount) {
      throw new Error('تغيرت اليوميات أثناء المعاينة؛ أعد معاينة التغيير');
    }
    const voided = await req().input('revision',sql.BigInt,revisionId)
      .input('emp',sql.Int,params.empId)
      .input('voidReason',sql.NVarChar(500),
        'تسوية اتفاقية قبض بأثر رجعي — مراجعة رقم '+revisionId)
      .query([
        'UPDATE le SET IsVoided=1, VoidReason=@voidReason, UpdatedAt=SYSDATETIME()',
        'FROM dbo.TblEmpLedgerEntry le',
        'INNER JOIN dbo.TblEmpDailyPayroll p ON p.ID=le.RefID',
        "WHERE le.RefType=N'TblEmpDailyPayroll' AND le.EntryReason=N'hourly_wage'",
        'AND le.IsVoided=0 AND le.EmpID=@emp AND p.SupersededByPayrollRevisionID=@revision'
      ].join(' '));
    const voidedCount=Number(voided.rowsAffected[0]||0);

    // Keep every prior version in the payroll plan table; never delete its amounts.
    await req().input('emp',sql.Int,params.empId)
      .input('effective',sql.Date,params.input.effectiveFrom)
      .query([
        'UPDATE dbo.TblEmpBranchPayrollPlan',
        'SET EffectiveTo=DATEADD(day,-1,@effective), UpdatedAt=SYSDATETIME()',
        'WHERE EmpID=@emp AND IsActive=1 AND EffectiveFrom<@effective',
        'AND (EffectiveTo IS NULL OR EffectiveTo>=@effective)'
      ].join(' '));
    const enabled=params.input.branches.filter(b=>b.enabled);
    for(const b of enabled) {
      await req().input('emp',sql.Int,params.empId).input('branch',sql.Int,b.branchId)
        .input('effective',sql.Date,params.input.effectiveFrom)
        .input('salary',sql.Decimal(12,2),b.monthlySalary)
        .input('note',sql.NVarChar(200),'Retroactive VIP agreement #'+revisionId)
        .query([
          'INSERT dbo.TblEmpBranchPayrollPlan',
          '(EmpID,BranchID,PayType,HourlyRate,DailyRate,MonthlySalary,EffectiveFrom,EffectiveTo,IsActive,SourceNotes)',
          "VALUES (@emp,@branch,N'monthly',NULL,NULL,@salary,@effective,NULL,1,@note)"
        ].join(' '));
      const portion=prorateSalary(params.input.effectiveFrom,b.monthlySalary);
      if(portion.amount<=0) throw new Error('الراتب الجزئي أقل من أقل وحدة مالية');
      const month=preview.month;
      const lastDay=String(portion.monthDays).padStart(2,'0');
      await req().input('emp',sql.Int,params.empId).input('branch',sql.Int,b.branchId)
        .input('month',sql.NVarChar(7),month)
        .input('postingDate',sql.Date,month+'-'+lastDay)
        .input('amount',sql.Decimal(12,2),portion.amount)
        .input('refType',sql.NVarChar(80),buildMonthlySalaryRefType(month))
        .input('notes',sql.NVarChar(500),buildMonthlySalaryNote(month))
        .input('user',sql.Int,params.userId)
        .query([
          'INSERT dbo.TblEmpLedgerEntry',
          '(BranchID,EmpID,EntryDate,EntryDirection,EntryReason,Amount,PayrollMonth,',
          'RefType,RefID,CashMoveID,AttendanceID,Notes,IsVoided,CreatedByUserID,CreatedAt)',
          "VALUES(@branch,@emp,@postingDate,N'credit',N'monthly_salary',@amount,@month,",
          '@refType,@emp,NULL,NULL,@notes,0,@user,SYSDATETIME())'
        ].join(' '));
    }
    await req().input('emp',sql.Int,params.empId)
      .input('tenant',sql.UniqueIdentifier,params.tenantId)
      .input('date',sql.Date,params.input.effectiveFrom)
      .query([
        "UPDATE dbo.TblEmp SET PayrollScope=N'branch_monthly', PayrollScopeEffectiveFrom=@date,",
        "PayrollMethod=N'monthly', SalaryType=N'monthly', IsPayrollEnabled=1",
        'WHERE EmpID=@emp AND TenantId=@tenant'
      ].join(' '));
    await req().input('emp',sql.Int,params.empId)
      .input('from',sql.Date,params.input.effectiveFrom)
      .input('before',sql.NVarChar(sql.MAX),JSON.stringify(oldPlans.recordset))
      .input('after',sql.NVarChar(sql.MAX),canonicalInput)
      .input('user',sql.Int,params.userId)
      .query([
        'INSERT dbo.TblEmpBranchPayrollAudit',
        '(EmpID,EffectiveFrom,OldPayrollScope,NewPayrollScope,BeforeJson,AfterJson,ChangedByUserID)',
        "VALUES(@emp,@from,N'global',N'branch_monthly',@before,@after,@user)"
      ].join(' '));
    await tx.commit();
    committed=true;
    return {success:true,revisionId,alreadyApplied:false,month:preview.month,
      supersededDailyRows:preview.dailyCount,voidedWageLedgerEntries:voidedCount,
      newSalaryTotal:preview.proposedMonthlyAmount};
  } catch(error) {
    if(!committed) await tx.rollback().catch(()=>undefined);
    throw error;
  }
}
