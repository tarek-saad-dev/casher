import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getUserAccess } from '@/lib/permissions-server';
import { rejectRequest } from '@/lib/approvalWorkflow';

type Ctx = { params: Promise<{ id: string }> };

// POST /api/admin/approvals/:id/reject — super_admin only
export async function POST(req: NextRequest, { params }: Ctx) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 });

  const access = await getUserAccess(session.UserID, session.UserName, session.UserLevel);
  if (!access.isSuperAdmin) return NextResponse.json({ error: 'super_admin only' }, { status: 403 });

  const { id } = await params;
  const approvalId = parseInt(id);
  if (isNaN(approvalId)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

  const body = await req.json().catch(() => ({}));
  const note: string | undefined = body?.note;

  const result = await rejectRequest(approvalId, session.UserID, session.UserName, note);

  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
