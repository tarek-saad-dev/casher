'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { Save, Loader2, AlertTriangle, CheckCircle, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import PosHeader from '@/components/pos/PosHeader';
import RecentSalesSidebar from '@/components/pos/RecentSalesSidebar';
import CustomerSearch from '@/components/pos/CustomerSearch';
import CustomerHistoryPanel, { type LastSaleAutoFill } from '@/components/pos/CustomerHistoryPanel';
import QuickCustomerModal from '@/components/pos/QuickCustomerModal';
import CompleteCustomerModal from '@/components/pos/CompleteCustomerModal';
import BarberCarousel from '@/components/pos/luxury/BarberCarousel';
import ServiceCatalog from '@/components/pos/luxury/ServiceCatalog';
import CartPanel from '@/components/pos/CartPanel';
import InvoiceSummary from '@/components/pos/InvoiceSummary';
import PaymentMethodSelect from '@/components/pos/PaymentMethodSelect';
import SplitPaymentInput from '@/components/pos/SplitPaymentInput';
import PrintInvoiceModal from '@/components/pos/PrintInvoiceModal';
import ShiftRequiredOverlay from '@/components/session/ShiftRequiredOverlay';
import DayRolloverModal from '@/components/session/DayRolloverModal';
import CloseDayModal from '@/components/session/CloseDayModal';
import { useSaleState } from '@/hooks/useSaleState';
import { useSession } from '@/hooks/useSession';
import { useDayRollover } from '@/hooks/useDayRollover';
import { printReceiptWithFallback, type PrintReceiptData } from '@/lib/printService';
import type { Barber, Service, PaymentMethod, Customer } from '@/lib/types';

// ─── Toast Types ─────────────────────────────────────────────────────────
interface Toast { id: number; type: 'success' | 'error' | 'info'; message: string }

// ─── Toast Component ─────────────────────────────────────────────────────────
function ToastList({ toasts, dismiss }: { toasts: Toast[]; dismiss: (id: number) => void }) {
  return (
    <div className="fixed bottom-4 left-4 z-50 flex flex-col gap-2 w-80" dir="rtl">
      {toasts.map(t => (
        <div
          key={t.id}
          className={`flex items-center gap-3 px-4 py-3 rounded-xl border shadow-xl text-sm font-medium transition-all
            ${t.type === 'success' ? 'bg-emerald-950/90 border-emerald-500/40 text-emerald-300' : ''}
            ${t.type === 'error'   ? 'bg-rose-950/90 border-rose-500/40 text-rose-300' : ''}
            ${t.type === 'info'    ? 'bg-zinc-900/90 border-zinc-700/40 text-zinc-300' : ''}
          `}
        >
          {t.type === 'success' && <CheckCircle className="w-4 h-4 shrink-0" />}
          {t.type === 'error'   && <AlertTriangle className="w-4 h-4 shrink-0" />}
          <span className="flex-1">{t.message}</span>
          <button onClick={() => dismiss(t.id)} className="opacity-60 hover:opacity-100"><X className="w-3.5 h-3.5" /></button>
        </div>
      ))}
    </div>
  );
}

