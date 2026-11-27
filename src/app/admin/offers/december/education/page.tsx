'use client';
import {useEffect,useState,useCallback} from 'react';
type Entry={EntryId:string;EducationType:string;Institution:string;FacultyOrSpecialization:string;IsActive:boolean};
const endpoint='/api/admin/offers/december/education';
export default function EducationCatalog(){
 const [items,setItems]=useState<Entry[]>([]),[type,setType]=useState('UNIVERSITY'),[institution,setInstitution]=useState(''),[faculty,setFaculty]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const load=useCallback(async()=>{try{const r=await fetch(endpoint,{cache:'no-store'});const d=await r.json();if(!r.ok||d.ok!==true)throw Error();setItems(d.items);}catch{setError('تعذر تحميل المؤسسات.');}},[]);
 useEffect(()=>{void load();},[load]);
 async function save(body:unknown){setBusy(true);setError('');try{const r=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const d=await r.json();if(!r.ok||d.ok!==true)throw Error(d.code);await load();return true;}catch(e){setError(e instanceof Error&&e.message==='ALREADY_EXISTS'?'المؤسسة والتخصص مسجلان بالفعل.':'تعذر حفظ البيانات.');return false;}finally{setBusy(false);}}
 return <main dir="rtl" className="mx-auto max-w-5xl p-5 space-y-5"><header><p className="text-sm text-red-600 font-bold">CUT / DECEMBER EXAM</p><h1 className="text-3xl font-black">المؤسسات التعليمية</h1><p className="text-sm text-muted-foreground">قوائم معتمدة للاختيار في تسجيل الحملة، لا تغيّر بيانات العملاء القديمة.</p></header>
 <a href="/admin/offers/december" className="underline">المشاركون</a>
 <form className="border rounded-xl p-4 space-y-3" onSubmit={async e=>{e.preventDefault();if(await save({action:'CREATE',type,institution,faculty:type==='SCHOOL'?'':faculty})){setInstitution('');setFaculty('');}}}>
 <select value={type} onChange={e=>setType(e.target.value)} className="border rounded bg-background p-2"><option value="UNIVERSITY">جامعة</option><option value="SCHOOL">مدرسة</option><option value="INSTITUTE">معهد</option></select>
 <input required value={institution} onChange={e=>setInstitution(e.target.value)} placeholder="اسم المؤسسة" maxLength={120} className="block w-full border rounded bg-background p-3"/>
 {type!=='SCHOOL'&&<input required value={faculty} onChange={e=>setFaculty(e.target.value)} placeholder="الكلية / التخصص" maxLength={120} className="block w-full border rounded bg-background p-3"/>}
 <button disabled={busy} className="bg-[#CF252B] text-white rounded px-4 py-2">إضافة للقائمة</button></form>
 {error&&<p role="alert">{error}</p>}
 <div className="border rounded-xl divide-y">{items.map(i=><div key={i.EntryId} className="flex justify-between gap-3 p-3"><div>{i.Institution} {i.FacultyOrSpecialization&&' / '+i.FacultyOrSpecialization}<p className="text-xs">{i.EducationType}</p></div><button disabled={busy} onClick={()=>void save({action:'SET_ACTIVE',entryId:i.EntryId,active:!i.IsActive})} className="underline text-sm">{i.IsActive?'إيقاف':'تفعيل'}</button></div>)}</div></main>;
}
