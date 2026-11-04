import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  isUsableCustomerPhone,
  normalizePublicBookingPhone,
} from '@/lib/publicBookingHelpers';

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8');

describe('operations booking customer registration safeguards', () => {
  it('normalizes English, Arabic and Persian digit variants to the same phone', () => {
    const phone = '01012345678';
    expect(normalizePublicBookingPhone(phone)).toBe(phone);
    expect(normalizePublicBookingPhone('+20 101 234 5678')).toBe(phone);
    expect(normalizePublicBookingPhone('٠١٠١٢٣٤٥٦٧٨')).toBe(phone);
    expect(normalizePublicBookingPhone('۰۱۰۱۲۳۴۵۶۷۸')).toBe(phone);
    expect(normalizePublicBookingPhone('0020-1012345678')).toBe(phone);
    expect(isUsableCustomerPhone('٠١٠١٢٣٤٥٦٧٨')).toBe(true);
  });

  it('does not treat placeholder/smoke phones as real matching customers', () => {
    expect(isUsableCustomerPhone('01000000000')).toBe(false);
    expect(isUsableCustomerPhone('٠١٠٠٠٠٠٠٠٠٠')).toBe(false);
  });

  it('only permits an intentionally blank phone for staff and verifies the linked number in the transaction', () => {
    const create = read('src/lib/booking/publicBookingCreate.ts');
    expect(create).toContain("isInternalPreview && !rawPhone.trim()");
    expect(create).toContain("throw new PublicBookingCreateError('INVALID_CUSTOMER_PHONE')");
    expect(create).toContain("normalizePublicBookingPhone(linked.Mobile ?? '') !== customerPhone");
    expect(create).toContain('INNER JOIN dbo.TblClient c');
    expect(create).toContain('c.TenantId = @tenantId');
    expect(create.indexOf('booking_customer_link_failed')).toBeLessThan(create.indexOf('await transaction.commit()'));
  });

  it('uses the same tenant-bound customer lookup for operations preview', () => {
    const route = read('src/app/api/customers/lookup-phone/route.ts');
    expect(route).toContain('authenticate()');
    expect(route).toContain('TenantId = @tenantId AND Mobile = @phone');
    expect(route).toContain("status: 'new'");
    expect(route).toContain("status: 'existing'");
    const bookingUi = read('src/components/operations/booking-workspace/BookingStepCustomer.tsx');
    expect(bookingUi).toContain('<BookingPhoneStatus');
    const workspace = read('src/components/operations/booking-workspace/useBookingWorkspace.ts');
    expect(workspace).toContain("phone: customerPhone.trim() || selectedClient?.Mobile || ''");
    expect(workspace).toContain('setCustomerPhone(normalizedPhone)');
    expect(workspace).toContain("/api/customers/lookup-phone?phone=");
    expect(workspace).toContain('setSelectedClient(client)');
    expect(workspace).toContain('setCustomerName(fields.customerName)');
    expect(workspace).toContain("data.status === 'new'");
    expect(workspace).toContain("document.getElementById('ops-booking-customer-name')?.focus()");
    expect(bookingUi).toContain('id="ops-booking-customer-name"');
    expect(workspace).toContain("fetch('/api/public/booking/create'");
  });
});
