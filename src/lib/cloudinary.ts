import 'server-only';
import { v2 as cloudinary } from 'cloudinary';

function envVal(key: string): string {
  return String(process.env[key] ?? '')
    .trim()
    .replace(/^["']|["']$/g, '');
}

export function formatCloudinaryError(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  if (err && typeof err === 'object') {
    const obj = err as Record<string, unknown>;
    if (typeof obj.message === 'string' && obj.message.trim()) return obj.message.trim();
    const nested = obj.error;
    if (nested && typeof nested === 'object') {
      const inner = nested as Record<string, unknown>;
      if (typeof inner.message === 'string' && inner.message.trim()) {
        return inner.message.trim();
      }
    }
    try {
      return JSON.stringify(err);
    } catch {
      /* ignore */
    }
  }
  if (typeof err === 'string' && err.trim()) return err.trim();
  return 'Unknown Cloudinary error';
}

export function isCloudinaryConfigured(): boolean {
  return Boolean(envVal('CLOUDINARY_CLOUD_NAME') && envVal('CLOUDINARY_API_KEY') && envVal('CLOUDINARY_API_SECRET'));
}

export function getCloudinary() {
  const cloud_name = envVal('CLOUDINARY_CLOUD_NAME');
  const api_key = envVal('CLOUDINARY_API_KEY');
  const api_secret = envVal('CLOUDINARY_API_SECRET');
  if (!cloud_name || !api_key || !api_secret) {
    throw new Error('Cloudinary غير مضبوط — أضف CLOUDINARY_* في البيئة');
  }
  cloudinary.config({
    cloud_name,
    api_key,
    api_secret,
    secure: true,
  });
  return cloudinary;
}

export type CloudinaryUploadResult = {
  secureUrl: string;
  publicId: string;
  width: number | null;
  height: number | null;
  format: string | null;
  bytes: number | null;
};

async function uploadImageBuffer(args: {
  buffer: Buffer;
  folder: string;
  publicIdBase: string;
}): Promise<CloudinaryUploadResult> {
  const api = getCloudinary();

  let result: {
    secure_url?: string;
    public_id?: string;
    width?: number;
    height?: number;
    format?: string;
    bytes?: number;
  };
  try {
    result = await new Promise((resolve, reject) => {
      const stream = api.uploader.upload_stream(
        {
          folder: args.folder,
          public_id: args.publicIdBase,
          resource_type: 'image',
          overwrite: true,
          // Eager transforms can fail on some plans; keep upload simple.
          transformation: [{ width: 1200, height: 1200, crop: 'limit', quality: 'auto:good' }],
        },
        (err, res) => {
          if (err || !res?.secure_url) {
            reject(err ?? new Error('Cloudinary upload failed'));
            return;
          }
          resolve(res);
        },
      );
      stream.end(args.buffer);
    });
  } catch (err) {
    const msg = formatCloudinaryError(err);
    if (/cloud_name mismatch/i.test(msg)) {
      throw new Error(
        `Cloudinary: cloud_name غير صحيح (الحالي: "${envVal('CLOUDINARY_CLOUD_NAME')}"). انسخ Cloud name من Settings في لوحة Cloudinary.`,
      );
    }
    if (/invalid.*api|unauthorized|401/i.test(msg)) {
      throw new Error(`Cloudinary: مفتاح API غير صالح — ${msg}`);
    }
    throw new Error(`Cloudinary: ${msg}`);
  }

  if (!result.secure_url || !result.public_id) {
    throw new Error('Cloudinary لم يُرجع رابط صورة');
  }

  return {
    secureUrl: result.secure_url,
    publicId: result.public_id,
    width: result.width ?? null,
    height: result.height ?? null,
    format: result.format ?? null,
    bytes: result.bytes ?? null,
  };
}

/** Upload image buffer to Cloudinary folder `employees/`. */
export async function uploadEmployeeImageBuffer(args: {
  buffer: Buffer;
  mimeType: string;
  empId?: number | null;
  fileName?: string | null;
}): Promise<CloudinaryUploadResult> {
  const publicIdBase =
    args.empId && Number.isFinite(args.empId)
      ? `emp-${args.empId}-${Date.now()}`
      : `emp-${Date.now()}`;
  return uploadImageBuffer({
    buffer: args.buffer,
    folder: 'employees',
    publicIdBase,
  });
}

/** Upload image buffer to Cloudinary folder `services/`. */
export async function uploadServiceImageBuffer(args: {
  buffer: Buffer;
  mimeType?: string;
  serviceId?: number | null;
  /** Stable slug e.g. "haircut" — used as public_id when provided. */
  slug?: string | null;
  fileName?: string | null;
}): Promise<CloudinaryUploadResult> {
  const slug =
    args.slug?.trim().replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') ||
    null;
  const publicIdBase =
    slug ||
    (args.serviceId && Number.isFinite(args.serviceId)
      ? `svc-${args.serviceId}-${Date.now()}`
      : `svc-${Date.now()}`);
  return uploadImageBuffer({
    buffer: args.buffer,
    folder: 'services',
    publicIdBase,
  });
}
