// @vitest-environment happy-dom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { CartItem, Customer } from '@/lib/types';
import { useSaleState } from '@/hooks/useSaleState';
import {
  canApplyPosReferralReward,
  referralSalePayloadDiscount,
} from '@/lib/referrals/posReferralCheckoutPolicy';

const CUSTOMER: Customer = {
  ClientID: 45, Name: 'Test', Mobile: null, BirthDate: null, Address: null,
  RegisterDate: null, Notes: null, CameFrom: null, CameFromDetails: null, ReferralCode: null,
};
const LINE: CartItem = {
  id: 'line1', ProID: 9, ProName: 'Service', EmpID: 15, EmpName: 'Barber',
  SPrice: 100.01, Bonus: 0, Qty: 1, Dis: 0, DisVal: 0, SPriceAfterDis: 100.01,
};
function setup() {
  const hook = renderHook(() => useSaleState());
  act(() => {
    hook.result.current.setCustomer(CUSTOMER);
    hook.result.current.addItem(LINE);
    hook.result.current.setPaymentMethod(1);
    hook.result.current.setPaymentAllocations([
      { paymentMethodId: 1, amount: 60 }, { paymentMethodId: 2, amount: 40.01 },
    ]);
  });
  return hook;
}
afterEach(cleanup);

describe('20% wallet Apply / Remove cashier state (#233)', () => {
  it('wallet lookup itself never applies a discount', () => {
    const { result } = setup();
    expect(result.current.state.referralVoucherId).toBeNull();
    expect(result.current.totals.grandTotal).toBe(100.01);
    expect(canApplyPosReferralReward(result.current.state, 300, 45)).toBe(true);
  });

  it('explicit Apply sets 20%, clears payment allocation, sends only voucherId and no manual discount', () => {
    const { result } = setup();
    act(() => result.current.applyReferralReward(300, 45));
    expect(result.current.state.referralVoucherId).toBe(300);
    expect(result.current.state.referralCode).toBeNull();
    expect(result.current.state.discountPercent).toBe(20);
    expect(result.current.state.discountValue).toBe(20);
    expect(result.current.totals.grandTotal).toBe(80.01);
    expect(result.current.state.paymentAllocations).toEqual([]);
    expect(referralSalePayloadDiscount(result.current.state))
      .toEqual({ dis: 0, disVal: 0, referralVoucherId: 300 });
  });

  it('rejects voucher selected for another customer or unsafe ID', () => {
    const { result } = setup();
    act(() => {
      result.current.applyReferralReward(300, 88);
      result.current.applyReferralReward(-1, 45);
    });
    expect(result.current.state.referralVoucherId).toBeNull();
    expect(result.current.totals.grandTotal).toBe(100.01);
  });

  it('prevents stacking 50% code with reward and vice versa', () => {
    const { result } = setup();
    act(() => result.current.applyReferralReward(300, 45));
    act(() => result.current.applyReferral('CUT-ABCDEF0123456789ABCDEF01', 45));
    expect(result.current.state.referralCode).toBeNull();
    expect(result.current.state.referralVoucherId).toBe(300);
    act(() => result.current.clearReferralReward());
    act(() => result.current.applyReferral('CUT-ABCDEF0123456789ABCDEF01', 45));
    act(() => result.current.applyReferralReward(300, 45));
    expect(result.current.state.referralVoucherId).toBeNull();
    expect(result.current.state.referralCode).toBe('CUT-ABCDEF0123456789ABCDEF01');
  });

  it('customer switch and item edit remove reward, reset discount and allocations', () => {
    const { result } = setup();
    act(() => result.current.applyReferralReward(300, 45));
    act(() => result.current.setCustomer({ ...CUSTOMER, ClientID: 50 }));
    expect(result.current.state.referralVoucherId).toBeNull();
    expect(result.current.state.discountPercent).toBe(0);
    expect(result.current.state.paymentAllocations).toEqual([]);
    act(() => result.current.applyReferralReward(300, 50));
    act(() => result.current.updateItem('line1', { Qty: 2 }));
    expect(result.current.state.referralVoucherId).toBeNull();
    expect(result.current.totals.grandTotal).toBe(200.02);
  });

  it('manual/line discounts prevent applying reward and change revokes it', () => {
    const { result } = setup();
    act(() => result.current.setDiscountValue(5));
    act(() => result.current.applyReferralReward(300, 45));
    expect(result.current.state.referralVoucherId).toBeNull();
    act(() => result.current.setDiscountValue(0));
    act(() => result.current.applyReferralReward(300, 45));
    act(() => result.current.setDiscountPercent(10));
    expect(result.current.state.referralVoucherId).toBeNull();
    expect(result.current.totals.grandTotal).toBe(90.01);
  });

  it('explicit Remove and Reset restore full price without any GET/POST voucher mutation', () => {
    const { result } = setup();
    act(() => result.current.applyReferralReward(300, 45));
    act(() => result.current.clearReferralReward());
    expect(result.current.state.referralVoucherId).toBeNull();
    expect(result.current.totals.grandTotal).toBe(100.01);
    act(() => result.current.applyReferralReward(300, 45));
    act(() => result.current.reset());
    expect(result.current.state.referralVoucherId).toBeNull();
    expect(result.current.state.customer).toBeNull();
    expect(result.current.totals.grandTotal).toBe(0);
  });
});
