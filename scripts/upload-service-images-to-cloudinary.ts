/**
 * Upload local public/services/* images to Cloudinary and update TblPro.ImageUrl.
 *
 * Usage:
 *   npx tsx scripts/upload-service-images-to-cloudinary.ts
 *   npx tsx scripts/upload-service-images-to-cloudinary.ts --dry-run
 *   npx tsx scripts/upload-service-images-to-cloudinary.ts --force
 *
 * Requires CLOUDINARY_CLOUD_NAME / CLOUDINARY_API_KEY / CLOUDINARY_API_SECRET
 * (from .env.local or process env).
 */
import { readFileSync, readdirSync, existsSync } from 'fs';
import path from 'path';
import Module from 'module';

// Allow importing Next `server-only` modules from a CLI script.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mod = Module as any;
const origLoad = mod._load;
mod._load = function (request: string, ...rest: unknown[]) {
  if (request === 'server-only') return {};
  return origLoad.call(this, request, ...rest);
};

const ROOT = process.cwd();
const SERVICES_DIR = path.join(ROOT, 'public', 'services');
const IMAGE_EXT = /\.(jpe?g|png|webp|gif)$/i;

function loadEnvLocal(): void {
  for (const envPath of ['.env.local', '.env']) {
    try {
      const envText = readFileSync(path.join(ROOT, envPath), 'utf8');
      for (const line of envText.split('\n')) {
        const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
        if (match && !process.env[match[1]]) {
          let value = match[2].trim();
          value = value.replace(/^["']|["']$/g, '');
          process.env[match[1]] = value;
        }
      }
    } catch {
      /* missing file ok */
    }
  }
}

function isCloudinaryUrl(url: string | null | undefined): boolean {
  const u = String(url ?? '').trim().toLowerCase();
  return u.includes('res.cloudinary.com') || u.includes('cloudinary.com/');
}

function isLocalServicesPath(url: string | null | undefined): boolean {
  const u = String(url ?? '').trim();
  return /^\/services\/[a-z0-9._-]+\.(jpe?g|png|webp|gif)$/i.test(u);
}

function localPathFromUrl(url: string): string | null {
  if (!isLocalServicesPath(url)) return null;
  return path.join(ROOT, 'public', url.replace(/^\//, '').replace(/\//g, path.sep));
}

async function main() {
  loadEnvLocal();
  const dryRun = process.argv.includes('--dry-run');
  const force = process.argv.includes('--force');

  const { isCloudinaryConfigured, uploadServiceImageBuffer } = await import(
    '../src/lib/cloudinary'
  );
  const { getPool, sql } = await import('../src/lib/db');
  const { ensureTblProImageUrlColumn } = await import(
    '../src/lib/migrations/ensureServiceImageUrl'
  );
  const { SERVICE_IMAGE_BY_PRO_NAME } = await import('../src/lib/serviceImages');
  const { invalidatePublicBookingServicesCache } = await import(
    '../src/lib/booking/publicBookingServices'
  );

  if (!isCloudinaryConfigured()) {
    console.error(
      'Missing Cloudinary env: CLOUDINARY_CLOUD_NAME / CLOUDINARY_API_KEY / CLOUDINARY_API_SECRET',
    );
    process.exit(1);
  }

  if (!existsSync(SERVICES_DIR)) {
    console.error(`Missing folder: ${SERVICES_DIR}`);
    process.exit(1);
  }

  const files = readdirSync(SERVICES_DIR).filter((f) => IMAGE_EXT.test(f));
  console.log(`Found ${files.length} local image(s) in public/services/`);
  if (dryRun) console.log('DRY RUN — no uploads / DB writes');

  /** slug (filename without ext) → cloudinary secure URL */
  const uploadedBySlug = new Map<string, string>();
  /** relative path `/services/foo.jpg` → cloudinary URL */
  const uploadedByLocalPath = new Map<string, string>();

  for (const file of files) {
    const abs = path.join(SERVICES_DIR, file);
    const slug = file.replace(/\.[^.]+$/, '');
    const localPath = `/services/${file}`;
    const buffer = readFileSync(abs);
    console.log(`\n→ ${localPath} (${buffer.length} bytes)`);

    if (dryRun) {
      uploadedBySlug.set(slug, `https://example.invalid/dry-run/services/${slug}`);
      uploadedByLocalPath.set(localPath.toLowerCase(), uploadedBySlug.get(slug)!);
      console.log('  dry-run skip upload');
      continue;
    }

    const uploaded = await uploadServiceImageBuffer({
      buffer,
      slug,
      fileName: file,
    });
    uploadedBySlug.set(slug, uploaded.secureUrl);
    uploadedByLocalPath.set(localPath.toLowerCase(), uploaded.secureUrl);
    console.log(`  uploaded → ${uploaded.secureUrl}`);
  }

  const db = await getPool();
  const hasCol = await ensureTblProImageUrlColumn(db);
  if (!hasCol) {
    console.error('TblPro.ImageUrl column unavailable');
    process.exit(1);
  }

  const rows = await db.request().query(`
    SELECT ProID, ProName, ProNameAr, ImageUrl
    FROM dbo.TblPro
    ORDER BY ProID
  `);

  let updated = 0;
  let skipped = 0;
  let missing = 0;

  for (const row of rows.recordset as Array<{
    ProID: number;
    ProName: string | null;
    ProNameAr: string | null;
    ImageUrl: string | null;
  }>) {
    const current = String(row.ImageUrl ?? '').trim();
    if (current && isCloudinaryUrl(current) && !force) {
      skipped++;
      continue;
    }

    let nextUrl: string | null = null;

    // 1) Current local /services/... path
    if (isLocalServicesPath(current)) {
      nextUrl = uploadedByLocalPath.get(current.toLowerCase()) ?? null;
      if (!nextUrl) {
        const disk = localPathFromUrl(current);
        if (disk && existsSync(disk) && !dryRun) {
          const file = path.basename(disk);
          const slug = file.replace(/\.[^.]+$/, '');
          const buffer = readFileSync(disk);
          const uploaded = await uploadServiceImageBuffer({ buffer, slug, fileName: file });
          nextUrl = uploaded.secureUrl;
          uploadedByLocalPath.set(current.toLowerCase(), nextUrl);
        }
      }
    }

    // 2) Known ProName / Arabic mapping → uploaded slug
    if (!nextUrl) {
      const mapped =
        (row.ProName && SERVICE_IMAGE_BY_PRO_NAME[String(row.ProName).trim()]) ||
        (row.ProNameAr && SERVICE_IMAGE_BY_PRO_NAME[String(row.ProNameAr).trim()]) ||
        null;
      if (mapped) {
        nextUrl = uploadedByLocalPath.get(mapped.toLowerCase()) ?? null;
      }
    }

    if (!nextUrl) {
      if (current && !isCloudinaryUrl(current)) {
        console.log(`MISS  #${row.ProID} ${row.ProName} (kept ${current || 'null'})`);
      }
      missing++;
      continue;
    }

    if (dryRun) {
      console.log(`DRY   #${row.ProID} ${row.ProName} → ${nextUrl}`);
      updated++;
      continue;
    }

    await db
      .request()
      .input('ProID', sql.Int, row.ProID)
      .input('ImageUrl', sql.NVarChar(1000), nextUrl)
      .query(`UPDATE dbo.TblPro SET ImageUrl = @ImageUrl WHERE ProID = @ProID`);

    console.log(`OK    #${row.ProID} ${row.ProName} → ${nextUrl}`);
    updated++;
  }

  if (!dryRun && updated > 0) {
    invalidatePublicBookingServicesCache();
  }

  console.log(
    `\nDone. uploadedFiles=${files.length} updatedRows=${updated} skippedCloudinary=${skipped} noMatch=${missing}${
      dryRun ? ' (dry-run)' : ''
    }`,
  );
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
