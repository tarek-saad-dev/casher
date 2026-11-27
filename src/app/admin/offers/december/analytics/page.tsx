'use client';
import {useCallback,useEffect,useState} from 'react';
type Data={status:string;participants:{registered:number;verified:number;students:number;verifiedStudents:number};referrals:{status:string;count:number}[];sales:{redeemed:number;freeInvoices:number;grossMinor:number;discountMinor:number;netMinor:number};education:{educationType:string;institution:string;faculty:string|null;count:number}[];branches:{branchId:number;redeemed:number;netMinor:number}[]};
const money=(n:number)=>(Number(n)/100).toLocaleString('ar-EG',{style:'currency',currency:'EGP'});
export default function DecemberAnalytics(){
 const [data,setData]=useState<Data|null>(null),[busy,setBusy]=useState(true),[error,setError]=useState('');
 const load=useCallback(async()=>{setBusy(true);setError('');try{const r=await fetch('/api/admin/offers/december/analytics',{cache:'no-store'});const d=await r.json();if(!r.ok||d.ok!==true)throw Error();setData(d);}catch{setData(null);setError('تعذر تحميل تقارير الحملة.');}finally{setBusy(false);}},[]);
 useEffect(()=>{void load();},[load]);
 return <main dir="rtl" className="mx-auto max-w-6xl p-5 space-y-6">
 <header className="flex flex-wrap justify-between gap-3"><div><p className="text-red-600 font-bold text-sm">CUT / DECEMBER EXAM</p><h1 className="text-3xl font-black">نتائج الحملة</h1><p className="text-muted-foreground">بيانات فعلية من سجلات الحملة والفواتير غير الملغاة.</p></div><button onClick={()=>void load()} disabled={busy} className="border rounded px-4 py-2">تحديث</button></header>
 <nav className="flex gap-4 text-sm"><a className="underline" href="/admin/offers/december">المشاركون</a><a className="underline" href="/admin/offers/december/config">الإعدادات</a></nav>
 {busy&&<p role="status">جاري التحميل…</p>}{error&&<p role="alert">{error}</p>}
 {data&&<><p>الحالة: {data.status}</p><div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
 {([['المسجلون',data.participants.registered],['هويات معتمدة',data.participants.verified],['طلاب مسجلون',data.participants.students],['طلاب معتمدون',data.participants.verifiedStudents],['فواتير العرض',data.sales.redeemed],['فواتير مجانية',data.sales.freeInvoices],['إجمالي الخصم',money(data.sales.discountMinor)],['صافي فواتير العرض',money(data.sales.netMinor)]]).map(([label,value])=><div key={label} className="border rounded-xl p-4"><p className="text-sm text-muted-foreground">{label}</p><p className="text-xl font-bold">{value}</p></div>)}</div>
 <section className="border rounded-xl p-4"><h2 className="font-bold">حالات الدعوات</h2><div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">{['PENDING','CONFIRMED','REJECTED','VOIDED'].map(s=><div key={s}><p className="text-xs">{({PENDING:'معلقة',CONFIRMED:'مؤكدة',REJECTED:'مرفوضة',VOIDED:'ملغاة'} as Record<string,string>)[s]}</p><p className="font-bold">{data.referrals.find(r=>r.status===s)?.count??0}</p></div>)}</div></section>
 <section className="border rounded-xl p-4"><h2 className="font-bold">المؤسسات التعليمية المعتمدة</h2><div className="overflow-auto"><table className="w-full text-sm text-right"><thead><tr><th>المؤسسة</th><th>الكلية / التخصص</th><th>الطلاب</th></tr></thead><tbody>{data.education.map((r,i)=><tr key={i} className="border-t"><td className="py-2">{r.institution}</td><td>{r.faculty||'—'}</td><td>{r.count}</td></tr>)}</tbody></table></div></section>
 <section className="border rounded-xl p-4"><h2 className="font-bold">الفروع</h2>{data.branches.map(b=><p key={b.branchId} className="py-2">فرع #{b.branchId}: {b.redeemed} فاتورة · {money(b.netMinor)}</p>)}</section>
 <p className="text-xs text-muted-foreground">صافي فواتير العرض قبل تكلفة التشغيل والعمولات؛ ليس صافي ربح أو إجمالي مبيعات الفروع.</p></>}
 </main>;
}
