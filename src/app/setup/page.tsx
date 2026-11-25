import SelfServiceSetup from '@/components/onboarding/SelfServiceSetup';

export const metadata = { title: 'أهلاً بيك في DRVO | تجهيز بيزنسك' };

export default function WelcomeSetupPage() {
  return <SelfServiceSetup currentStep="welcome" />;
}
