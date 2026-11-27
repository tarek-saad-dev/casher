'use client';
import {useEffect,useState} from 'react';
const fields=[['firstVisit','أول زيارة','FirstVisitPct'],['student','طالب','StudentPct'],['club','CUT CLUB','ClubPct'],['multiService','خدمتان أو أكثر','MultiServicePct'],['friend1','صاحب جديد','Friend1Pct'],['friend2','صاحبان جديدان','Friend2Pct'],['friend3','3 أصحاب أو أكثر','Friend3Pct']] as const;
const actions:Record<string,Array<[string,string]>>={DRAFT:[['ACTIVATE','تفعيل الحملة'],['END','إنهاء']],ACTIVE:[['PAUSE','إيقاف مؤقت'],['END','إنهاء']],PAUSED:[['RESUME','استئناف الحملة'],['END','إنهاء']]};
const endpoint='/api/admin/offers/december/config';
export default function DecemberConfig(){
 const [reason,setReason]=useState(''),[action,setAction]=useState(''),[confirmed,setConfirmed]=useState(false);
 const [values,setValues]=useState<Record<string,string>>({}),[status,setStatus]=useState(''),[busy,setBusy]=useState(true),[error,setError]=useState(''),[saved,setSaved]=useState(false);
 useEffect(()=>{let alive=true;async function load(){try{const r=await fetch(endpoint,{cache:'no-store'});const d=await r.json();if(!r.ok||d.ok!==true)throw Error();if(alive){setStatus(d.campaign?.Status||'DRAFT');if(d.campaign)setValues(Object.fromEntries(fields.map(([k,,db])=>[k,String(d.campaign[db])])));}}catch{if(alive)setError('تعذر تحميل إعدادات الحملة.');}finally{if(alive)setBusy(false);}}void load();return()=>{alive=false;};},[]);
 async function save(e:React.FormEvent){e.preventDefault();if(busy||status!=='DRAFT')return;setBusy(true);setError('');setSaved(false);
 try{if(fields.some(([k])=>!/^\d{1,3}$/.test(values[k]||'')||Number(values[k])>100))throw Error('INVALID_RATES');
 const r=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({firstVisit:Number(values.firstVisit),student:Number(values.student),club:Number(values.club),multiService:Number(values.multiService),friends:[Number(values.friend1),Number(values.friend2),Number(values.friend3)]})});const d=await r.json();if(!r.ok||d.ok!==true)throw Error(d.code);setSaved(true);}
 catch{setError('تعذر حفظ النسب. تأكد من القيم وترتيب مستويات الدعوات وأن الحملة مسودة.');}finally{setBusy(false);}
 }
 async function changeState(e:React.FormEvent){e.preventDefault();if(busy||!confirmed||!action||reason.trim().length<5)return;setBusy(true);setError('');setSaved(false);
 try{const r=await fetch('/api/admin/offers/december/lifecycle',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,reason,confirm:true})});const d=await r.json();if(!r.ok||d.ok!==true)throw Error(d.code);setStatus(d.status);setAction('');setReason('');setConfirmed(false);}
 catch{setError('تعذر تغيير حالة الحملة. راجع جاهزية التشغيل والمدة المحددة.');}finally{setBusy(false);}}
 return <main dir="rtl" className="mx-auto max-w-3xl p-5 space-y-5">
 <header><p className="text-red-600 font-bold text-sm">CUT / DECEMBER EXAM</p><h1 className="text-3xl font-black">إعدادات الخصومات</h1><p className="text-muted-foreground mt-2">1–31 ديسمبر 2026 · توقيت القاهرة. حفظ المسودة لا ينشر الحملة أو يفعل الخصومات.</p></header>
 <a href="/admin/offers/december/analytics" className="underline text-sm ml-4">نتائج الحملة</a><a href="/admin/offers/december" className="underline text-sm">مراجعة المشاركين</a>
 <p>الحالة: {status||'غير متاحة'}</p>
 <form onSubmit={save} className="rounded-xl border p-5 space-y-4">
 {fields.map(([k,label])=><label key={k} className="flex items-center justify-between gap-4">{label}<span className="flex gap-2 items-center"><input required type="number" min={0} max={100} step={1} disabled={busy||status!=='DRAFT'} value={values[k]??''} onChange={e=>{setValues(v=>({...v,[k]:e.target.value}));setSaved(false);}} className="border bg-background p-2 rounded w-24"/>%</span></label>)}
 <button disabled={busy||status!=='DRAFT'} className="bg-[#CF252B] text-white rounded p-3 disabled:opacity-50">حفظ المسودة</button>
 {saved&&<p role="status" className="text-green-600">تم حفظ المسودة. الحملة غير مفعلة.</p>}{error&&<p role="alert" className="text-red-600">{error}</p>}
 </form>
 <form onSubmit={changeState} className="border rounded-xl p-5 space-y-3"><h2 className="font-bold text-xl">التحكم في الحملة</h2><p className="text-sm">التفعيل والاستئناف الحملة فقط. الإيقاف يمنع الاستحقاقات الجديدة، ولا يحذف الفواتير السابقة.</p>{(actions[status]||[]).length>0&&<><select required value={action} onChange={e=>{setAction(e.target.value);setConfirmed(false);}} className="border rounded bg-background w-full p-3"><option value="">اختار الإجراء</option>{(actions[status]||[]).map(([a,l])=><option key={a} value={a}>{l}</option>)}</select><textarea required minLength={5} maxLength={300} value={reason} onChange={e=>setReason(e.target.value)} placeholder="سبب الإجراء" className="border rounded bg-background w-full p-3"/><label className="flex gap-2"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/> أؤكد الإجراء (الإنهاء نهائي)</label><button disabled={busy||!confirmed||!action||reason.trim().length<5} className="border rounded p-3 disabled:opacity-50">تنفيذ الإجراء</button></>}</form></main>;
}
