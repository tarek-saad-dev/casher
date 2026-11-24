import CutClubTabs from '@/components/cut-club/CutClubTabs';

export default function CutClubHubLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <CutClubTabs />
      {children}
    </>
  );
}
