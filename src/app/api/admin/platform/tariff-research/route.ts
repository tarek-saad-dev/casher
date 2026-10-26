import {NextResponse} from 'next/server';
import {isAuthResult,requirePlatformOperator} from '@/lib/api-auth';
import {
  createTariffResearchProposal,listTariffResearchProposals,reviewTariffResearchProposal,
} from '@/platform/commercial/tariffResearchService';
import {
  RESEARCH_SALON_APPS,RESEARCH_TARIFF_MODELS,RESEARCH_REVIEW_ACTIONS,ResearchTariffError,
  type TariffResearchInput,type ResearchReviewAction,
} from '@/platform/commercial/tariffResearchPolicy';

export const runtime='nodejs';export const dynamic='force-dynamic';
const HEADERS={'Cache-Control':'no-store'};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function failure(error:unknown){
  if(error instanceof ResearchTariffError)
    return NextResponse.json({error:error.message,code:error.code,canCheckout:false,approvedForSale:false},
      {status:error.status,headers:HEADERS});
  console.error('[platform-tariff-research]',error instanceof Error?error.message:error);
  return NextResponse.json({error:'تعذر قراءة أو تسجيل بحث الأسعار',code:'RESEARCH_UNAVAILABLE'},
    {status:503,headers:HEADERS});
}
export async function GET(){
  const auth=await requirePlatformOperator();
  if(!isAuthResult(auth))return auth;
  try{return NextResponse.json({
    scope:'internal_research',approvedForSale:false,canCheckout:false,canActivate:false,
    allowedApps:RESEARCH_SALON_APPS,
    proposals:await listTariffResearchProposals(),
  },{headers:HEADERS});}
  catch(error){return failure(error);}
}
export async function POST(req:Request){
  const auth=await requirePlatformOperator();
  if(!isAuthResult(auth))return auth;
  let input:TariffResearchInput;
  try{
    const raw:unknown=await req.json();
    if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('invalid');
    const x=raw as Record<string,unknown>;
    const allowed=['industry','pricingModel','appPricesMinor','baseMonthlyMinor',
      'extraBranchMonthlyMinor','includedBranches','annualMonthsCharged'];
    if(Object.keys(x).length!==allowed.length||
       Object.keys(x).some(k=>!allowed.includes(k))||
       x.industry!=='salon'||!RESEARCH_TARIFF_MODELS.includes(x.pricingModel as TariffResearchInput['pricingModel'])||
       !x.appPricesMinor||typeof x.appPricesMinor!=='object'||Array.isArray(x.appPricesMinor)||
       !Number.isSafeInteger(x.baseMonthlyMinor)||!Number.isSafeInteger(x.extraBranchMonthlyMinor)||
       !Number.isSafeInteger(x.includedBranches)||!Number.isSafeInteger(x.annualMonthsCharged))
      throw Error('invalid');
    input=x as TariffResearchInput;
  }catch{
    return NextResponse.json({error:'مدخلات التسعير البحثي غير صحيحة',code:'INVALID_REQUEST'},
      {status:400,headers:HEADERS});
  }
  try{return NextResponse.json({
    proposal:await createTariffResearchProposal({actorUserId:auth.userId,candidate:input}),
    approvedForSale:false,canCheckout:false,
  },{status:201,headers:HEADERS});}
  catch(error){return failure(error);}
}
export async function PATCH(req:Request){
  const auth=await requirePlatformOperator();
  if(!isAuthResult(auth))return auth;
  let input:{proposalId:string;action:ResearchReviewAction;note:string};
  try{
    const raw:unknown=await req.json();
    if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('invalid');
    const x=raw as Record<string,unknown>;
    if(Object.keys(x).length!==3||Object.keys(x).some(k=>!['proposalId','action','note'].includes(k))||
       typeof x.proposalId!=='string'||!UUID.test(x.proposalId)||
       !RESEARCH_REVIEW_ACTIONS.includes(x.action as ResearchReviewAction)||
       typeof x.note!=='string'||!x.note.trim()||x.note.length>500)
      throw Error('invalid');
    input={proposalId:x.proposalId,action:x.action as ResearchReviewAction,note:x.note.trim()};
  }catch{
    return NextResponse.json({error:'مراجعة غير صحيحة',code:'INVALID_REQUEST'},
      {status:400,headers:HEADERS});
  }
  try{return NextResponse.json({
    proposal:await reviewTariffResearchProposal({...input,actorUserId:auth.userId}),
    approvedForSale:false,canCheckout:false,
  },{headers:HEADERS});}
  catch(error){return failure(error);}
}
