export const ANALYTICS_PERIODS = [7,30,90] as const;
export type AnalyticsPeriod = (typeof ANALYTICS_PERIODS)[number];
export function parseAnalyticsPeriod(value:unknown):AnalyticsPeriod {
  if(value==null||value==='30')return 30;
  if(value==='7')return 7;
  if(value==='90')return 90;
  throw new Error('الفترة غير متاحة.');
}
export type CohortCounts={
  submitted:number; provisioned:number; failed:number; provisioning:number;
  branch:number; catalog:number; team:number; day:number; shift:number;
  sold:number; booked:number; firstSaleDaysTotal:number; firstSaleMeasured:number;
};
const percentage=(n:number,d:number):number|null=>d>0?Math.round(n/d*1000)/10:null;
export function buildAnalytics(counts:CohortCounts){
  const c=counts;
  const stages=[
    {id:'submitted',label:'طلبات تسجيل محفوظة',count:c.submitted},
    {id:'provisioned',label:'حسابات تم إنشاؤها',count:c.provisioned},
    {id:'branch',label:'بيانات الفرع مكتملة',count:c.branch},
    {id:'catalog',label:'الكتالوج جاهز',count:c.catalog},
    {id:'team',label:'فريق الفرع جاهز',count:c.team},
    {id:'day',label:'أول يوم تشغيل',count:c.day},
    {id:'shift',label:'أول وردية · سلسلة التجهيز',count:c.shift},
  ];
  return {
    counts:c,
    conversion:percentage(c.sold,c.provisioned),
    provisioningRate:percentage(c.provisioned,c.submitted),
    meanCalendarDaysToFirstSale:c.firstSaleMeasured>0?Math.round(c.firstSaleDaysTotal/c.firstSaleMeasured*10)/10:null,
    stages:stages.map((s,i)=>({...s,percentage:percentage(s.count,c.submitted),waiting:i===0?0:stages[i-1].count-s.count})),
  };
}
