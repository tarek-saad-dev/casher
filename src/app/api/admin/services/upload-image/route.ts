/**
 * POST /api/admin/services/upload-image
 * multipart/form-data: file (required), serviceId (optional)
 * Admin session required. Uploads to Cloudinary folder `services/` and returns secure_url.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import {
  formatCloudinaryError,
  isCloudinaryConfigured,
  uploadServiceImageBuffer,
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
    const serviceIdRaw = form.get('serviceId');

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

    let serviceId: number | null = null;
    if (serviceIdRaw != null && String(serviceIdRaw).trim() !== '') {
      const n = Number(serviceIdRaw);
      if (Number.isFinite(n) && n > 0) serviceId = n;
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const baseName = file.name.replace(/\.[^.]+$/, '').trim() || null;
    const uploaded = await uploadServiceImageBuffer({
      buffer,
      mimeType: file.type,
      serviceId,
      slug: serviceId ? `svc-${serviceId}` : baseName,
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
    console.error('[api/admin/services/upload-image]', message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
