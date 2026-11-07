/**
 * POST /api/admin/products/upload-image
 * multipart/form-data: file (required), productId (optional)
 */
import { NextRequest, NextResponse } from 'next/server';
import {
  formatCloudinaryError,
  isCloudinaryConfigured,
  uploadProductImageBuffer,
} from '@/lib/cloudinary';
import { requireAdmin, isAuthResult } from '@/lib/api-auth';

export const runtime = 'nodejs';

const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif']);

export async function POST(req: NextRequest) {
  try {
    const auth = await requireAdmin();
    if (!isAuthResult(auth)) return auth;

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
    const productIdRaw = form.get('productId');

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

    let productId: number | null = null;
    if (productIdRaw != null && String(productIdRaw).trim() !== '') {
      const n = Number(productIdRaw);
      if (Number.isFinite(n) && n > 0) productId = n;
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const baseName = file.name.replace(/\.[^.]+$/, '').trim() || null;
    const uploaded = await uploadProductImageBuffer({
      buffer,
      mimeType: file.type,
      productId,
      slug: productId ? `pro-${productId}` : baseName,
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
    console.error('[api/admin/products/upload-image]', message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
