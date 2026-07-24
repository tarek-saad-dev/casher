'use client';

import { useReducer, useCallback, useMemo } from 'react';
import type { Customer, Barber, CartItem, SaleState, SaleTotals, PaymentAllocation } from '@/lib/types';
import {
  computeInvoiceItemsTotals,
  computeServiceLineTotals,
} from '@/lib/sales/service-line-totals';

// ───────────────────────── Actions ─────────────────────────

type Action =
  | { type: 'SET_CUSTOMER'; customer: Customer | null }
  | { type: 'SET_BARBER'; barber: Barber | null }
  | { type: 'ADD_ITEM'; item: CartItem }
  | { type: 'REMOVE_ITEM'; id: string }
  | { type: 'UPDATE_ITEM'; id: string; patch: Partial<CartItem> }
  | { type: 'SET_DISCOUNT_PERCENT'; value: number }
  | { type: 'SET_DISCOUNT_VALUE'; value: number }
  | { type: 'SET_PAYMENT_METHOD'; id: number | null }
  | { type: 'SET_PAYMENT_ALLOCATIONS'; allocations: PaymentAllocation[] }
  | { type: 'UPDATE_PAYMENT_AMOUNT'; paymentMethodId: number; amount: number }
  | { type: 'SET_NOTES'; notes: string }
  | { type: 'SET_SHIFT'; shiftMoveId: number | null }
  | { type: 'CLEAR_ITEMS' }
  | { type: 'RESET' };

// ───────────────────────── Initial State ─────────────────────────

const initialState: SaleState = {
  customer: null,
  barber: null,
  items: [],
  discountPercent: 0,
  discountValue: 0,
  paymentMethodId: null,
  paymentAllocations: [],
  notes: '',
  shiftMoveId: null,
};

function normalizeCartItem(item: CartItem): CartItem {
  const totals = computeServiceLineTotals({
    sPrice: item.SPrice,
    qty: item.Qty,
    discountPercent: item.Dis,
    discountValue: item.DisVal,
  });
  return {
    ...item,
    Qty: item.Qty > 0 ? item.Qty : 1,
    Dis: totals.discountPercent,
    DisVal: totals.discountValue,
    SPriceAfterDis: totals.netAmount,
  };
}

function syncHeaderDiscountFromPercent(items: CartItem[], percent: number) {
  const linesNet = computeInvoiceItemsTotals(
    items.map((item) => ({
      sPrice: item.SPrice,
      qty: item.Qty,
      discountPercent: item.Dis,
      discountValue: item.DisVal,
    })),
  ).linesNetTotal;
  const discountPercent = Math.max(0, Math.min(100, percent));
  const discountValue =
    linesNet > 0
      ? Math.round(((linesNet * discountPercent) / 100) * 100) / 100
      : 0;
  return { discountPercent, discountValue };
}

function syncHeaderDiscountFromValue(items: CartItem[], value: number) {
  const linesNet = computeInvoiceItemsTotals(
    items.map((item) => ({
      sPrice: item.SPrice,
      qty: item.Qty,
      discountPercent: item.Dis,
      discountValue: item.DisVal,
    })),
  ).linesNetTotal;
  const discountValue = Math.max(0, Math.min(linesNet, value));
  const discountPercent =
    linesNet > 0
      ? Math.round(Math.min(100, (discountValue / linesNet) * 100) * 100) / 100
      : 0;
  return { discountPercent, discountValue };
}

// ───────────────────────── Reducer ─────────────────────────

function reducer(state: SaleState, action: Action): SaleState {
  switch (action.type) {
    case 'SET_CUSTOMER':
      return { ...state, customer: action.customer };
    case 'SET_BARBER':
      return { ...state, barber: action.barber };
    case 'ADD_ITEM':
      return { ...state, items: [...state.items, normalizeCartItem(action.item)] };
    case 'REMOVE_ITEM':
      return { ...state, items: state.items.filter((i) => i.id !== action.id) };
    case 'UPDATE_ITEM':
      return {
        ...state,
        items: state.items.map((i) =>
          i.id === action.id ? normalizeCartItem({ ...i, ...action.patch }) : i,
        ),
      };
    case 'CLEAR_ITEMS':
      return { ...state, items: [], discountPercent: 0, discountValue: 0 };
    case 'SET_DISCOUNT_PERCENT': {
      const synced = syncHeaderDiscountFromPercent(state.items, action.value);
      return { ...state, ...synced };
    }
    case 'SET_DISCOUNT_VALUE': {
      const synced = syncHeaderDiscountFromValue(state.items, action.value);
      return { ...state, ...synced };
    }
    case 'SET_PAYMENT_METHOD':
      return { ...state, paymentMethodId: action.id };
    case 'SET_PAYMENT_ALLOCATIONS':
      return { ...state, paymentAllocations: action.allocations };
    case 'UPDATE_PAYMENT_AMOUNT':
      return {
        ...state,
        paymentAllocations: state.paymentAllocations.map((pa) =>
          pa.paymentMethodId === action.paymentMethodId
            ? { ...pa, amount: action.amount }
            : pa,
        ),
      };
    case 'SET_NOTES':
      return { ...state, notes: action.notes };
    case 'SET_SHIFT':
      return { ...state, shiftMoveId: action.shiftMoveId };
    case 'RESET':
      return { ...initialState, shiftMoveId: state.shiftMoveId, paymentAllocations: [] };
    default:
      return state;
  }
}

