// @vitest-environment happy-dom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { CartItem, Customer } from '@/lib/types';
import { useSaleState } from '@/hooks/useSaleState';
import {
  canApplyPosReferral,
  referralSalePayloadDiscount,
} from '@/lib/referrals/posReferralCheckoutPolicy';

const CODE = 'CUT-ABCDEF0123456789ABCDEF01';
const CUSTOMER: Customer = {
  ClientID: 21, Name: 'Test', Mobile: null, BirthDate: null, Address: null,
  RegisterDate: null, Notes: null, CameFrom: null, CameFromDetails: null, ReferralCode: null,
};
const LINE: CartItem = {
  id: 'line-1', ProID: 9, ProName: 'Service', EmpID: 15,
  EmpName: 'Barber', SPrice: 100.01, Bonus: 0, Qty: 1,
  Dis: 0, DisVal: 0, SPriceAfterDis: 100.01,
};

afterEach(cleanup);

function setup() {
  const hook = renderHook(() => useSaleState());
  act(() => {
    hook.result.current.setCustomer(CUSTOMER);
    hook.result.current.addItem(LINE);
    hook.result.current.setPaymentMethod(1);
    hook.result.current.setPaymentAllocations([
      { paymentMethodId: 1, amount: 60 },
      { paymentMethodId: 2, amount: 40.01 },
    ]);
  });
  return hook;
}

describe('cashier 50% referral state transitions (#229)', () => {
  it('preview alone never changes subtotal/discount/payments', () => {
    const { result } = setup();
    expect(result.current.state.referralCode).toBeNull();
    expect(result.current.totals.grandTotal).toBe(100.01);
    expect(result.current.state.discountPercent).toBe(0);
    expect(result.current.state.paymentAllocations).toHaveLength(2);
  });

  it('only a deliberate Apply sets 50% and resets old payment allocations', () => {
    const { result } = setup();
    expect(canApplyPosReferral(result.current.state, CODE, CUSTOMER.ClientID)).toBe(true);
    act(() => result.current.applyReferral(CODE, CUSTOMER.ClientID));
    expect(result.current.state.referralCode).toBe(CODE);
    expect(result.current.state.discountPercent).toBe(50);
    expect(result.current.state.discountValue).toBe(50.01);
    expect(result.current.totals.grandTotal).toBe(50);
    expect(result.current.state.paymentAllocations).toEqual([]);
    expect(referralSalePayloadDiscount(result.current.state))
      .toEqual({ dis: 0, disVal: 0, referralCode: CODE });
  });

  it('refuses applying to a different customer even with eligible preview from a previous customer', () => {
    const { result } = setup();
    act(() => result.current.applyReferral(CODE, 999));
    expect(result.current.state.referralCode).toBeNull();
    expect(result.current.totals.grandTotal).toBe(100.01);
  });

  it('clears applied code and promotion on customer change', () => {
    const { result } = setup();
    act(() => result.current.applyReferral(CODE, 21));
    act(() => result.current.setCustomer({ ...CUSTOMER, ClientID: 22 }));
    expect(result.current.state.referralCode).toBeNull();
    expect(result.current.state.discountValue).toBe(0);
    expect(result.current.totals.grandTotal).toBe(100.01);
    expect(result.current.state.paymentAllocations).toEqual([]);
  });

  it('keeps code after benign data edit for SAME customer', () => {
    const { result } = setup();
    act(() => result.current.applyReferral(CODE, 21));
    act(() => result.current.setCustomer({ ...CUSTOMER, Name: 'Updated name' }));
    expect(result.current.state.referralCode).toBe(CODE);
  });

  it('clears applied referral and payment allocations when service price/quantity changes', () => {
    const { result } = setup();
    act(() => result.current.applyReferral(CODE, 21));
    act(() => result.current.updateItem('line-1', { Qty: 2 }));
    expect(result.current.state.referralCode).toBeNull();
    expect(result.current.state.discountPercent).toBe(0);
    expect(result.current.totals.grandTotal).toBe(200.02);
    expect(result.current.state.paymentAllocations).toEqual([]);
  });

  it('clears applied code when a new item is added or removed', () => {
    const { result } = setup();
    act(() => result.current.applyReferral(CODE, 21));
    act(() => result.current.addItem({ ...LINE, id: 'line-2' }));
    expect(result.current.state.referralCode).toBeNull();
    expect(result.current.totals.grandTotal).toBe(200.02);
    act(() => result.current.applyReferral(CODE, 21));
    act(() => result.current.removeItem('line-2'));
    expect(result.current.state.referralCode).toBeNull();
    expect(result.current.totals.grandTotal).toBe(100.01);
  });

  it('clears applied referral when cashier changes manual header discount', () => {
    const { result } = setup();
    act(() => result.current.applyReferral(CODE, 21));
    act(() => result.current.setDiscountPercent(10));
    expect(result.current.state.referralCode).toBeNull();
    expect(result.current.state.discountPercent).toBe(10);
    expect(result.current.totals.grandTotal).toBe(90.01);
    expect(referralSalePayloadDiscount(result.current.state).referralCode).toBeUndefined();
  });

  it('does not allow code stacking with a manual header or line discount', () => {
    const { result } = setup();
    act(() => result.current.setDiscountValue(10));
    act(() => result.current.applyReferral(CODE, 21));
    expect(result.current.state.referralCode).toBeNull();
    act(() => result.current.setDiscountValue(0));
    act(() => result.current.updateItem('line-1', { DisVal: 10 }));
    act(() => result.current.applyReferral(CODE, 21));
    expect(result.current.state.referralCode).toBeNull();
  });

  it('explicit Remove and Reset return the original full-price invoice', () => {
    const { result } = setup();
    act(() => result.current.applyReferral(CODE, 21));
    act(() => result.current.clearReferral());
    expect(result.current.state.referralCode).toBeNull();
    expect(result.current.totals.grandTotal).toBe(100.01);
    act(() => result.current.applyReferral(CODE, 21));
    act(() => result.current.reset());
    expect(result.current.state.referralCode).toBeNull();
    expect(result.current.state.customer).toBeNull();
    expect(result.current.totals.grandTotal).toBe(0);
  });
});
