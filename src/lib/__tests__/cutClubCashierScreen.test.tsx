// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import CashierCutClubClient from "@/app/cashier/cut-club/CashierCutClubClient";

const activeVoucher = {
  inventoryId: 101, customerName: "عميل اختبار", itemName: "خدمة مجانية",
  itemType: "FREE_SERVICE", serviceId: 9,
  status: "ACTIVE", expiresAt: "2099-01-01T00:00:00.000Z",
  usable: true, consumptionSupported: true,
};
const fetchOriginal = globalThis.fetch;
afterEach(() => { cleanup(); globalThis.fetch = fetchOriginal; vi.restoreAllMocks(); });
beforeEach(() => { globalThis.fetch = vi.fn() as typeof fetch; });

describe("CUT CLUB V2 cashier client UX — synthetic, no DB", () => {
  it("keeps all network and voucher redemption controls locked without release flags", () => {
    render(<CashierCutClubClient branchName="GLEEM" readEnabled={false} redemptionEnabled={false} />);
    expect(screen.getByText(/ميزة CUT CLUB الجديدة لسه مقفولة/)).toBeTruthy();
    const scan = screen.getByRole("button", { name: /فحص القسيمة/ }) as HTMLButtonElement;
    expect(scan.disabled).toBe(true);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("shows safe voucher details, then requires a saved invoice before one use request", async () => {
    const request = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true, voucher: activeVoucher }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true, replayed: false }) });
    globalThis.fetch = request as typeof fetch;
    render(<CashierCutClubClient branchName="GLEEM" readEnabled={true} redemptionEnabled={true} />);
    fireEvent.change(screen.getByLabelText("كود القسيمة"), { target: { value: "cut-test-voucher-001" } });
    fireEvent.click(screen.getByRole("button", { name: /فحص القسيمة/ }));
    await waitFor(() => expect(screen.getByText("عميل اختبار")).toBeTruthy());
    expect(request).toHaveBeenCalledTimes(1);
    const confirmation = screen.getByRole("button", { name: /تأكيد استخدام الخدمة المجانية/ }) as HTMLButtonElement;
    expect(confirmation.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("رقم فاتورة البيع المحفوظة"), { target: { value: "77" } });
    expect(confirmation.disabled).toBe(false);
    fireEvent.click(confirmation);
    await waitFor(() => expect(screen.getByText(/تم تأكيد استخدام القسيمة/)).toBeTruthy());
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[1][0]).toBe("/api/pos/cut-club/redeem");
    const args = request.mock.calls[1][1] as RequestInit;
    expect(args.method).toBe("POST");
    expect(JSON.parse(args.body as string)).toEqual({
      code: "CUT-TEST-VOUCHER-001", invoiceId: 77,
    });
  });

  it("refuses unsupported financial effects; no redeem request issued", async () => {
    const request = vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ ok: true, voucher: {
        ...activeVoucher, itemType: "DISCOUNT_AMOUNT", consumptionSupported: false,
      } }),
    });
    globalThis.fetch = request as typeof fetch;
    render(<CashierCutClubClient branchName="CAMP" readEnabled={true} redemptionEnabled={true} />);
    fireEvent.change(screen.getByLabelText("كود القسيمة"), { target: { value: "CUT-TEST-VOUCHER-001" } });
    fireEvent.click(screen.getByRole("button", { name: /فحص القسيمة/ }));
    await waitFor(() => expect(screen.getByText(/نوع المكافأة ده لسه محتاج ربط مالي/)).toBeTruthy());
    expect(screen.queryByRole("button", { name: /تأكيد استخدام الخدمة المجانية/ })).toBeNull();
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("never says used on error or unknown network result", async () => {
    const request = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true, voucher: activeVoucher }) })
      .mockResolvedValueOnce({ ok: false, json: async () => ({ ok: false, error: "الفاتورة مش مطابقة" }) });
    globalThis.fetch = request as typeof fetch;
    render(<CashierCutClubClient branchName="GLEEM" readEnabled={true} redemptionEnabled={true} />);
    fireEvent.change(screen.getByLabelText("كود القسيمة"), { target: { value: "CUT-TEST-VOUCHER-001" } });
    fireEvent.click(screen.getByRole("button", { name: /فحص القسيمة/ }));
    await waitFor(() => expect(screen.getByText("عميل اختبار")).toBeTruthy());
    fireEvent.change(screen.getByLabelText("رقم فاتورة البيع المحفوظة"), { target: { value: "77" } });
    fireEvent.click(screen.getByRole("button", { name: /تأكيد استخدام الخدمة المجانية/ }));
    await waitFor(() => expect(screen.getByText("الفاتورة مش مطابقة")).toBeTruthy());
    expect(screen.queryByText(/تم تأكيد استخدام القسيمة/)).toBeNull();
    expect(screen.getByText("صالحة")).toBeTruthy();
  });
});
