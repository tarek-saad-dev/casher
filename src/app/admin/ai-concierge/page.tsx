import { SalonConciergeAdmin } from '@/components/admin/salon-concierge/SalonConciergeAdmin';
import { TeachCutAiPanel } from '@/components/admin/ai-control-plane/TeachCutAiPanel';
import { isAiControlPlanePhase1Enabled } from '@/modules/ai-control-plane/featureFlag';

export default function AdminAiConciergePage() {
  const teachEnabled = isAiControlPlanePhase1Enabled();
  return (
    <div className="space-y-6 p-4" dir="rtl">
      {teachEnabled && <TeachCutAiPanel />}
      <SalonConciergeAdmin />
    </div>
  );
}
