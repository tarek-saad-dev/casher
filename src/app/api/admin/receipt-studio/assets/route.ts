import { NextRequest, NextResponse } from 'next/server';
import { isAuthResult, requireAdmin } from '@/lib/api-auth';
import { uploadStudioPng, StudioError } from '@/lib/receipt-studio/storage';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const auth = await requireAdmin();
  if (!isAuthResult(auth)) return auth;
  try {
    if (Number(req.headers.get('content-length') || 0) > 200000) {
      return NextResponse.json({ ok: false, error: 'PNG exceeds upload size limit' }, { status: 413 });
    }
    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof File) || file.type !== 'image/png' || file.size > 153600 || file.size < 45) {
      return NextResponse.json({ ok: false, error: 'ارفع صورة PNG فقط بحجم أقل من 150KB' }, { status: 400 });
    }
    const assetId = await uploadStudioPng(auth.tenantId, auth.userId, Buffer.from(await file.arrayBuffer()));
    return NextResponse.json({ ok: true, assetId });
  } catch (e) {
    if (e instanceof StudioError) return NextResponse.json({ ok: false, code: e.code, error: e.message }, { status: e.status });
    console.error('[receipt-studio asset]', e);
    return NextResponse.json({ ok: false, error: 'تعذر رفع الصورة' }, { status: 500 });
  }
}