export default function PosPage() {
  // ───────────────── Toast System ─────────────────
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastIdRef = useRef(0);

  const addToast = useCallback((type: Toast['type'], message: string) => {
    const id = ++toastIdRef.current;
    setToasts(p => [...p, { id, type, message }]);
    setTimeout(() => setToasts(p => p.filter(t => t.id !== id)), 3000);
  }, []);

  const dismissToast = useCallback((id: number) => setToasts(p => p.filter(t => t.id !== id)), []);

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
    setPaymentMethod,
    setPaymentAllocations,
    setNotes, setShift, clearItems, reset,
  } = useSaleState();

  // ───────────────── UI state ─────────────────
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [quickAddPrefill, setQuickAddPrefill] = useState<string | undefined>();
  const [completeCustomer, setCompleteCustomer] = useState<Customer | null>(null);
  const [completeCustomerMode, setCompleteCustomerMode] = useState<'complete' | 'edit'>('complete');
  const [saving, setSaving] = useState(false);
  const saveLockRef = useRef(false); // synchronous guard — prevents concurrent saves
  const [saveError, setSaveError] = useState('');
  const [printInvID, setPrintInvID] = useState<number | null>(null);
  const [printOpen, setPrintOpen] = useState(false);
  const [splitPaymentActive, setSplitPaymentActive] = useState(false);
  const [editingSaleId, setEditingSaleId] = useState<number | null>(null);

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

  // ───────────────── Auto-select default payment method when methods load ─────────────────
  useEffect(() => {
    if (paymentMethods.length === 0) return;
    // Only initialize if no method is selected yet (don't override edit-loaded state)
    if (state.paymentMethodId !== null) return;
    const cashMethod = paymentMethods.find(m =>
      m.Name?.toLowerCase().includes('كاش') ||
      m.Name?.toLowerCase() === 'cash'
    ) || paymentMethods[0];
    if (!cashMethod) return;
    console.log('[payment] loaded paymentMethods:', paymentMethods.map(m => `${m.ID}:${m.Name}`));
    setPaymentMethod(cashMethod.ID);
    const allocs = paymentMethods.map(m => ({
      paymentMethodId: m.ID,
      amount: m.ID === cashMethod.ID ? totals.grandTotal : 0,
    }));
    setPaymentAllocations(allocs);
    console.log('[payment] selectedPaymentMethodId after init:', cashMethod.ID);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paymentMethods]);

  // ───────────────── Keep single-payment allocation in sync with grand total ─────────────────
  useEffect(() => {
    if (splitPaymentActive) return;
    if (state.paymentMethodId === null) return;
    if (paymentMethods.length === 0) return;
    // Only update if currently a single full-amount allocation (not a manual split)
    const activeCount = state.paymentAllocations.filter(pa => pa.amount > 0).length;
    if (activeCount > 1) return;
    const allocs = paymentMethods.map(m => ({
      paymentMethodId: m.ID,
      amount: m.ID === state.paymentMethodId ? totals.grandTotal : 0,
    }));
    setPaymentAllocations(allocs);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [totals.grandTotal, state.paymentMethodId]);

  // ───────────────── Save sale ─────────────────
  const handleSave = useCallback(async (forcePrint = false, source = 'unknown') => {
    if (saveLockRef.current) {
      console.warn('[POS SAVE] Duplicate save blocked', { source });
      return;
    }

    saveLockRef.current = true;
    setSaving(true);
    setSaveError('');

    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    console.log('[POS SAVE] START', { requestId, source });

    if (state.items.length === 0) { setSaveError('يجب إضافة خدمة واحدة على الأقل'); saveLockRef.current = false; setSaving(false); return; }
    if (state.paymentMethodId === null) { setSaveError('اختر طريقة الدفع'); saveLockRef.current = false; setSaving(false); return; }
    
    // Validate split payment totals
    const totalAllocated = state.paymentAllocations.reduce((sum, pa) => sum + pa.amount, 0);
    const remaining = totals.grandTotal - totalAllocated;
    if (Math.abs(remaining) > 0.01) {
      setSaveError(`إجمالي المدفوع (${totalAllocated.toFixed(2)}) لا يساوي إجمالي الفاتورة (${totals.grandTotal.toFixed(2)})`);
      saveLockRef.current = false; setSaving(false);
      return;
    }

    // Determine main payment method (largest amount)
    const sortedAllocations = [...state.paymentAllocations].sort((a, b) => b.amount - a.amount);
    const mainPayment = sortedAllocations[0];
    if (!mainPayment || mainPayment.amount <= 0) {
      setSaveError('يجب إدخال مبلغ لطريقة دفع واحدة على الأقل');
      saveLockRef.current = false; setSaving(false);
      return;
    }

    try {
      // Build payment allocations for API
      const activeAllocations = state.paymentAllocations.filter(pa => pa.amount > 0);
      const payCash = state.paymentAllocations.find(pa => {
        const method = paymentMethods.find(m => m.ID === pa.paymentMethodId);
        return method?.Name?.toLowerCase().includes('كاش') && pa.amount > 0;
      })?.amount || 0;
      const payVisa = state.paymentAllocations.find(pa => {
        const method = paymentMethods.find(m => m.ID === pa.paymentMethodId);
        return (method?.Name?.toLowerCase().includes('فيزا') || method?.Name?.toLowerCase().includes('كارت')) && pa.amount > 0;
      })?.amount || 0;

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
        paymentMethodId: mainPayment.paymentMethodId,
        paymentAllocations: activeAllocations,
        payCash,
        payVisa,
        notes: state.customer ? `مبيعات / ${state.customer.Name}` : 'مبيعات',
      };

      // Use PUT for editing, POST for new sale
      const isEditing = editingSaleId !== null;
      const url = isEditing ? `/api/sales/${editingSaleId}` : '/api/sales';
      const method = isEditing ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = await res.json();
        setSaveError(data.error || 'خطأ في حفظ الفاتورة');
        return;
      }

      const result = await res.json();
      const savedInvID: number = result.invID;
      setPrintInvID(savedInvID);

      // Reset everything (customer, barber, items, discount, payment, edit mode)
      reset();
      setEditingSaleId(null);
      setSplitPaymentActive(false);
      setSaveError('');

      // Show success toast
      addToast('success', isEditing ? 'تم تحديث الفاتورة بنجاح' : 'تم حفظ الفاتورة بنجاح');

      if (forcePrint || isEditing) {
        // Double-click (forcePrint) or edit always opens the browser modal directly
        setPrintOpen(true);
      } else {
        // New sale: try local print service first, fall back to browser modal
        const printData: PrintReceiptData = {
          invID: savedInvID,
          invDate: result.invDate || new Date().toISOString(),
          invTime: result.invTime || new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' }),
          customerName: state.customer?.Name,
          customerPhone: state.customer?.Mobile ?? undefined,
          SubTotal: totals.subTotal,
          Dis: state.discountPercent || 0,
          DisVal: totals.discountValue,
          GrandTotal: totals.grandTotal,
          PayCash: payCash,
          PayVisa: payVisa,
          PaymentMethodID: mainPayment.paymentMethodId,
          items: state.items.map(i => ({
            ProName: i.ProName,
            EmpName: i.EmpName,
            SPrice: i.SPriceAfterDis,
            Qty: i.Qty,
            SPriceAfterDis: i.SPriceAfterDis,
          })),
        };
        await printReceiptWithFallback(
          printData,
          () => setPrintOpen(true),
          addToast,
        );
      }
      console.log('[POS SAVE] SUCCESS', { requestId });
    } catch {
      setSaveError('خطأ في الاتصال بالخادم');
      console.error('[POS SAVE] ERROR', { requestId });
    } finally {
      saveLockRef.current = false;
      setSaving(false);
      console.log('[POS SAVE] END', { requestId });
    }
  }, [state, totals, reset, addToast, paymentMethods, editingSaleId, saveLockRef]);

  // ───────────────── Keyboard shortcuts ─────────────────
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'F9') {
        e.preventDefault();
        if (saveLockRef.current) {
          console.warn('[POS SAVE] F9 ignored — save already running');
          return;
        }
        handleSave(false, 'F9');
      }
      if (e.key === '+' || (e.key === '=' && e.shiftKey)) {
        e.preventDefault();
        if (saveLockRef.current) {
          console.warn('[POS SAVE] keyboard-+ ignored — save already running');
          return;
        }
        handleSave(false, 'keyboard-plus');
      }
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [handleSave, saveLockRef]);

  // ───────────────── New sale handler ─────────────────
  const handleNewSale = useCallback(() => {
    // Reset everything including barber selection and edit mode
    reset();
    setEditingSaleId(null);
    setSplitPaymentActive(false);
    setSaveError('');
  }, [reset, setSplitPaymentActive]);

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

  // ───────────────── Edit sale functionality ─────────────────
  const handleEditSale = useCallback(async (saleId: number) => {
    try {
      const response = await fetch(`/api/sales/${saleId}`);
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || 'فشل تحميل بيانات الفاتورة');
      }

      // 1. Set customer if exists
      if (data.ClientID && data.customerName) {
        const customer: Customer = {
          ClientID: data.ClientID,
          Name: data.customerName,
          Mobile: data.customerPhone || '',
          BirthDate: null,
          Address: '',
          RegisterDate: new Date().toISOString(),
          Notes: ''
        };
        setCustomer(customer);
      }

      // 2. Set discount if exists
      if (data.Dis || data.DisVal) {
        if (data.Dis && data.Dis > 0) {
          setDiscountPercent(data.Dis);
        }
        if (data.DisVal && data.DisVal > 0) {
          setDiscountValue(data.DisVal);
        }
      }

      // 3. Clear existing items and add services from the sale
      clearItems();
      if (data.items && Array.isArray(data.items)) {
        data.items.forEach((item: any) => {
          const emp = barbers.find(b => b.EmpID === item.EmpID);
          addItem({
            id: `${item.ProID}-${item.EmpID}-${Date.now()}-${Math.random()}`,
            ProID: item.ProID,
            ProName: item.ProName || 'خدمة',
            EmpID: item.EmpID,
            EmpName: emp?.EmpName || item.EmpName || 'موظف',
            SPrice: item.SPrice || 0,
            Bonus: item.Bonus || 0,
            Qty: item.Qty || 1,
            Dis: item.Dis || 0,
            DisVal: item.DisVal || 0,
            SPriceAfterDis: item.SPriceAfterDis || item.SPrice || 0,
          });
        });
      }

      // 4. Set payment method and allocations
      if (data.PaymentMethodID) {
        setPaymentMethod(data.PaymentMethodID);
        
        // Set payment allocations based on actual payment data
        const newAllocations = paymentMethods.map(m => {
          let amount = 0;
          if (m.ID === data.PaymentMethodID) {
            // Use actual payment amounts if available
            if (data.PayCash && data.PayCash > 0 && m.Name?.toLowerCase().includes('كاش')) {
              amount = data.PayCash;
            } else if (data.PayVisa && data.PayVisa > 0 && (m.Name?.toLowerCase().includes('فيزا') || m.Name?.toLowerCase().includes('كارت'))) {
              amount = data.PayVisa;
            } else {
              amount = data.GrandTotal;
            }
          }
          return {
            paymentMethodId: m.ID,
            amount: amount
          };
        });
        setPaymentAllocations(newAllocations);
      }

      // 5. Set editing mode
      setEditingSaleId(saleId);

      // 6. Show success message
      addToast('info', 'تم تحميل بيانات الفاتورة للتعديل');

    } catch (e: any) {
      addToast('error', e.message || 'فشل تحميل بيانات الفاتورة');
    }
  }, [barbers, setCustomer, clearItems, addItem, setPaymentMethod, setPaymentAllocations, paymentMethods, addToast, setDiscountPercent, setDiscountValue]);

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
        <aside className="w-80 border-l border-border p-4 flex flex-col gap-4 overflow-y-auto shrink-0 scrollbar-luxury-v">
          <CustomerSearch
            selected={state.customer}
            onSelect={(c: Customer | null) => setCustomer(c)}
            onQuickAdd={(prefill) => { setQuickAddPrefill(prefill); setQuickAddOpen(true); }}
            onCompleteData={(c) => { setCompleteCustomerMode('complete'); setCompleteCustomer(c); }}
            onEditCustomer={(c) => { setCompleteCustomerMode('edit'); setCompleteCustomer(c); }}
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
            <p><kbd className="px-1.5 py-0.5 rounded bg-muted text-[10px] font-mono">+</kbd> حفظ (ضغطة) / حفظ وطباعة (ضغطتين)</p>
          </div>
        </aside>

        {/* ═══════ CENTER PANEL: Barbers + Services ═══════ */}
        <main className="flex-1 p-4 overflow-y-auto space-y-5 scrollbar-luxury-v">
          <BarberCarousel
            barbers={barbers}
            selected={state.barber}
            onSelect={setBarber}
          />
          <Separator className="bg-[#2A2A30]" />
          <ServiceCatalog
            services={services}
            selectedBarber={state.barber}
            onAddItem={addItem}
          />
        </main>

        {/* ═══════ LEFT PANEL: Cart + Summary + Payment + Save + Recent Sales ═══════ */}
        <aside className="w-80 border-r border-border p-4 flex flex-col gap-4 overflow-y-auto shrink-0 scrollbar-luxury-v">
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
          {paymentMethods.length > 0 && (
            <>
              {/* Default: Single Payment Method Selection */}
              {!state.paymentAllocations.some(pa => pa.amount > 0 && pa.amount !== totals.grandTotal) ? (
                <PaymentMethodSelect
                  methods={paymentMethods}
                  selected={state.paymentMethodId}
                  onSelect={(id) => {
                    setPaymentMethod(id);
                    // Set full amount to selected method
                    const newAllocations = paymentMethods.map(m => ({
                      paymentMethodId: m.ID,
                      amount: m.ID === id ? totals.grandTotal : 0,
                    }));
                    setPaymentAllocations(newAllocations);
                  }}
                />
              ) : null}

              {/* Toggle Split Payment */}
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">دفع مختلط</span>
                <button
                  onClick={() => {
                    if (splitPaymentActive) {
                      // Switch back to single payment (all to current method)
                      const currentMethod = state.paymentMethodId || paymentMethods[0]?.ID;
                      const newAllocations = paymentMethods.map(m => ({
                        paymentMethodId: m.ID,
                        amount: m.ID === currentMethod ? totals.grandTotal : 0,
                      }));
                      setPaymentAllocations(newAllocations);
                      setSplitPaymentActive(false);
                    } else {
                      // Initialize split payment with current method having full amount
                      const currentMethod = state.paymentMethodId || paymentMethods[0]?.ID;
                      const newAllocations = paymentMethods.map(m => ({
                        paymentMethodId: m.ID,
                        amount: m.ID === currentMethod ? totals.grandTotal : 0,
                      }));
                      setPaymentAllocations(newAllocations);
                      setSplitPaymentActive(true);
                    }
                  }}
                  className={`text-xs px-2 py-1 rounded transition-colors ${
                    splitPaymentActive
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-muted-foreground hover:bg-muted/80'
                  }`}
                >
                  {splitPaymentActive ? 'إلغاء' : 'تفعيل'}
                </button>
              </div>

              {/* Split Payment Input (shown only when activated) */}
              {splitPaymentActive && (
                <SplitPaymentInput
                  methods={paymentMethods}
                  grandTotal={totals.grandTotal}
                  allocations={state.paymentAllocations}
                  onChange={setPaymentAllocations}
                />
              )}
            </>
          )}

          {saveError && (
            <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 rounded-lg p-2.5">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              {saveError}
            </div>
          )}

          <div className="flex gap-2">
            <Button
              size="lg"
              className="flex-1 text-base font-bold py-6"
              type="button"
              onClick={() => handleSave(false, 'save-button')}
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
                  حفظ (F9)
                </>
              )}
            </Button>
            <Button
              size="lg"
              className="px-6 py-6 text-base font-bold"
              type="button"
              onClick={() => handleSave(false, 'plus-button')}
              disabled={saving || state.items.length === 0}
              variant="outline"
            >
              <span className="text-xl font-bold">+</span>
            </Button>
          </div>

          <Separator />
          
          {/* Recent Sales Sidebar */}
          <RecentSalesSidebar
            onEditSale={handleEditSale}
            onDeleteSale={(saleId) => {
              // Delete functionality is handled in the component
              console.log('Delete sale:', saleId);
            }}
            onRefresh={() => {
              // Refresh any other components if needed
              console.log('Refresh sales');
            }}
          />
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
          mode={completeCustomerMode}
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
        onSkip={rollover.skip}
      />

      {/* ═══════ Close Day Modal ═══════ */}
      <CloseDayModal
        open={closeDayOpen}
        onClose={() => setCloseDayOpen(false)}
        onClosed={() => { setCloseDayOpen(false); refreshSession(); }}
      />

      {/* ═══════ Toast Notifications ═══════ */}
      <ToastList toasts={toasts} dismiss={dismissToast} />
    </div>
  );
}
