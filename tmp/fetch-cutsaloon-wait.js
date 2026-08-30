async function main() {
  const home = await (await fetch('https://cutsaloon.com/')).text();
  const prices = await (await fetch('https://cutsaloon.com/prices')).text();
  for (const [label, re] of [
    ['wait', /1\s*[–-]\s*10|دقايق|انتظار/i],
    ['essential', /GROOM ESSENTIAL[\s\S]{0,400}/i],
    ['complete', /GROOM COMPLETE[\s\S]{0,400}/i],
    ['addon150', /150 ج\.م[\s\S]{0,80}/],
    ['campaddr', /كامب شيزار[\s\S]{0,220}/],
    ['gleemaddr', /فرع جليم[\s\S]{0,280}/],
  ]) {
    const m = (label.startsWith('g') || label.startsWith('c') ? home : prices + home).match(re);
    console.log('\n' + label, m ? m[0].replace(/\s+/g, ' ').slice(0, 400) : 'NONE');
  }
  const waitHome = home.match(/1\s*[–-]\s*10[\s\S]{0,180}/);
  console.log('\nwaitHome', waitHome ? waitHome[0].replace(/\s+/g, ' ') : 'NONE');
}
main();
