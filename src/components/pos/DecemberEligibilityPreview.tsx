'use client';
import {useEffect,useState} from 'react';
type Preview={active:boolean;registered:boolean;identityReview:boolean;alreadyRedeemed:boolean;firstVisit:boolean;studentVerified:boolean;clubLinked:boolean;confirmed:number;pending:number;partialPercent:number};
export default function DecemberEligibilityPreview({clientId}:{clientId:number}){
 const [data,setData]=useState<Preview|null>(null),[status,setStatus]=useState('idle'),[version,setVersion]=useState(0);
 useEffect(()=>{
  const controller=new AbortController();setData(null);setStatus('loading');
  async function load(){try{
   const r=await fetch('/api/pos/offers/december/preview?clientId='+clientId,{cache:'no-store',signal:controller.signal});
   const d=await r.json();if(controller.signal.aborted)return;
   if(!r.ok||d.ok!==true){setStatus('error');return;}setData(d);setStatus('ready');
  }catch{if(!controller.signal.aborted)setStatus('error');}}
  void load();return()=>controller.abort();
 },[clientId,version]);
 return <section dir="rtl" className="rounded-lg border p-3 text-sm space-y-2">
  <div className="flex items-center justify-between"><strong>امتحان ديسمبر — معاينة فقط</strong><button type="button" className="underline" onClick={()=>setVersion(v=>v+1)}>تحديث</button></div>
  {status==='loading'&&<p role="status">جاري فحص الاستحقاق…</p>}
  {status==='error'&&<p role="alert">معاينة الحملة غير متاحة.</p>}
  {data&&<>
   {!data.active?<p>الحملة غير مفعلة.</p>:data.alreadyRedeemed?<p>العميل استهلك العرض.</p>:!data.registered?<p>{data.identityReview?'الرقم يحتاج مراجعة.':'اعتماد التسجيل مطلوب.'}</p>:<>
    <p>أول زيارة: {data.firstVisit?'مؤهل مبدئيًا':'غير مؤهل'}</p><p>كارنيه الطالب: {data.studentVerified?'معتمد':'غير معتمد'}</p>
    <p>الدعوات: {data.confirmed} مؤكدة · {data.pending} معلقة</p>
    <p>ربط حساب CUT CLUB: {data.clubLinked?'موجود':'غير مثبت'} (الخصم غير محسوب)</p>
    <p className="font-bold">نسبة الشروط المفحوصة: {data.partialPercent}%</p>
   </>}
   <p className="text-muted-foreground text-xs">لا يتم تطبيق خصم أو استهلاك العرض. قواعد الخدمات والعضوية والتسوية المالية قيد التكامل.</p>
  </>}
 </section>;
}
