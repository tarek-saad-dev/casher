import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

function src(relative: string): string {
  return readFileSync(path.join(process.cwd(), relative), 'utf8');
}

const TYPED_SENDERS = [
  'sendSaleWhatsAppMessage',
  'sendBookingWhatsAppMessage',
  'sendFirstTimeWhatsAppMessage',
  'sendEmployeeSaleWhatsAppMessage',
  'sendEmployeeAdvanceWhatsAppMessage',
  'sendEmployeeFundingWhatsAppMessage',
  'sendQuickWhatsAppMessage',
  'sendEmployeeDailyReportWhatsAppMessage',
  'sendOtherWhatsAppMessage',
] as const;

describe('Phase 8 pure gateway boundary', () => {
  it('public whatsapp index exports only generic + status/health', () => {
    const text = src('src/lib/integrations/whatsapp/index.ts');
    expect(text).toContain('sendWhatsAppMessage');
    expect(text).toContain('checkWhatsAppStatus');
    expect(text).toContain('checkWhatsAppBotHealth');
    for (const name of TYPED_SENDERS) {
      expect(text).not.toContain(name);
    }
  });

  it('service layer has no typed senders', () => {
    const text = src('src/lib/integrations/whatsapp/service.ts');
    for (const name of TYPED_SENDERS) {
      expect(text).not.toContain(`function ${name}`);
      expect(text).not.toContain(`export async function ${name}`);
    }
    expect(text).toContain('sendGenericWhatsAppPayload');
    expect(text).not.toContain('sendWhatsAppPayload');
  });

  it('admin test-send uses Messaging Module only', () => {
    const text = src('src/app/api/admin/whatsapp/test-send/route.ts');
    expect(text).toContain("@/modules/messaging");
    expect(text).toContain('sendTemplateMessage');
    expect(text).toContain('sendMessage');
    for (const name of TYPED_SENDERS) {
      expect(text).not.toContain(name);
    }
  });

  it('production feature callers do not import typed senders', () => {
    const files = [
      'src/app/api/sales/route.ts',
      'src/lib/bookingPostCommitNotification.ts',
      'src/lib/services/employeeAdvanceWhatsAppNotify.ts',
      'src/lib/services/employeeAttendanceWhatsAppNotify.ts',
      'src/lib/hr/employee-daily-whatsapp-report.service.ts',
      'src/lib/hr/owner-daily-whatsapp-report.service.ts',
      'src/app/api/pos/whatsapp/quick-send/route.ts',
      'src/modules/messaging/campaigns/application/startCampaign.ts',
    ];
    for (const file of files) {
      const text = src(file);
      for (const name of TYPED_SENDERS) {
        expect(text, `${file} must not call ${name}`).not.toContain(name);
      }
      expect(text, `${file} must not hit bot campaigns`).not.toMatch(
        /\/api\/campaigns|\/api\/offers|whatsapp-bot\/routes/,
      );
    }
  });

  it('generic client body never includes type', () => {
    const text = src('src/lib/integrations/whatsapp/client.ts');
    expect(text).toContain('sendGenericWhatsAppPayload');
    const genericFn = text.slice(text.indexOf('sendGenericWhatsAppPayload'));
    const bodyBlock = genericFn.slice(0, genericFn.indexOf('return postWhatsAppSend'));
    expect(bodyBlock).not.toMatch(/\btype\s*:/);
  });
});
