'use client';

import { useReducer, useCallback, useMemo } from 'react';
import type { Customer, Barber, CartItem, SaleState, SaleTotals } from '@/lib/types';

// ───────────────────────── Actions ─────────────────────────

type Action =
  | { type: 'SET_CUSTOMER'; customer: Customer | null }
  | { type: 'SET_BARBER'; barber: Barber | null }
  | { type: 'ADD_ITEM'; item: CartItem }
  | { type: 'REMOVE_ITEM'; id: string }
  | { type: 'SET_DISCOUNT_PERCENT'; value: number }
  | { type: 'SET_DISCOUNT_VALUE'; value: number }
  | { type: 'SET_PAYMENT_METHOD'; id: number | null }
  | { type: 'SET_NOTES'; notes: string }
  | { type: 'SET_SHIFT'; shiftMoveId: number | null }
  | { type: 'RESET' };

// ───────────────────────── Initial State ─────────────────────────

const initialState: SaleState = {
  customer: null,
  barber: null,
  items: [],
  discountPercent: 0,
  discountValue: 0,
  paymentMethodId: null,
  notes: '',
  shiftMoveId: null,
};

// ───────────────────────── Reducer ─────────────────────────

function reducer(state: SaleState, action: Action): SaleState {
  switch (action.type) {
    case 'SET_CUSTOMER':
      return { ...state, customer: action.customer };
    case 'SET_BARBER':
      return { ...state, barber: action.barber };
    case 'ADD_ITEM':
      return { ...state, items: [...state.items, action.item] };
    case 'REMOVE_ITEM':
      return { ...state, items: state.items.filter(i => i.id !== action.id) };
    case 'SET_DISCOUNT_PERCENT':
      return { ...state, discountPercent: action.value, discountValue: 0 };
    case 'SET_DISCOUNT_VALUE':
      return { ...state, discountValue: action.value, discountPercent: 0 };
    case 'SET_PAYMENT_METHOD':
      return { ...state, paymentMethodId: action.id };
    case 'SET_NOTES':
      return { ...state, notes: action.notes };
    case 'SET_SHIFT':
      return { ...state, shiftMoveId: action.shiftMoveId };
    case 'RESET':
      return { ...initialState, shiftMoveId: state.shiftMoveId, barber: state.barber };
    default:
      return state;
  }
}

// ───────────────────────── Hook ─────────────────────────

export function useSaleState() {
  const [state, dispatch] = useReducer(reducer, initialState);

  const totals: SaleTotals = useMemo(() => {
    const totalQty = state.items.reduce((sum, i) => sum + i.Qty, 0);
    const subTotal = state.items.reduce((sum, i) => sum + (i.SPrice * i.Qty), 0);
    const totalBonus = state.items.reduce((sum, i) => sum + i.Bonus, 0);

    let discountValue = 0;
    if (state.discountPercent > 0) {
      discountValue = Math.round(subTotal * state.discountPercent / 100 * 100) / 100;
    } else {
      discountValue = state.discountValue;
    }
    if (discountValue > subTotal) discountValue = subTotal;

    const taxValue = 0; // No tax for now
    const grandTotal = Math.max(0, subTotal - discountValue + taxValue);

    return { totalQty, subTotal, discountValue, taxValue, grandTotal, totalBonus };
  }, [state.items, state.discountPercent, state.discountValue]);

  const setCustomer = useCallback((c: Customer | null) => dispatch({ type: 'SET_CUSTOMER', customer: c }), []);
  const setBarber = useCallback((b: Barber | null) => dispatch({ type: 'SET_BARBER', barber: b }), []);
  const addItem = useCallback((item: CartItem) => dispatch({ type: 'ADD_ITEM', item }), []);
  const removeItem = useCallback((id: string) => dispatch({ type: 'REMOVE_ITEM', id }), []);
  const setDiscountPercent = useCallback((v: number) => dispatch({ type: 'SET_DISCOUNT_PERCENT', value: v }), []);
  const setDiscountValue = useCallback((v: number) => dispatch({ type: 'SET_DISCOUNT_VALUE', value: v }), []);
  const setPaymentMethod = useCallback((id: number | null) => dispatch({ type: 'SET_PAYMENT_METHOD', id }), []);
  const setNotes = useCallback((n: string) => dispatch({ type: 'SET_NOTES', notes: n }), []);
  const setShift = useCallback((id: number | null) => dispatch({ type: 'SET_SHIFT', shiftMoveId: id }), []);
  const reset = useCallback(() => dispatch({ type: 'RESET' }), []);

  return {
    state,
    totals,
    setCustomer,
    setBarber,
    addItem,
    removeItem,
    setDiscountPercent,
    setDiscountValue,
    setPaymentMethod,
    setNotes,
    setShift,
    reset,
  };
}
