import { NextRequest, NextResponse } from 'next/server';
import { isAuthResult, requirePageAccess } from '@/lib/api-auth';
import { BranchDomainError } from '@/lib/branch/types';
import {
  listLaunchRosterEmployees,
  loadBookableServiceCatalog,
  removeLaunchRosterAssignment,
} from '@/lib/branch/launchRosterService';
import { commitEmployeeBranchAssignment } from '@/lib/branch/employeeAssignmentCommit';
import { SchedulePolicyError } from '@/lib/hr/employeeBranchScheduleSave';

export const runtime = 'nodejs';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requirePageAccess('/admin/branches');
  if (!isAuthResult(auth)) return auth;
  const branchId = Number((await params).id);
  if (!Number.isFinite(branchId)) {
    return NextResponse.json({ error: 'معرف فرع غير صالح' }, { status: 400 });
  }
  try {
    const [roster, services] = await Promise.all([
      listLaunchRosterEmployees(branchId),
      loadBookableServiceCatalog(),
    ]);
    return NextResponse.json({ ok: true, ...roster, services });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'فشل التحميل';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requirePageAccess('/admin/branches');
  if (!isAuthResult(auth)) return auth;
  const branchId = Number((await params).id);
  if (!Number.isFinite(branchId)) {
    return NextResponse.json({ error: 'معرف فرع غير صالح' }, { status: 400 });
  }

  try {
    const body = await req.json();
    const action = String(body.action || 'assign').toLowerCase();

    if (action === 'remove') {
      const empId = Number(body.empId);
      if (!Number.isFinite(empId)) {
        return NextResponse.json({ error: 'معرف موظف غير صالح' }, { status: 400 });
      }
      const result = await removeLaunchRosterAssignment({
        empId,
        branchId,
        actorUserId: auth.userId,
      });
      return NextResponse.json({ ok: true, ...result });
    }

    const result = await commitEmployeeBranchAssignment({
      empId: Number(body.empId),
      branchId,
      effectiveFrom: String(body.effectiveFrom),
      canReceiveBookings: Boolean(body.canReceiveBookings),
      canOperate: Boolean(body.canOperate),
      isHomeBranch: Boolean(body.isHomeBranch),
      schedule: Array.isArray(body.schedule) ? body.schedule : [],
      serviceProIds: Array.isArray(body.serviceProIds)
        ? body.serviceProIds.map(Number).filter((n: number) => Number.isFinite(n))
        : [],
      payroll: body.payroll,
      target: body.target,
      actorUserId: auth.userId,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (e: unknown) {
    if (e instanceof BranchDomainError) {
      return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
    }
    if (e instanceof SchedulePolicyError) {
      return NextResponse.json({ error: e.message, code: e.code, details: e.details }, { status: e.status });
    }
    const msg = e instanceof Error ? e.message : 'فشل الحفظ';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
