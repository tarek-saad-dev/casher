/** Romanize Arabic employee display names into login-safe ASCII letters. */
const letters: Record<string,string> = {
'ا':'a','أ':'a','إ':'a','آ':'a','ب':'b','ت':'t','ث':'th','ج':'g','ح':'h','خ':'kh','د':'d','ذ':'z','ر':'r','ز':'z','س':'s','ش':'sh','ص':'s','ض':'d','ط':'t','ظ':'z','ع':'a','غ':'gh','ف':'f','ق':'q','ك':'k','ل':'l','م':'m','ن':'n','ه':'h','ة':'a','و':'w','ؤ':'w','ي':'y','ى':'a','ئ':'y','ء':'','پ':'p','چ':'ch','ڤ':'v','گ':'g'
};
export function employeeUsernameBase(name:string):string {
  const romanized = name.trim().toLowerCase().normalize('NFKD').replace(/[\u064b-\u065f\u0670]/g,'')
    .split('').map(c=>letters[c]??c).join('')
    .replace(/[^a-z\s]/g,' ').trim().replace(/\s+/g,'.').replace(/^\.+|\.+$/g,'').slice(0,48);
  return romanized || 'employee';
}
export function alphaSuffix(index:number):string {
  let n=index; let result='';
  do {result=String.fromCharCode(97+n%26)+result;n=Math.floor(n/26)-1;} while(n>=0);
  return result;
}
export function pickEmployeeUsername(name:string, occupied:Set<string>):string {
  const base=employeeUsernameBase(name);
  let candidate=base; let i=0;
  while(occupied.has(candidate.toLowerCase())) candidate=base+'.'+alphaSuffix(i++);
  occupied.add(candidate.toLowerCase());return candidate;
}
