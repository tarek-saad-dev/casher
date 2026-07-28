/**
 * POST /api/admin/employees/upload-image
 * multipart/form-data: file (required), empId (optional)
 * Admin session required. Uploads to Cloudinary and returns secure_url.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import {
  formatCloudinaryError,
  isCloudinaryConfigured,
  uploadEmployeeImageBuffer,
} from '@/lib/cloudinary';

export const runtime = 'nodejs';

const MAX_BYTES = 5 * 1024 * 1024; // 5MB
const ALLOWED = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif']);

export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session || session.UserLevel !== 'admin') {
      return NextResponse.json(
        { ok: false, error: 'غير مصرح - يتطلب صلاحيات المدير' },
        { status: 403 },
      );
    }

    if (!isCloudinaryConfigured()) {
      return NextResponse.json(
        {
          ok: false,
          error:
            'Cloudinary غير مضبوط على السيرفر — أضف CLOUDINARY_CLOUD_NAME / API_KEY / API_SECRET',
        },
        { status: 500 },
      );
    }

    const form = await req.formData();
    const file = form.get('file');
    const empIdRaw = form.get('empId');

    if (!file || !(file instanceof File)) {
      return NextResponse.json({ ok: false, error: 'الملف مطلوب' }, { status: 400 });
    }

    if (!ALLOWED.has(file.type)) {
      return NextResponse.json(
        { ok: false, error: 'صيغة غير مدعومة — استخدم JPG أو PNG أو WebP' },
        { status: 400 },
      );
    }

    if (file.size <= 0 || file.size > MAX_BYTES) {
      return NextResponse.json(
        { ok: false, error: 'حجم الصورة يجب أن يكون أقل من 5 ميجابايت' },
        { status: 400 },
      );
    }

    let empId: number | null = null;
    if (empIdRaw != null && String(empIdRaw).trim() !== '') {
      const n = Number(empIdRaw);
      if (Number.isFinite(n) && n > 0) empId = n;
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const uploaded = await uploadEmployeeImageBuffer({
      buffer,
      mimeType: file.type,
      empId,
      fileName: file.name,
    });

    return NextResponse.json({
      ok: true,
      imageUrl: uploaded.secureUrl,
      publicId: uploaded.publicId,
      width: uploaded.width,
      height: uploaded.height,
      format: uploaded.format,
      bytes: uploaded.bytes,
    });
  } catch (err: unknown) {
    const message = formatCloudinaryError(err);
    console.error('[api/admin/employees/upload-image]', message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
