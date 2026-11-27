'use client';
import {useState} from 'react';
type Person={ParticipantId:string;DisplayName:string;ClientId:number|null;IdentityVerifiedAtUtc:string|null;Status?:string;HasSale?:number;Used?:number};
export default function DecemberGroupLookup(){
 const [code,setCode]=useState(''),[owner,setOwner]=useState<Person|null>(null),[friends,setFriends]=useState<Person[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState('');
 async function lookup(e:React.FormEvent){e.preventDefault();setBusy(true);setError('');setOwner(null);setFriends([]);
 try{const r=await fetch('/api/pos/offers/december/group?code='+encodeURIComponent(code.trim()),{cache:'no-store'});const d=await r.json();if(!r.ok||d.ok!==true)throw Error();setOwner(d.owner);setFriends(d.friends);}catch{setError('تعذر تحميل الشلة. راجع الكود وصلاحية الحملة.');}finally{setBusy(false);}}
 return <section dir="rtl" className="border rounded-xl p-4 space-y-3">
 <h2 className="font-bold">متابعة فواتير الشلة</h2><p className="text-xs text-muted-foreground">اعتمد الهويات، احفظ فواتير الصحاب أولًا، ثم أعد حساب خصم صاحب الدعوة. كل فاتورة تُحفظ منفصلة.</p>
 <form onSubmit={lookup} className="flex gap-2"><input required aria-label="كود صاحب الدعوة" value={code} onChange={e=>setCode(e.target.value)} placeholder="CUT-…" dir="ltr" maxLength={20} className="min-w-0 flex-1 border rounded bg-background p-2"/><button disabled={busy} className="border rounded px-3">{busy?'جاري البحث…':'عرض / تحديث'}</button></form>
 {error&&<p role="alert">{error}</p>}
 {owner&&<><p className="font-bold">صاحب الدعوة: {owner.DisplayName} {owner.Used?' — استهلك العرض':''}</p>
 <div className="space-y-2">{friends.map(f=><div className="border rounded p-2" key={f.ParticipantId}><p>{f.DisplayName} {f.ClientId?'· #'+f.ClientId:''}</p><p className="text-xs">{!f.IdentityVerifiedAtUtc?'اعتماد الهوية مطلوب':f.Status==='CONFIRMED'?'تم تأكيد الدعوة':f.Status==='PENDING'?(f.HasSale?'زيارة موجودة — تحتاج مراجعة':'لم تتأكد الدعوة بعد'):'غير مؤهل / ملغى'}</p></div>)}</div>
 {!friends.length&&<p>لا توجد دعوات مسجلة.</p>}<p className="text-xs">لا يوجد حفظ جماعي أو استحقاق بسبب التسجيل وحده. استخدم شاشة البيع لكل عميل.</p></>}
 </section>;
}
