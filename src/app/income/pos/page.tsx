'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { AlertTriangle, CheckCircle, X } from 'lucide-react';
import { Separator } from '@/components/ui/separator';
import RecentInvoicesDrawer from '@/components/pos/RecentInvoicesDrawer';
import { invalidateRecentInvoicesCache } from '@/lib/recentInvoicesCache';
import QuickActionsBar, { type QuickActionId } from '@/components/pos/QuickActionsBar';
import PaymentTransferModal from '@/components/pos/PaymentTransferModal';
import QuickExpenseModal from '@/components/pos/QuickExpenseModal';
import QuickIncomeModal from '@/components/pos/QuickIncomeModal';
import CustomerSearch from '@/components/pos/CustomerSearch';
import CustomerHistoryPanel, { type LastSaleAutoFill } from '@/components/pos/CustomerHistoryPanel';
import QuickCustomerModal from '@/components/pos/QuickCustomerModal';
import CompleteCustomerModal from '@/components/pos/CompleteCustomerModal';
import BarberCarousel from '@/components/pos/luxury/BarberCarousel';
import ServiceCatalog from '@/components/pos/luxury/ServiceCatalog';
import PosInvoicePanel, { PosInvoiceSaveActions } from '@/components/pos/PosInvoicePanel';
import MobilePosHeader from '@/components/pos/mobile/MobilePosHeader';
import MobileInvoiceBar from '@/components/pos/mobile/MobileInvoiceBar';
import MobileInvoiceSheet from '@/components/pos/mobile/MobileInvoiceSheet';
import PrintInvoiceModal from '@/components/pos/PrintInvoiceModal';
import ClientVouchersModal from '@/components/pos/ClientVouchersModal';
import ShiftRequiredOverlay from '@/components/session/ShiftRequiredOverlay';
import DayRolloverModal from '@/components/session/DayRolloverModal';
import CloseDayModal from '@/components/session/CloseDayModal';
import { useSaleState } from '@/hooks/useSaleState';
import { useSession } from '@/hooks/useSession';
import { useDayRollover } from '@/hooks/useDayRollover';
import { printReceiptWithFallback, type PrintReceiptData } from '@/lib/printService';
import { isCustomerIncomplete } from '@/lib/customerSource';
import type { Barber, Service, PaymentMethod, Customer } from '@/lib/types';

// ─── Toast Types ─────────────────────────────────────────────────────────
interface Toast { id: number; type: 'success' | 'error' | 'info'; message: string }

