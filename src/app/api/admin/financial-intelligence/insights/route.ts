import { NextRequest, NextResponse } from 'next/server';
import { requirePageAccess, isAuthResult } from '@/lib/api-auth';
import { resolveReportBranchScope, isReportBranchScope } from '@/lib/branch';
import { loadFinanceOverview, type BranchForFinance } from '@/lib/financial-intelligence/data';
import { getCairoCalendarDate } from '@/lib/businessDate';

export const runtime = 'nodejs';
const PAGE = '/admin/financial-intelligence';
const MODEL = /^[A-Za-z0-9._-]+$/;
function compactText(v: unknown, max=250): string { return typeof v==='string' ? v.slice(0,max) : ''; }
export async function POST(req: NextRequest) {
  const auth=await requirePageAccess(PAGE);
  if(!isAuthResult(auth))return auth;
  const key=process.env.GEMINI_API_KEY || process.env.GOOGLE_GENAI_API_KEY;
  if(!process.env.FINANCIAL_INSIGHTS_AI_ENABLED || process.env.FINANCIAL_INSIGHTS_AI_ENABLED!=='true' || !key)
    return NextResponse.json({error:'لم يتم تفعيل Gemini للتحليل المالي بعد',code:'AI_NOT_CONFIGURED'},{status:503});
  const sp=new URL(req.url).searchParams;
  const requested=sp.get('branchId');
  const scope=await resolveReportBranchScope({
    requestedBranchId:requested?Number(requested):null,
    requestedAllBranches:sp.get('scope')==='all',
    allowAllBranchesIfPermitted:true,
  });
  if(!isReportBranchScope(scope))return scope;
  const branches:BranchForFinance[]=scope.mode==='all'
    ?scope.branches.map(b=>({branchId:b.branchId,branchCode:b.branchCode,branchName:b.branchName}))
    :[{branchId:scope.branchId,branchCode:scope.branchCode,branchName:scope.branchName}];
  try {
    const overview=await loadFinanceOverview(auth.tenantId,branches,getCairoCalendarDate());
    // Data minimization: no customer, employee, or transaction identities are sent to Gemini.
    const payload={
      asOf:overview.asOf,
      branches:overview.branches.map(b=>({name:b.branchName,bookCash:b.bookCash,servicesRevenueMTD:b.servicesRevenueMTD,treasuryNetMTD:b.treasuryNetMTD,payrollAccruedMTD:b.payrollAccruedMTD})),
      totals:overview.totals,
      due7:overview.forecast.due7,
      due14:overview.forecast.due14,
      due30:overview.forecast.due30,
      minimumCash30:overview.forecast.minimumCash30,
      firstNegativeDay:overview.forecast.firstNegativeDay,
      quality:overview.forecast.dataQuality,
      commitments:overview.forecast.dueItems.slice(0,30).map(d=>({type:d.kind,due:d.occurrenceDate,remaining:d.remaining})),
      limitations:overview.warnings,
    };
    const prompt=[
      'أنت محلل مالي تشغيلي مساعد لمدير صالون حلاقة. حلل أرقامًا مجمعة فقط.',
      'الأرقام التي أمامك قد تكون ناقصة، خصوصًا رصيد الخزنة الدفتري والتزامات المرتبات والمصاريف غير المسجلة.',
      'تجنب الجزم بالأرباح أو طلب الاقتراض أو اقتراح تأخير المرتبات باعتباره قرارًا تلقائيًا.',
      'لا تخترع ديونًا أو مصادر إيراد أو معلومات غير موجودة. اذكر حدود جودة البيانات.',
      'أرجع JSON عربيًا فقط بمفاتيح summary نص مختصر، risks مصفوفة من نصوص، actions مصفوفة من نصوص عملية.',
      'الأولوية لـ 3 مخاطر و 3 إجراءات مع توضيح المعطيات المساندة. هذه توصيات ولا تنفذ أي دفعة.',
      JSON.stringify(payload),
    ].join('\n');
    const model=process.env.FINANCIAL_INSIGHTS_GEMINI_MODEL || 'gemini-2.5-flash';
    if(!MODEL.test(model))return NextResponse.json({error:'اسم نموذج Gemini غير صالح'},{status:500});
    const response=await fetch('https://generativelanguage.googleapis.com/v1beta/models/'+model+':generateContent',{
      method:'POST',
      headers:{'Content-Type':'application/json','x-goog-api-key':key},
      body:JSON.stringify({
        contents:[{role:'user',parts:[{text:prompt}]}],
        generationConfig:{temperature:0.2,maxOutputTokens:1300,responseMimeType:'application/json'},
      }),
      cache:'no-store',signal:AbortSignal.timeout(25000),
    });
    if(!response.ok) {
      console.error('[finance-insights] Gemini error status',response.status);
      return NextResponse.json({error:'خدمة Gemini غير متاحة حاليًا، المؤشرات الرقمية ما زالت متاحة.'},{status:502});
    }
    const raw=await response.json() as {candidates?:Array<{content?:{parts?:Array<{text?:string}>}}>};
    const value=raw.candidates?.[0]?.content?.parts?.map(x=>x.text||'').join('') || '';
    const json=JSON.parse(value) as Record<string,unknown>;
    const list=(v:unknown)=>Array.isArray(v)?v.slice(0,3).map(x=>compactText(x,300)).filter(Boolean):[];
    return NextResponse.json({ok:true,analysis:{
      summary:compactText(json.summary,700),
      risks:list(json.risks),actions:list(json.actions),
    },asOf:overview.asOf,disclaimer:'توصيات مولّدة بالذكاء الاصطناعي وليست حسابات دفترية أو تعليمات دفع.'});
  }catch(err){
    console.error('[finance-insights] error',err instanceof Error?err.message:String(err));
    return NextResponse.json({error:'تعذر إكمال التحليل بالذكاء الاصطناعي'},{status:502});
  }
}
