#!/usr/bin/env npx tsx
/**
 * Production Human Handoff hardening smoke (VPS only).
 */
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(__dirname, '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '.env.local'), override: true });

const PHONE = process.env.HANDOFF_SMOKE_PHONE || '201557994946';

type Result = { name: string; pass: boolean; detail: string };
const results: Result[] = [];
function record(name: string, pass: boolean, detail: string) {
  results.push({ name, pass, detail });
  console.log(pass ? 'PASS' : 'FAIL', name, '-', detail);
}

async function main() {
  const { isHumanHandoffV1Enabled, isHumanHandoffActiveForPhone, getHumanHandoffLeaseMinutes } =
    await import('../src/modules/messaging/handoff/featureFlag');
  const { observeManualOutbound } = await import(
    '../src/modules/messaging/handoff/application/observeManualOutbound'
  );
  const { evaluateOutboxSendGate } = await import(
    '../src/modules/messaging/handoff/application/outboxSendGate'
  );
  const { returnToBotAndMaybeResume } = await import(
    '../src/modules/messaging/handoff/application/reconcileExpiredLeases'
  );
  const { getConversationControl } = await import(
    '../src/modules/messaging/handoff/infra/conversationControlRepository'
  );
  const { getPool, closePool } = await import('../src/lib/db');

  record('global_flag', isHumanHandoffV1Enabled(), `V1=${isHumanHandoffV1Enabled()}`);
  record('global_phone', isHumanHandoffActiveForPhone(PHONE), PHONE);
  record('lease_minutes', getHumanHandoffLeaseMinutes() === 15, String(getHumanHandoffLeaseMinutes()));

  const pool = await getPool();
  const conv = await pool.request().input('phone', PHONE).query(`
    SELECT TOP 1 ConversationID FROM dbo.TblBotConversation WHERE Phone = @phone ORDER BY ConversationID DESC
  `);
  const conversationId = Number(conv.recordset[0]?.ConversationID ?? 0);
  if (!conversationId) throw new Error('no conversation for smoke phone');

  // Reset to BOT for controlled smoke
  await pool.request().input('cid', conversationId).query(`
    UPDATE dbo.TblBotConversation
    SET ControlMode = N'BOT', ControlVersion = ControlVersion + 1,
        HumanLeaseUntil = NULL, HumanLastActivityAt = NULL,
        TakeoverSource = NULL, TakenOverByUserId = NULL, UpdatedAt = SYSUTCDATETIME()
    WHERE ConversationID = @cid
  `);

  const botBefore = await getConversationControl(conversationId);
  record('reset_bot', botBefore?.mode === 'BOT', String(botBefore?.mode));

  const pmid = `smoke-manual-${Date.now()}`;
  const observed = await observeManualOutbound({
    providerMessageId: pmid,
    phone: PHONE,
    text: 'مساء الخير يا فندم، مع حضرتك من فريق CUT.',
    occurredAt: new Date(),
  });
  const afterManual = await getConversationControl(conversationId);
  record(
    'manual_takeover',
    observed.classified === 'WHATSAPP_MANUAL' &&
      afterManual?.mode === 'HUMAN' &&
      afterManual?.takeoverSource === 'WHATSAPP_MANUAL',
    `${observed.classified} mode=${afterManual?.mode} src=${afterManual?.takeoverSource}`,
  );

  const leaseMs =
    afterManual?.humanLeaseUntil != null
      ? new Date(afterManual.humanLeaseUntil).getTime() - Date.now()
      : 0;
  record('lease_15m', leaseMs > 14 * 60_000 && leaseMs <= 16 * 60_000, `${Math.round(leaseMs / 60000)}m`);

  const dup = await observeManualOutbound({
    providerMessageId: pmid,
    phone: PHONE,
    text: 'مساء الخير يا فندم، مع حضرتك من فريق CUT.',
  });
  const afterDup = await getConversationControl(conversationId);
  record(
    'duplicate_no_version_bump',
    dup.duplicate && afterDup?.controlVersion === afterManual?.controlVersion,
    `dup=${dup.duplicate} v=${afterDup?.controlVersion}`,
  );

  const gate = await evaluateOutboxSendGate({
    id: 999999,
    channel: 'whatsapp',
    recipient: PHONE,
    templateKey: '',
    content: 'stale bot',
    metadataJson: JSON.stringify({
      source: 'ai-receptionist',
      origin: 'BOT',
      conversationId,
      expectedControlVersion: botBefore?.controlVersion ?? 1,
    }),
    status: 'pending',
    attemptCount: 0,
    maxAttempts: 5,
    nextAttemptAt: null,
    lockedAt: null,
    lockedBy: null,
    providerMessageId: null,
    lastError: null,
    branchId: null,
    createdByUserId: null,
    createdAt: new Date().toISOString(),
    updatedAt: null,
    sentAt: null,
    failedAt: null,
    idempotencyKey: 'smoke-stale',
  });
  record('provider_send_gate', !gate.allow, gate.allow ? 'allowed' : gate.reason);

  const returned = await returnToBotAndMaybeResume({
    conversationId,
    actorUserId: 1,
    reason: 'erp_return',
  });
  const afterReturn = await getConversationControl(conversationId);
  record(
    'erp_return',
    returned.returned && afterReturn?.mode === 'BOT',
    String(afterReturn?.mode),
  );

  await closePool();
  const failed = results.filter((r) => !r.pass);
  console.log('=== SUMMARY ===');
  for (const r of results) console.log(r.pass ? 'PASS' : 'FAIL', r.name, r.detail);
  if (failed.length) process.exit(1);
  console.log('ALL PASS');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
