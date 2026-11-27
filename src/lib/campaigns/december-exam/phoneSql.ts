/** SQL expressions only for trusted column aliases; mirror registration's Egyptian
 * phone normalization, including Arabic and Persian digits. All values stay bound. */
export function decemberPhoneSql(column:'Mobile'|'x.Mobile'|'cl.Mobile'){
 let clean=`TRANSLATE(CONVERT(nvarchar(64),${column}),N'٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹',N'01234567890123456789')`;
 for(const ch of ["N' '","N'-'","N'('","N')'","NCHAR(9)","NCHAR(10)","NCHAR(13)","NCHAR(160)","NCHAR(8239)"])clean=`REPLACE(${clean},${ch},N'')`;
 return clean;
}
/** Only accept the supported exact prefixes; no removal of internal plus signs. */
export const decemberCanonicalPhoneSql=`CASE
 WHEN LEN(m.clean)=11 AND LEFT(m.clean,2)=N'01' THEN N'+2'+m.clean
 WHEN LEN(m.clean)=13 AND LEFT(m.clean,4)=N'+201' THEN m.clean
 WHEN LEN(m.clean)=14 AND LEFT(m.clean,4)=N'0020' THEN N'+'+SUBSTRING(m.clean,3,12)
 WHEN LEN(m.clean)=12 AND LEFT(m.clean,3)=N'201' THEN N'+'+m.clean
 ELSE NULL END`;
