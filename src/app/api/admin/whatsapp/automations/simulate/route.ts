import { NextRequest,NextResponse } from 'next/server';
import { requireWhatsAppTemplateAdmin,isWhatsAppTemplateAdmin } from '../../templates/access';
import { parseAutomationDefinition,simulateAutomation } from '@/modules/messaging/automation/draftRules';
export async function POST(req:NextRequest){
 const auth=await requireWhatsAppTemplateAdmin();if(!isWhatsAppTemplateAdmin(auth))return auth;
 try{const body=await req.json();const def=parseAutomationDefinition(body.definition);const facts=body.facts;
 if(!facts||typeof facts!=='object'||Array.isArray(facts))return NextResponse.json({error:'بيانات المحاكاة غير صحيحة'},{status:400});
 return NextResponse.json(simulateAutomation(def,facts));
 }catch(e){return NextResponse.json({error:e instanceof Error?e.message:'محاكاة غير صالحة'},{status:400});}
}
