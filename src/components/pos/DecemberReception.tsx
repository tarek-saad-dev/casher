'use client';
import {useState} from 'react';
type Participant={ParticipantId:string;DisplayName:string;PhoneMasked:string;ClientId:number|null;IsStudent:boolean;Institution:string|null;FacultyOrSpecialization:string|null;IdentityVerifiedAtUtc:string|null;StudentVerifiedAtUtc:string|null};
const endpoint='/api/admin/offers/december/participants';
export default function DecemberReception({clientId}:{clientId:number}){
 const [search,setSearch]=useState(''),[item,setItem]=useState<Participant|null>(null),[identity,setIdentity]=useState(false),[card,setCard]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 async function find(e:React.FormEvent){e.preventDefault();if(busy||!search.trim())return;setBusy(true);setItem(null);setIdentity(false);setCard(false);setMessage('');
 try{const key=/^CUT-/i.test(search.trim())?'code':'phone';const r=await fetch(endpoint+'?'+key+'='+encodeURIComponent(search.trim()),{cache:'no-store'});const d=await r.json();if(!r.ok||d.ok!==true)throw Error(d.code);if(d.items.length!==1){setMessage('لا يوجد تسجيل مطابق.');return;}setItem(d.items[0]);}catch(e){setMessage(e instanceof Error&&e.message==='RECEPTION_ACCESS_REQUIRED'?'الصلاحية غير مفعلة لهذا الموظف.':'تعذر البحث.');}finally{setBusy(false);}}
 async function approve(){if(!item||!identity||busy||(item.ClientId!==null&&item.ClientId!==clientId))return;setBusy(true);setMessage('');
 try{const r=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({participantId:item.ParticipantId,clientId,confirmedInPerson:true,studentCardChecked:card})});const d=await r.json();if(!r.ok||d.ok!==true)throw Error(d.code);setMessage('تم الاعتماد. حدّث معاينة الاستحقاق.');setItem(null);setIdentity(false);setCard(false);}catch(e){setMessage(e instanceof Error&&e.message==='IDENTITY_MISMATCH'?'رقم الموبايل لا يطابق العميل المختار.':'تعذر الاعتماد؛ راجع البيانات أو الإدارة.');}finally{setBusy(false);}}
 return <details dir="rtl" className="border rounded-lg p-3 text-sm"><summary className="cursor-pointer font-bold">اعتماد تسجيل ديسمبر (الاستقبال)</summary><div className="mt-3 space-y-3">
 <p>اختار العميل الصحيح على شاشة البيع، وابحث عن تسجيله قبل الاعتماد.</p>
 <form onSubmit={find} className="flex gap-2"><input value={search} onChange={e=>{setSearch(e.target.value);setItem(null);setIdentity(false);setCard(false);}} required placeholder="كود التسجيل أو الموبايل" aria-label="بحث التسجيل" dir="ltr" className="border rounded p-2 min-w-0 flex-1 bg-background"/><button disabled={busy} className="border rounded px-3">بحث</button></form>
 {item&&<><p className="font-bold">{item.DisplayName} · {item.PhoneMasked}</p><p>{item.Institution} {item.FacultyOrSpecialization}</p>
 {item.ClientId!==null&&item.ClientId!==clientId?<p role="alert">التسجيل مرتبط بعميل آخر. راجع الإدارة.</p>:<><label className="flex gap-2"><input type="checkbox" checked={identity} onChange={e=>setIdentity(e.target.checked)}/> تحققت حضوريًا من الهوية والرقم</label>{item.IsStudent&&<label className="flex gap-2"><input type="checkbox" checked={card} onChange={e=>setCard(e.target.checked)}/> تحققت من الكارنيه والمؤسسة والكلية</label>}<button type="button" disabled={!identity||busy} onClick={()=>void approve()} className="bg-[#CF252B] text-white rounded px-4 py-2 disabled:opacity-50">اعتماد</button></>}</>}
 {message&&<p role="status">{message}</p>}
 </div></details>;
}
