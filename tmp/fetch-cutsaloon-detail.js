function snippet(text, re, pad = 180) {
  const m = text.match(re);
  if (!m || m.index == null) return null;
  return text.slice(Math.max(0, m.index - pad), Math.min(text.length, m.index + pad));
}

async function main() {
  for (const url of ['https://cutsaloon.com/', 'https://cutsaloon.com/prices', 'https://cutsaloon.com/book', 'https://cutsaloon.com/booking']) {
    const res = await fetch(url, { redirect: 'follow' });
    const text = await res.text();
    const maps = [...text.matchAll(/https:\/\/maps\.app\.goo\.gl\/[A-Za-z0-9]+/g)].map((m) => m[0]);
    const social = [...text.matchAll(/https?:\/\/(?:www\.)?(instagram|facebook|tiktok)\.com\/[^\s"'<>]+/gi)].map((m) => m[0]);
    console.log('\n====', url, res.status, '====');
    console.log('maps', [...new Set(maps)]);
    console.log('social', [...new Set(social)]);
    console.log('50pct', snippet(text, /50\s*%|خصم 50|أول زيارة|first visit/i));
    console.log('groom', snippet(text, /1250|1650|2100|Essential|Signature/i));
    console.log('gleem', snippet(text, /جليم|Gleem|GLEEM/i));
    console.log('camp', snippet(text, /كامب|Camp Caesar|CAMP_CAESAR/i));
  }
}
main();
