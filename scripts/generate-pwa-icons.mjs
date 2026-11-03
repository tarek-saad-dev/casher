import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

async function makeIcon({ outDir, bg, accent, label, sizes }) {
  fs.mkdirSync(outDir, { recursive: true });
  for (const size of sizes) {
    const pad = Math.round(size * 0.18);
    const logoSize = Math.round(size * 0.55);
    const svg = Buffer.from(`<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="${bg[0]}"/>
          <stop offset="100%" stop-color="${bg[1]}"/>
        </linearGradient>
      </defs>
      <rect width="${size}" height="${size}" rx="${Math.round(size * 0.18)}" fill="url(#g)"/>
      <circle cx="${size * 0.82}" cy="${size * 0.18}" r="${size * 0.09}" fill="${accent}" opacity="0.9"/>
      <text x="${size * 0.5}" y="${size * 0.92}" text-anchor="middle" font-family="Arial Black, Arial, sans-serif" font-size="${Math.round(size * 0.11)}" font-weight="700" fill="${accent}" letter-spacing="1">${label}</text>
    </svg>`);
    const base = await sharp(svg).png().toBuffer();
    const logo = await sharp('public/cutsalon.png')
      .resize(logoSize, logoSize, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();
    await sharp(base)
      .composite([{ input: logo, top: pad, left: Math.round((size - logoSize) / 2) }])
      .png()
      .toFile(path.join(outDir, `icon-${size}.png`));
  }
  await sharp(path.join(outDir, 'icon-192.png'))
    .resize(180, 180)
    .png()
    .toFile(path.join(outDir, 'apple-touch-icon.png'));
}

await makeIcon({
  outDir: 'public/icons/cut-system',
  bg: ['#0B1220', '#152238'],
  accent: '#7DD3FC',
  label: 'SYSTEM',
  sizes: [192, 512],
});
await makeIcon({
  outDir: 'public/icons/cut-staff',
  bg: ['#1A140C', '#2A1F12'],
  accent: '#FBBF24',
  label: 'STAFF',
  sizes: [192, 512],
});
console.log('icons ok');
