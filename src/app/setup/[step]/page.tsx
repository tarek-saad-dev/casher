import { notFound } from 'next/navigation';
import SelfServiceSetup from '@/components/onboarding/SelfServiceSetup';
import { isSelfServiceStepId } from '@/platform/onboarding/selfServiceJourney';

type Params = { params: Promise<{ step: string }> };

export default async function SetupStepPage({ params }: Params) {
  const { step } = await params;
  if (!isSelfServiceStepId(step) || step === 'welcome') notFound();
  return <SelfServiceSetup currentStep={step} />;
}
