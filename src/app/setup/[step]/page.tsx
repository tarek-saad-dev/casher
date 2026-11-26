import Link from 'next/link';
import { notFound } from 'next/navigation';
import SelfServiceSetup from '@/components/onboarding/SelfServiceSetup';
import { isSelfServiceStepId } from '@/platform/onboarding/selfServiceJourney';

type Params = { params: Promise<{ step: string }> };

export default async function SetupStepPage({ params }: Params) {
  const { step } = await params;
  if (!isSelfServiceStepId(step) || step === 'welcome') notFound();
  if (step === 'launch' || step === 'finish') return <div className="flex min-h-0 flex-1 flex-col overflow-hidden"><div dir="rtl" className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-2 text-xs text-[#102433]"><span className="font-bold">تدريب اختياري قبل التشغيل</span><Link href="/setup/training" className="rounded-lg border border-teal-200 bg-teal-50 px-3 py-1.5 font-bold text-teal-800">جرب النظام في مساحة التدريب</Link></div><SelfServiceSetup currentStep={step} /></div>;
  return <SelfServiceSetup currentStep={step} />;
}
