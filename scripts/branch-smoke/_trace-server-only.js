const fs = require('fs');
const path = require('path');
const seen = new Set();
function walk(file) {
  if (seen.has(file) || !fs.existsSync(file)) return;
  seen.add(file);
  const src = fs.readFileSync(file, 'utf8');
  if (src.includes("from 'server-only'") || src.includes('from "server-only"')) {
    console.log('HAS server-only:', file);
  }
  const re = /from ['"](@\/[^'"]+|\\.\\.\/[^'"]+|\\.\/[^'"]+)['"]/g;
  let m;
  while ((m = re.exec(src))) {
    let p = m[1];
    if (p.startsWith('@/')) p = path.join('src', p.slice(2));
    else p = path.resolve(path.dirname(file), p);
    if (!p.endsWith('.ts') && !p.endsWith('.tsx')) {
      if (fs.existsSync(p + '.ts')) p += '.ts';
      else if (fs.existsSync(p + '.tsx')) p += '.tsx';
      else continue;
    }
    walk(p);
  }
}
walk('src/lib/bookingAvailabilityEngine.ts');