// ─── Toast Component ─────────────────────────────────────────────────────────
function ToastList({ toasts, dismiss }: { toasts: Toast[]; dismiss: (id: number) => void }) {
  return (
    <div className="fixed bottom-4 left-4 z-50 flex w-80 max-md:bottom-[calc(4.5rem+env(safe-area-inset-bottom))] flex-col gap-2" dir="rtl">
      {toasts.map(t => (
        <div
          key={t.id}
          className={`flex items-center gap-3 px-4 py-3 rounded-xl border shadow-xl text-sm font-medium transition-all
            ${t.type === 'success' ? 'bg-success/10 border-success/40 text-success' : ''}
            ${t.type === 'error' ? 'bg-destructive/10 border-destructive/40 text-destructive' : ''}
            ${t.type === 'info' ? 'bg-muted/90 border-border/40 text-muted-foreground' : ''}
          `}
        >
          {t.type === 'success' && <CheckCircle className="w-4 h-4 shrink-0" />}
          {t.type === 'error' && <AlertTriangle className="w-4 h-4 shrink-0" />}
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
    setCustomer: setCustomerBase, setBarber, addItem, removeItem, updateItem,
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
  const [lastUpdatedCustomer, setLastUpdatedCustomer] = useState<Customer | null>(null);
  const savingRef = useRef(false); // tracks whether the modal save succeeded
  const autoOpenedClientIdRef = useRef<number | null>(null);
  const dismissedAutoClientIdRef = useRef<number | null>(null);
  const previousCustomerIdRef = useRef<number | null>(null);
  const [saving, setSaving] = useState(false);
  const saveLockRef = useRef(false); // synchronous guard — prevents concurrent saves
  const [saveError, setSaveError] = useState('');
  const [printInvID, setPrintInvID] = useState<number | null>(null);
  const [printOpen, setPrintOpen] = useState(false);
  const [splitPaymentActive, setSplitPaymentActive] = useState(false);
  const [editingSaleId, setEditingSaleId] = useState<number | null>(null);
  const [vouchersOpen, setVouchersOpen] = useState(false);
  const [invoiceSheetOpen, setInvoiceSheetOpen] = useState(false);
  const [isPaymentTransferOpen, setIsPaymentTransferOpen] = useState(false);
  const [isQuickExpenseOpen, setIsQuickExpenseOpen] = useState(false);
  const [isQuickIncomeOpen, setIsQuickIncomeOpen] = useState(false);
  const [isRecentInvoicesOpen, setIsRecentInvoicesOpen] = useState(false);

  // ───────────────── Wrap setCustomer ─────────────────
  const setCustomer = useCallback((c: Customer | null) => {
    setCustomerBase(c);
    if (!c) setVouchersOpen(false);
  }, [setCustomerBase]);

  // ───────────────── Auto-open completion modal for incomplete customers ─────────────────
  const handleCloseCompleteModal = useCallback(() => {
    if (completeCustomer && !savingRef.current) {
      dismissedAutoClientIdRef.current = completeCustomer.ClientID;
    }
    setCompleteCustomer(null);
  }, [completeCustomer]);

  const handleCompleteCustomerUpdated = useCallback((updated: Customer) => {
    savingRef.current = true;
    setCustomer(updated);
    setLastUpdatedCustomer(updated);
    setCompleteCustomer(null);
    // After a successful save the customer is no longer incomplete, so reset the guard
    requestAnimationFrame(() => { savingRef.current = false; });
  }, [setCustomer]);

  useEffect(() => {
    const c = state.customer;
    const currentId = c?.ClientID ?? null;

    if (currentId !== previousCustomerIdRef.current) {
      // Customer selection changed (or cleared) — reset per-customer tracking
      autoOpenedClientIdRef.current = null;
      dismissedAutoClientIdRef.current = null;
      previousCustomerIdRef.current = currentId;
    }

    if (!c || !currentId || editingSaleId !== null) return;

    const incomplete = isCustomerIncomplete(c);
    if (!incomplete) return;

    if (autoOpenedClientIdRef.current === currentId) return;
    if (dismissedAutoClientIdRef.current === currentId) return;

    setCompleteCustomerMode('complete');
    setCompleteCustomer(c);
    autoOpenedClientIdRef.current = currentId;
  }, [state.customer, editingSaleId]);

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
      invalidateRecentInvoicesCache();

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
          Notes: '',
          CameFrom: null,
          CameFromDetails: null,
          ReferralCode: null,
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

  const handlePaymentMethodSelect = useCallback((id: number) => {
    setPaymentMethod(id);
    const newAllocations = paymentMethods.map((m) => ({
      paymentMethodId: m.ID,
      amount: m.ID === id ? totals.grandTotal : 0,
    }));
    setPaymentAllocations(newAllocations);
  }, [paymentMethods, totals.grandTotal, setPaymentMethod, setPaymentAllocations]);

  const handleQuickAction = useCallback((actionId: QuickActionId) => {
    switch (actionId) {
      case 'payment-transfer':
        setIsPaymentTransferOpen(true);
        break;
      case 'quick-expense':
        setIsQuickExpenseOpen(true);
        break;
      case 'quick-income':
        setIsQuickIncomeOpen(true);
        break;
      case 'recent-invoices':
        setIsRecentInvoicesOpen(true);
        break;
    }
  }, []);

  const invoicePanelProps = {
    state,
    totals,
    barbers,
    paymentMethods,
    splitPaymentActive,
    setSplitPaymentActive,
    saveError,
    saving,
    onRemove: removeItem,
    onUpdateItem: updateItem,
    onDiscountPercentChange: setDiscountPercent,
    onDiscountValueChange: setDiscountValue,
    onPaymentMethodSelect: handlePaymentMethodSelect,
    onPaymentAllocationsChange: setPaymentAllocations,
    onSave: handleSave,
  };

  const invoiceLabel = editingSaleId
    ? `تعديل #${editingSaleId}`
    : state.items.length > 0
      ? `مسودة — ${state.items.length} خدمات`
      : 'فاتورة جديدة';

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* ═══════ MOBILE LAYOUT (< md) ═══════ */}
      <div className="pos-mobile-workspace flex h-full min-h-0 flex-col md:hidden">
        <ShiftRequiredOverlay />
        <MobilePosHeader
          invoiceLabel={invoiceLabel}
          shiftId={shift?.ID ?? null}
          shiftName={shift?.ShiftName ?? null}
          onNewSale={handleNewSale}
          onOpenRecentSales={() => setIsRecentInvoicesOpen(true)}
        />

        <div className="sticky top-0 z-30 shrink-0 border-b border-border bg-background/95 px-3 py-2 backdrop-blur-sm">
          <CustomerSearch
            selected={state.customer}
            onSelect={(c: Customer | null) => setCustomer(c)}
            onQuickAdd={(prefill) => { setQuickAddPrefill(prefill); setQuickAddOpen(true); }}
            onCompleteData={(c) => { setCompleteCustomerMode('complete'); setCompleteCustomer(c); }}
            onEditCustomer={(c) => { setCompleteCustomerMode('edit'); setCompleteCustomer(c); }}
            updatedCustomer={lastUpdatedCustomer}
          />
          {state.customer && !vouchersOpen && (
            <button
              type="button"
              onClick={() => setVouchersOpen(true)}
              className="mt-2 flex min-h-11 w-full items-center justify-between rounded-lg border border-warning/20 bg-warning/10 px-3 py-2 text-sm font-medium text-warning transition-colors hover:bg-warning/15"
            >
              <span>مكافآت النقاط</span>
              <span className="rounded-md bg-warning/20 px-1.5 py-0.5 text-xs">عرض</span>
            </button>
          )}
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-3 pb-[calc(4.5rem+env(safe-area-inset-bottom))] pt-3 scrollbar-luxury-v">
          <QuickActionsBar onAction={handleQuickAction} />
          <BarberCarousel
            barbers={barbers}
            selected={state.barber}
            onSelect={setBarber}
          />
          <Separator className="bg-border" />
          <ServiceCatalog
            services={services}
            selectedBarber={state.barber}
            onAddItem={addItem}
          />
        </div>

        <MobileInvoiceBar
          itemCount={state.items.length}
          grandTotal={totals.grandTotal}
          onOpen={() => setInvoiceSheetOpen(true)}
        />

        <MobileInvoiceSheet
          open={invoiceSheetOpen}
          onClose={() => setInvoiceSheetOpen(false)}
          {...invoicePanelProps}
        />
      </div>

      {/* ═══════ DESKTOP / TABLET LAYOUT (≥ md) ═══════ */}
      <div className="relative hidden h-full flex-1 flex-col overflow-hidden md:flex lg:flex-row">
        <ShiftRequiredOverlay />
        {/* ═══════ RIGHT PANEL: Customer + History ═══════ */}
        <aside className="order-1 flex w-full shrink-0 flex-col gap-3 overflow-y-auto border-l border-border p-3 scrollbar-luxury-v lg:order-1 lg:w-80 lg:gap-4 lg:p-4">
          <CustomerSearch
            selected={state.customer}
            onSelect={(c: Customer | null) => setCustomer(c)}
            onQuickAdd={(prefill) => { setQuickAddPrefill(prefill); setQuickAddOpen(true); }}
            onCompleteData={(c) => { setCompleteCustomerMode('complete'); setCompleteCustomer(c); }}
            onEditCustomer={(c) => { setCompleteCustomerMode('edit'); setCompleteCustomer(c); }}
            updatedCustomer={lastUpdatedCustomer}
          />

          {/* Vouchers button — shown when customer is selected and modal is closed */}
          {state.customer && !vouchersOpen && (
            <button
              onClick={() => setVouchersOpen(true)}
              className="w-full flex items-center justify-between px-3 py-2 rounded-lg bg-warning/10 border border-warning/20 hover:bg-warning/15 transition-colors text-sm text-warning font-medium"
            >
              <span>مكافآت النقاط</span>
              <span className="text-xs bg-warning/20 px-1.5 py-0.5 rounded-md">عرض</span>
            </button>
          )}

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
        <main className="order-3 min-h-[40vh] min-w-0 flex-1 space-y-4 overflow-y-auto p-3 scrollbar-luxury-v lg:order-2 lg:space-y-5 lg:p-4">
          <QuickActionsBar onAction={handleQuickAction} />
          <BarberCarousel
            barbers={barbers}
            selected={state.barber}
            onSelect={setBarber}
          />
          <Separator className="bg-border" />
          <ServiceCatalog
            services={services}
            selectedBarber={state.barber}
            onAddItem={addItem}
          />
        </main>

        {/* ═══════ LEFT PANEL: Cart + Summary + Payment + Save ═══════ */}
        <aside className="order-2 flex w-full shrink-0 flex-col gap-3 overflow-y-auto border-r border-border p-3 scrollbar-luxury-v lg:order-3 lg:w-80 lg:gap-4 lg:p-4">
          <PosInvoicePanel {...invoicePanelProps} />
          <PosInvoiceSaveActions
            saving={saving}
            disabled={state.items.length === 0}
            onSave={handleSave}
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
          onClose={handleCloseCompleteModal}
          onUpdated={handleCompleteCustomerUpdated}
        />
      )}
      <PrintInvoiceModal
        open={printOpen}
        invID={printInvID}
        onClose={() => { setPrintOpen(false); setPrintInvID(null); }}
      />

      {/* ═══════ Client Vouchers Modal ═══════ */}
      {state.customer && (
        <ClientVouchersModal
          clientId={state.customer.ClientID}
          clientName={state.customer.Name}
          open={vouchersOpen}
          onClose={() => setVouchersOpen(false)}
          onUseVoucher={(inventoryId, itemType, value, nameAr) => {
            addToast('success', `تم تطبيق: ${nameAr}`);
            if (itemType === 'DISCOUNT_AMOUNT' && value) {
              setDiscountValue(value);
            } else if (itemType === 'DISCOUNT_PERCENT' && value) {
              setDiscountPercent(value);
            }
          }}
        />
      )}

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

      <PaymentTransferModal
        open={isPaymentTransferOpen}
        onClose={() => setIsPaymentTransferOpen(false)}
        onTransferComplete={() => {
          addToast('success', 'تم تنفيذ التحويل بنجاح');
        }}
      />
      <QuickExpenseModal
        open={isQuickExpenseOpen}
        onClose={() => setIsQuickExpenseOpen(false)}
        onExpenseComplete={() => {
          addToast('success', 'تم إضافة المصروف بنجاح');
        }}
      />
      <QuickIncomeModal
        open={isQuickIncomeOpen}
        onClose={() => setIsQuickIncomeOpen(false)}
        onIncomeComplete={() => {
          addToast('success', 'تم إضافة الإيراد بنجاح');
        }}
      />
      <RecentInvoicesDrawer
        open={isRecentInvoicesOpen}
        onClose={() => setIsRecentInvoicesOpen(false)}
        onEditSale={handleEditSale}
        onDeleteSale={(saleId) => {
          console.log('Delete sale:', saleId);
        }}
        onRefresh={() => {
          console.log('Refresh sales');
        }}
      />

      {/* ═══════ Toast Notifications ═══════ */}
      <ToastList toasts={toasts} dismiss={dismissToast} />
    </div>
  );
}
