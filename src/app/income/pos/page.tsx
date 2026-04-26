'use client';

import { useEffect, useState, useCallback } from 'react';
import { Save, Loader2, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import PosHeader from '@/components/pos/PosHeader';
import CustomerSearch from '@/components/pos/CustomerSearch';
import CustomerHistoryPanel, { type LastSaleAutoFill } from '@/components/pos/CustomerHistoryPanel';
import QuickCustomerModal from '@/components/pos/QuickCustomerModal';
import CompleteCustomerModal from '@/components/pos/CompleteCustomerModal';
import BarberGrid from '@/components/pos/BarberGrid';
import ServiceGrid from '@/components/pos/ServiceGrid';
import CartPanel from '@/components/pos/CartPanel';
import InvoiceSummary from '@/components/pos/InvoiceSummary';
import PaymentMethodSelect from '@/components/pos/PaymentMethodSelect';
import PrintInvoiceModal from '@/components/pos/PrintInvoiceModal';
import ShiftRequiredOverlay from '@/components/session/ShiftRequiredOverlay';
import DayRolloverModal from '@/components/session/DayRolloverModal';
import CloseDayModal from '@/components/session/CloseDayModal';
import { useSaleState } from '@/hooks/useSaleState';
import { useSession } from '@/hooks/useSession';
import { useDayRollover } from '@/hooks/useDayRollover';
import type { Barber, Service, PaymentMethod, Customer } from '@/lib/types';

export default function PosPage() {
  // ───────────────── Session ─────────────────
  const { shift, hasActiveShift, loading: sessionLoading, refresh: refreshSession } = useSession();

  // Set page title
  useEffect(() => {
    document.title = 'نقطة البيع | نظام نقاط البيع';
  }, []);

  // ───────────────── Day rollover detection ─────────────────
  const rollover = useDayRollover();

  // ───────────────── Close day modal ─────────────────
  const [closeDayOpen, setCloseDayOpen] = useState(false);

  // ───────────────── Lookup data ─────────────────
  const [barbers, setBarbers] = useState<Barber[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);

  // ───────────────── Sale state ─────────────────
  const {
    state, totals,
    setCustomer, setBarber, addItem, removeItem, updateItem,
    setDiscountPercent, setDiscountValue,
    setPaymentMethod, setShift, clearItems, reset,
  } = useSaleState();

  // ───────────────── UI state ─────────────────
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [quickAddPrefill, setQuickAddPrefill] = useState<string | undefined>();
  const [completeCustomer, setCompleteCustomer] = useState<Customer | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [printInvID, setPrintInvID] = useState<number | null>(null);
  const [printOpen, setPrintOpen] = useState(false);

  // ───────────────── Sync shift from session into sale state ─────────────────
  useEffect(() => {
    setShift(shift?.ID ?? null);
  }, [shift, setShift]);

  // ───────────────── Load lookup data on mount ─────────────────
  useEffect(() => {
    fetch('/api/barbers').then(r => r.json()).then(d => { if (Array.isArray(d)) setBarbers(d); });
    fetch('/api/services').then(r => r.json()).then(d => { if (Array.isArray(d)) setServices(d); });
    fetch('/api/payment-methods').then(r => r.json()).then(d => { if (Array.isArray(d)) setPaymentMethods(d); });
  }, []);

  // ───────────────── Save sale ─────────────────
  const handleSave = useCallback(async () => {
    setSaveError('');
    if (state.items.length === 0) { setSaveError('يجب إضافة خدمة واحدة على الأقل'); return; }
    if (!state.paymentMethodId) { setSaveError('يجب اختيار طريقة الدفع'); return; }

    setSaving(true);
    try {
      const isCash = state.paymentMethodId === 1;
      const payload = {
        clientId: state.customer?.ClientID || null,
        items: state.items.map(i => ({
          proId: i.ProID,
          empId: i.EmpID,
          sPrice: i.SPrice,
          bonus: i.Bonus,
          qty: i.Qty,
          dis: i.Dis,
          disVal: i.DisVal,
          sPriceAfterDis: i.SPriceAfterDis,
          notes: i.ProName,
        })),
        subTotal: totals.subTotal,
        dis: state.discountPercent,
        disVal: totals.discountValue,
        grandTotal: totals.grandTotal,
        totalBonus: totals.totalBonus,
        totalQty: totals.totalQty,
        paymentMethodId: state.paymentMethodId,
        payCash: isCash ? totals.grandTotal : 0,
        payVisa: !isCash ? totals.grandTotal : 0,
        notes: state.customer ? `مبيعات / ${state.customer.Name}` : 'مبيعات',
      };

      const res = await fetch('/api/sales', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = await res.json();
        setSaveError(data.error || 'خطأ في حفظ الفاتورة');
        return;
      }

      const result = await res.json();
      setPrintInvID(result.invID);
      setPrintOpen(true);
      reset();
    } catch {
      setSaveError('خطأ في الاتصال بالخادم');
    } finally {
      setSaving(false);
    }
  }, [state, totals, reset]);

  // ───────────────── Keyboard shortcuts ─────────────────
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'F9') { e.preventDefault(); handleSave(); }
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [handleSave]);

  // ───────────────── New sale handler ─────────────────
  const handleNewSale = useCallback(() => {
    reset();
    setSaveError('');
  }, [reset]);

  // ───────────────── Auto-fill from last sale ─────────────────
  const handleAutoFill = useCallback((data: LastSaleAutoFill) => {
    // 1. Select barber (dominant barber from last sale)
    if (data.barberEmpID) {
      const barber = barbers.find(b => b.EmpID === data.barberEmpID);
      if (barber) setBarber(barber);
    }

    // 2. Clear existing items then add each service from last sale
    clearItems();
    data.services.forEach(svc => {
      const emp = barbers.find(b => b.EmpID === svc.empID);
      addItem({
        id: `${svc.proID}-${svc.empID}-${Date.now()}-${Math.random()}`,
        ProID: svc.proID,
        ProName: svc.proName,
        EmpID: svc.empID,
        EmpName: emp?.EmpName ?? svc.empName,
        SPrice: svc.sPrice,
        Bonus: svc.bonus,
        Qty: 1,
        Dis: 0,
        DisVal: 0,
        SPriceAfterDis: svc.sPrice,
      });
    });

    // 3. Select payment method
    if (data.paymentMethodId) {
      setPaymentMethod(data.paymentMethodId);
    }
  }, [barbers, setBarber, clearItems, addItem, setPaymentMethod]);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <PosHeader
        shiftId={shift?.ID ?? null}
        shiftLevel={hasActiveShift ? 'open' : null}
        onNewSale={handleNewSale}
      />

      <div className="flex flex-1 overflow-hidden relative">
        <ShiftRequiredOverlay />
        {/* ═══════ RIGHT PANEL: Customer + History ═══════ */}
        <aside className="w-80 border-l border-border p-4 flex flex-col gap-4 overflow-y-auto shrink-0">
          <CustomerSearch
            selected={state.customer}
            onSelect={(c: Customer | null) => setCustomer(c)}
            onQuickAdd={(prefill) => { setQuickAddPrefill(prefill); setQuickAddOpen(true); }}
            onCompleteData={(c) => setCompleteCustomer(c)}
          />
          
          {/* Customer History Panel - Auto-loads when customer selected */}
          {state.customer && (
            <>
              <Separator />
              <CustomerHistoryPanel
                customerID={state.customer.ClientID}
                onAutoFill={handleAutoFill}
              />
            </>
          )}
          
          <Separator />
          <div className="text-xs text-muted-foreground space-y-1">
            <p><kbd className="px-1.5 py-0.5 rounded bg-muted text-[10px] font-mono">F9</kbd> حفظ الفاتورة</p>
          </div>
        </aside>

        {/* ═══════ CENTER PANEL: Barbers + Services ═══════ */}
        <main className="flex-1 p-4 overflow-y-auto space-y-5">
          <BarberGrid
            barbers={barbers}
            selected={state.barber}
            onSelect={setBarber}
          />
          <Separator />
          <ServiceGrid
            services={services}
            selectedBarber={state.barber}
            onAddItem={addItem}
          />
        </main>

        {/* ═══════ LEFT PANEL: Cart + Summary + Payment + Save ═══════ */}
        <aside className="w-80 border-r border-border p-4 flex flex-col gap-4 overflow-y-auto shrink-0">
          <CartPanel items={state.items} barbers={barbers} onRemove={removeItem} onUpdateItem={updateItem} />
          <Separator />
          <InvoiceSummary
            totals={totals}
            discountPercent={state.discountPercent}
            discountValue={state.discountValue}
            onDiscountPercentChange={setDiscountPercent}
            onDiscountValueChange={setDiscountValue}
          />
          <Separator />
          <PaymentMethodSelect
            methods={paymentMethods}
            selected={state.paymentMethodId}
            onSelect={setPaymentMethod}
          />

          {saveError && (
            <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 rounded-lg p-2.5">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              {saveError}
            </div>
          )}

          <Button
            size="lg"
            className="w-full text-base font-bold py-6"
            onClick={handleSave}
            disabled={saving || state.items.length === 0}
          >
            {saving ? (
              <>
                <Loader2 className="w-5 h-5 ml-2 animate-spin" />
                جاري الحفظ...
              </>
            ) : (
              <>
                <Save className="w-5 h-5 ml-2" />
                حفظ الفاتورة (F9)
              </>
            )}
          </Button>
        </aside>
      </div>

      {/* ═══════ Modals ═══════ */}
      <QuickCustomerModal
        open={quickAddOpen}
        onClose={() => setQuickAddOpen(false)}
        onCreated={(c) => { setCustomer(c); setQuickAddOpen(false); }}
        initialQuery={quickAddPrefill}
      />
      {completeCustomer && (
        <CompleteCustomerModal
          customer={completeCustomer}
          onClose={() => setCompleteCustomer(null)}
          onUpdated={(updated) => {
            setCustomer(updated);
            setCompleteCustomer(null);
          }}
        />
      )}
      <PrintInvoiceModal
        open={printOpen}
        invID={printInvID}
        onClose={() => { setPrintOpen(false); setPrintInvID(null); }}
      />

      {/* ═══════ Day Rollover Modal ═══════ */}
      <DayRolloverModal
        open={rollover.showModal}
        openDayDate={rollover.openDayDate}
        todayDate={rollover.todayDate}
        openShifts={rollover.openShifts}
        onDismiss={rollover.dismiss}
        onResolved={() => { rollover.resolved(); refreshSession(); }}
      />

      {/* ═══════ Close Day Modal ═══════ */}
      <CloseDayModal
        open={closeDayOpen}
        onClose={() => setCloseDayOpen(false)}
        onClosed={() => { setCloseDayOpen(false); refreshSession(); }}
      />
    </div>
  );
}