// ───────────────────────── Hook ─────────────────────────

export function useSaleState() {
  const [state, dispatch] = useReducer(reducer, initialState);

  const totals: SaleTotals = useMemo(() => {
    const computed = computeInvoiceItemsTotals(
      state.items.map((item) => ({
        sPrice: item.SPrice,
        qty: item.Qty,
        discountPercent: item.Dis,
        discountValue: item.DisVal,
        bonus: item.Bonus,
      })),
      {
        discountPercent: state.discountPercent,
        discountValue: state.discountValue,
      },
    );

    return {
      totalQty: computed.totalQty,
      subTotal: computed.subTotal,
      lineDiscountValue: computed.lineDiscountTotal,
      headerDiscountValue: computed.headerDiscountValue,
      discountValue: computed.totalDiscount,
      taxValue: 0,
      grandTotal: computed.grandTotal,
      totalBonus: computed.totalBonus,
    };
  }, [state.items, state.discountPercent, state.discountValue]);

  const setCustomer = useCallback((c: Customer | null) => dispatch({ type: 'SET_CUSTOMER', customer: c }), []);
  const setBarber = useCallback((b: Barber | null) => dispatch({ type: 'SET_BARBER', barber: b }), []);
  const addItem = useCallback((item: CartItem) => dispatch({ type: 'ADD_ITEM', item }), []);
  const removeItem = useCallback((id: string) => dispatch({ type: 'REMOVE_ITEM', id }), []);
  const updateItem = useCallback(
    (id: string, patch: Partial<CartItem>) => dispatch({ type: 'UPDATE_ITEM', id, patch }),
    [],
  );
  const setDiscountPercent = useCallback(
    (v: number) => dispatch({ type: 'SET_DISCOUNT_PERCENT', value: v }),
    [],
  );
  const setDiscountValue = useCallback(
    (v: number) => dispatch({ type: 'SET_DISCOUNT_VALUE', value: v }),
    [],
  );
  const setPaymentMethod = useCallback(
    (id: number | null) => dispatch({ type: 'SET_PAYMENT_METHOD', id }),
    [],
  );
  const setPaymentAllocations = useCallback(
    (allocations: PaymentAllocation[]) =>
      dispatch({ type: 'SET_PAYMENT_ALLOCATIONS', allocations }),
    [],
  );
  const updatePaymentAmount = useCallback(
    (paymentMethodId: number, amount: number) =>
      dispatch({ type: 'UPDATE_PAYMENT_AMOUNT', paymentMethodId, amount }),
    [],
  );
  const setNotes = useCallback((n: string) => dispatch({ type: 'SET_NOTES', notes: n }), []);
  const setShift = useCallback(
    (id: number | null) => dispatch({ type: 'SET_SHIFT', shiftMoveId: id }),
    [],
  );
  const clearItems = useCallback(() => dispatch({ type: 'CLEAR_ITEMS' }), []);
  const reset = useCallback(() => dispatch({ type: 'RESET' }), []);

  /** Apply a voucher-style discount onto the largest service line (keeps header discount separate). */
  const applyDiscountToLargestLine = useCallback(
    (mode: 'value' | 'percent', amount: number) => {
      if (!Number.isFinite(amount) || amount <= 0 || state.items.length === 0) return;
      let bestIdx = 0;
      let bestGross = -1;
      state.items.forEach((item, idx) => {
        const g = computeServiceLineTotals({
          sPrice: item.SPrice,
          qty: item.Qty,
          discountValue: 0,
        }).grossAmount;
        if (g > bestGross) {
          bestGross = g;
          bestIdx = idx;
        }
      });
      const target = state.items[bestIdx];
      if (!target) return;
      const lineTotals = computeServiceLineTotals({
        sPrice: target.SPrice,
        qty: target.Qty,
        discountPercent: mode === 'percent' ? amount : undefined,
        discountValue: mode === 'value' ? amount : undefined,
      });
      dispatch({
        type: 'UPDATE_ITEM',
        id: target.id,
        patch: {
          Dis: lineTotals.discountPercent,
          DisVal: lineTotals.discountValue,
          SPriceAfterDis: lineTotals.netAmount,
        },
      });
    },
    [state.items],
  );

  return {
    state,
    totals,
    setCustomer,
    setBarber,
    addItem,
    removeItem,
    updateItem,
    setDiscountPercent,
    setDiscountValue,
    applyDiscountToLargestLine,
    setPaymentMethod,
    setPaymentAllocations,
    updatePaymentAmount,
    setNotes,
    setShift,
    clearItems,
    reset,
  };
}
