'use client';
import {useCallback,useEffect,useState} from 'react';
type Row={EmpID:number;EmpName:string;Job:string|null;LoginName:string|null;IsEnabled:boolean|null};
export default function EmployeePortalAccountsPanel(){
 const [rows,setRows]=useState<Row[]>([]);
 const [password,setPassword]=useState('');
 const [busy,setBusy]=useState(false);
 const [message,setMessage]=useState('');
 const load=useCallback(async()=>{const r=await fetch('/api/admin/hr/employee-portal-accounts');if(r.ok){const data=await r.json();setRows(data.employees||[]);}else setMessage('تعذر عرض الحسابات؛ يلزم صلاحية الإدارة أو تشغيل Migration');},[]);
 useEffect(()=>{void load();},[load]);
 async function createAll(){
  if(password.length<12){setMessage('الباسورد المبدئي لازم 12 حرف على الأقل');return;}
  setBusy(true);setMessage('');
  try{
   const r=await fetch('/api/admin/hr/employee-portal-accounts/bulk',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({temporaryPassword:password})});
   const d=await r.json();if(!r.ok)throw Error(d.error||'فشل إنشاء الحسابات');
   setPassword('');setMessage(`تم إنشاء ${d.count} حساب جديد. لازم كل موظف يغير الباسورد في أول دخول.`);
   await load();
  }catch(e){setMessage(e instanceof Error?e.message:'حدث خطأ');}finally{setBusy(false);}
 }
 return <section dir="rtl" className="space-y-5 p-5 rounded-xl border border-border">
  <h2 className="text-xl font-bold">بوابة الموظفين — حسابات الدخول</h2>
  <p className="text-sm text-muted-foreground">لكل موظف نشط حساب باسم مميز. كلمة المرور المؤقتة تنطبق على الحسابات الجديدة فقط ويجب تغييرها قبل عرض بيانات الرواتب.</p>
  <div className="flex flex-wrap items-end gap-3">
   <label className="text-sm">كلمة المرور المبدئية للحسابات الجديدة<input type="password" autoComplete="new-password" minLength={12} value={password} onChange={e=>setPassword(e.target.value)} className="mt-2 block rounded-lg border border-border bg-background p-3" /></label>
   <button disabled={busy||password.length<12} onClick={createAll} className="rounded-lg bg-primary text-primary-foreground px-4 py-3 disabled:opacity-50">إنشاء حسابات كل الموظفين النشطين غير المسجلين</button>
  </div>
  {message&&<p role="status">{message}</p>}
  <div className="overflow-x-auto"><table className="w-full text-sm text-right"><thead><tr className="border-b border-border"><th className="p-3">الموظف</th><th className="p-3">الوظيفة</th><th className="p-3">اسم الدخول</th><th className="p-3">الحالة</th></tr></thead><tbody>
   {rows.map(r=><tr key={r.EmpID} className="border-b border-border/50"><td className="p-3">{r.EmpName}</td><td className="p-3">{r.Job||'—'}</td><td className="p-3" dir="auto">{r.LoginName||'لم يُنشأ'}</td><td className="p-3">{r.LoginName?(r.IsEnabled?'مفعّل':'معطل'):'جديد'}</td></tr>)}
  </tbody></table></div>
  <p className="text-sm text-muted-foreground">رابط دخول الموظف: /employee-portal — الحسابات القديمة لا تتغير كلمة مرورها أثناء الإنشاء الجماعي.</p>
 </section>;
}
