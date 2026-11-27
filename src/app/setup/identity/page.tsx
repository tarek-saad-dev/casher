import Link from 'next/link';
import OnboardingIdentityForm from '@/components/onboarding/OnboardingIdentityForm';

export const metadata = { title: 'هوية المنشأة | DRVO ERP' };
export default function IdentityPage() {
  return <main dir="rtl" className="min-h-0 flex-1 overflow-y-auto bg-background text-foreground">
    <div className="mx-auto max-w-6xl px-4 pb-10 pt-5 sm:px-8">
      <header className="mb-5 flex items-center justify-between gap-2">
        <Link href="/setup" dir="ltr" className="text-xl font-black">DRVO<span className="text-primary">ERP</span></Link>
        <Link href="/setup/branch" className="rounded-xl border border-input bg-card px-4 py-2 text-xs font-bold">العودة لتجهيز الفرع</Link>
      </header>
      <OnboardingIdentityForm />
    </div>
  </main>;
}
