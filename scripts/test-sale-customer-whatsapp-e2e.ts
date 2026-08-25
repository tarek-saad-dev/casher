#!/usr/bin/env npx tsx
/**
 * Phase 4D live vertical slice — production functions only.
 * Does not create a Sale row. Does not use typed / test-send.
 *
 * Requires WHATSAPP_E2E_TEST_PHONE in env (never committed).
 */
import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '.env.local'), override: true });

const MARKER = '[ERP-E2E-4D]';
const OVERRIDE_CONTENT = `أستاذ {{customerName}}
نورت Cut Salon ودايمًا منورنا 🙏✨
${MARKER}`;
const KEY = 'sale.customer_receipt';

function maskPhone(phone: string): string {
  if (phone.length <= 4) return '****';
  return `${phone.slice(0, 3)}****${phone.slice(-2)}`;
}

function redact(value: unknown): unknown {
  if (typeof value === 'string') {
    return value.replace(/\d{8,}/g, (m) => maskPhone(m));
  }
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = k.toLowerCase().includes('phone') && typeof v === 'string' ? maskPhone(v) : redact(v);
    }
    return out;
  }
  return value;
}

type CapturedSend = {
  url: string;
  body: Record<string, unknown>;
};

async function main() {
  const phone = String(process.env.WHATSAPP_E2E_TEST_PHONE ?? '').trim();
  if (!phone) {
    console.error('WHATSAPP_E2E_TEST_PHONE is required');
    process.exit(1);
  }

  const { getWhatsAppConfig } = await import('../src/lib/integrations/whatsapp');
  const cfg = getWhatsAppConfig();
  console.log('casher config', {
    enabled: cfg.enabled,
    apiBaseUrl: cfg.apiBaseUrl,
    saleEnabled: cfg.saleEnabled,
  });

  const healthUrl = `${cfg.apiBaseUrl}/api/health`;
  const statusUrl = `${cfg.apiBaseUrl}/api/whatsapp/status`;
  const healthRes = await fetch(healthUrl);
  const healthJson = await healthRes.json().catch(() => null);
  console.log('health', { http: healthRes.status, body: healthJson });
  const statusRes = await fetch(statusUrl);
  const statusJson = await statusRes.json().catch(() => null);
  console.log('whatsapp status', { http: statusRes.status, body: statusJson });

  const { getPool, closePool } = await import('../src/lib/db');
  const {
    upsertAdminWhatsAppBranchOverride,
    deactivateAdminWhatsAppBranchOverride,
    getAdminWhatsAppTemplate,
  } = await import('../src/modules/messaging/application/adminWhatsAppTemplates');
  const { composeMessage } = await import('../src/modules/messaging/application/composeMessage');
  const { sendSaleCustomerReceipt, buildSaleCustomerReceiptData } = await import(
    '../src/modules/messaging/application/sendSaleCustomerReceipt'
  );

  const db = await getPool();
  const branchRow = await db.request().query(`
    SELECT TOP 1 BranchID, BranchCode, BranchName
    FROM dbo.TblBranch
    WHERE BranchCode = N'GLEEM' AND ISNULL(IsActive,1) = 1
  `);
  const userRow = await db.request().query(`
    SELECT TOP 1 UserID, loginName
    FROM dbo.TblUser
    WHERE loginName IN (N'Tarek', N'tarek') AND ISNULL(isDeleted,0)=0
  `);
  const branchId = Number(branchRow.recordset[0]?.BranchID);
  const userId = Number(userRow.recordset[0]?.UserID);
  if (!Number.isFinite(branchId) || !Number.isFinite(userId)) {
    throw new Error('Could not resolve GLEEM branchId / Tarek userId');
  }
  console.log('branch', {
    branchId,
    code: branchRow.recordset[0]?.BranchCode,
    name: branchRow.recordset[0]?.BranchName,
  });

  const captured: CapturedSend[] = [];
  const origFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes('/api/whatsapp/send') && String(init?.method ?? 'GET').toUpperCase() === 'POST') {
      const raw = typeof init?.body === 'string' ? init.body : '';
      captured.push({
        url,
        body: raw ? (JSON.parse(raw) as Record<string, unknown>) : {},
      });
    }
    return origFetch(input, init);
  }) as typeof fetch;

  let restored = false;
  async function restore() {
    if (restored) return;
    const after = await deactivateAdminWhatsAppBranchOverride({
      branchId,
      userId,
      templateKey: KEY,
    });
    restored = true;
    console.log('restore', {
      effectiveSource: after.effectiveSource,
      markerGone: !after.effectiveContent.includes(MARKER),
    });
  }

  try {
    const overridden = await upsertAdminWhatsAppBranchOverride({
      branchId,
      userId,
      templateKey: KEY,
      language: 'ar',
      content: OVERRIDE_CONTENT,
    });
    console.log('override', {
      effectiveSource: overridden.effectiveSource,
      hasMarker: overridden.effectiveContent.includes(MARKER),
    });
    if (overridden.effectiveSource !== 'branch_db' || !overridden.effectiveContent.includes(MARKER)) {
      throw new Error('Branch override did not become effective');
    }

    const beforeSend = await getAdminWhatsAppTemplate(branchId, KEY);
    console.log('effectiveSource before send', beforeSend.effectiveSource);

    const saleInput = {
      phone,
      customerName: 'طارق',
      invoiceId: 40004,
      total: 350,
      paymentMethod: 'كاش',
      services: ['حلاقة شعر'],
      employeeNames: ['محمد'],
      branchName: String(branchRow.recordset[0]?.BranchName ?? 'جليم'),
      branchId,
    };
    const composed = await composeMessage({
      templateKey: KEY,
      variables: buildSaleCustomerReceiptData(saleInput),
      context: { channel: 'whatsapp', language: 'ar', branchId },
    });
    console.log('composed', {
      source: composed.source,
      hasMarker: composed.text.includes(MARKER),
      text: composed.text,
    });
    if (composed.source !== 'branch_db' || !composed.text.includes(MARKER)) {
      throw new Error('composeMessage did not return the ERP branch override');
    }

    console.log('calling sendSaleCustomerReceipt (generic path, no type)');
    const result = await sendSaleCustomerReceipt(saleInput);
    console.log('send result', result);

    if (captured.length !== 1) {
      throw new Error(`Expected 1 Gateway POST, got ${captured.length}`);
    }
    const gateway = captured[0]!;
    const keys = Object.keys(gateway.body).sort();
    console.log('gateway request', {
      url: gateway.url,
      keys,
      hasType: Object.prototype.hasOwnProperty.call(gateway.body, 'type'),
      body: redact(gateway.body),
    });
    if (Object.prototype.hasOwnProperty.call(gateway.body, 'type')) {
      throw new Error('Gateway payload unexpectedly includes type');
    }
    if (!('phone' in gateway.body) || !('message' in gateway.body) || !('metadata' in gateway.body)) {
      throw new Error('Gateway payload missing phone/message/metadata');
    }
    const metadata = gateway.body.metadata as Record<string, unknown>;
    if (
      metadata.source !== KEY ||
      metadata.templateKey !== KEY ||
      metadata.branchId !== branchId ||
      metadata.invoiceId !== 40004
    ) {
      throw new Error(`Unexpected metadata: ${JSON.stringify(redact(metadata))}`);
    }
    if (!String(gateway.body.message).includes(MARKER)) {
      throw new Error('Gateway message missing ERP marker');
    }
    if (!result.sent || !result.messageId) {
      throw new Error(`Send not confirmed sent+messageId: ${JSON.stringify(result)}`);
    }
    console.log('messageId', result.messageId);

    await restore();
    const after = await getAdminWhatsAppTemplate(branchId, KEY);
    console.log('effectiveSource after restore', after.effectiveSource);
    if (after.effectiveSource === 'branch_db' || after.effectiveContent.includes(MARKER)) {
      throw new Error('Restore did not return to global/default');
    }
    console.log('LIVE_VERTICAL_SLICE=VERIFIED');
  } catch (err) {
    console.error('E2E failed', err instanceof Error ? err.message : err);
    try {
      await restore();
    } catch (restoreErr) {
      console.error('restore failed', restoreErr instanceof Error ? restoreErr.message : restoreErr);
    }
    process.exitCode = 1;
  } finally {
    globalThis.fetch = origFetch;
    await closePool().catch(() => undefined);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
