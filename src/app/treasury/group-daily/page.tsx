import PageGuard from '@/components/guards/PageGuard';
import TreasuryGroupDailyView from '@/components/treasury/TreasuryGroupDailyView';

export default function TreasuryGroupDailyPage() {
  return (
    <PageGuard requiredPagePath="/treasury/group-daily">
      <div className="p-4 md:p-6">
        <TreasuryGroupDailyView />
      </div>
    </PageGuard>
  );
}
