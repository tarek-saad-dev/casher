// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { INDUSTRY_PACKS } from '@/packs';
import { OnboardingWizard } from '@/components/platform/onboarding/OnboardingWizard';

const PLANS = [
  { planCode: 'starter', displayName: 'Starter', isPublic: true, isActive: true, sortOrder: 1, maxBranches: 2, maxUsers: 5, trialDays: 14, pastDueGraceDays: 7 },
];

function mockApi() {
  const fetchMock = vi.fn(async (url: string) => {
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
    if (url.endsWith('/packs')) return json({ packs: INDUSTRY_PACKS });
    if (url.endsWith('/plans')) return json({ plans: PLANS });
    if (url.endsWith('/apps')) return json({ apps: [] });
    return json({ ok: true, issues: [], apps: [] });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const stepper = () => screen.getByRole('navigation', { name: 'خطوات الإنشاء' });

describe('OnboardingWizard', () => {
  beforeEach(() => {
    mockApi();
    window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('shows salon steps (services, booking) and switches to catalog without booking for supermarket', async () => {
    render(<OnboardingWizard />);
    const salonPack = INDUSTRY_PACKS.find((p) => p.packCode === 'salon')!;
    const marketPack = INDUSTRY_PACKS.find((p) => p.packCode === 'supermarket')!;
    fireEvent.click(await screen.findByRole('button', { name: salonPack.displayName }));
    expect(stepper()).toHaveTextContent('الخدمات');
    expect(stepper()).toHaveTextContent('الحجز');

    fireEvent.click(screen.getByRole('button', { name: marketPack.displayName }));
    expect(stepper()).toHaveTextContent('الكتالوج');
    expect(stepper()).not.toHaveTextContent('الحجز');
  });

  it('blocks Next until required business fields are valid and never stores state in localStorage', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    render(<OnboardingWizard />);
    await screen.findByRole('button', { name: INDUSTRY_PACKS[0]!.displayName });
    fireEvent.click(screen.getByRole('button', { name: 'التالي' }));
    expect(await screen.findAllByText('اسم المنشأة مطلوب')).not.toHaveLength(0);

    fireEvent.change(screen.getByRole('textbox', { name: /اسم المنشأة/ }), { target: { value: 'Salon Nour' } });
    fireEvent.click(screen.getByRole('button', { name: INDUSTRY_PACKS.find((p) => p.packCode === 'salon')!.displayName }));
    fireEvent.click(screen.getByRole('button', { name: 'التالي' }));
    await waitFor(() => expect(screen.getByText('الفرع الرئيسي')).toBeInTheDocument());
    expect(setItem).not.toHaveBeenCalled();
  });
});
