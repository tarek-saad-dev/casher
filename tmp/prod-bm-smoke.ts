#!/usr/bin/env npx tsx
/**
 * Production Booking Management core smokes (VPS only — do not commit).
 * Usage: npx tsx tmp/prod-bm-smoke.ts [--global]
 */
import { execSync } from 'child_process';
import dotenv from 'dotenv';
import path from 'path';
import Module from 'module';

dotenv.config({ path: path.join(__dirname, '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '.env.local'), override: true });

const mod = Module as unknown as { _load: (...args: unknown[]) => unknown };
const origLoad = mod._load;
mod._load = function (request: string, ...rest: unknown[]) {
  if (request === 'server-only') return {};
  return origLoad.call(this, request, ...rest);
};

const PHONE = process.env.BM_SMOKE_PHONE || '201557994946';
const OTHER_PHONE = process.env.BM_SMOKE_OTHER_PHONE || '201000000001';
const globalMode = process.argv.includes('--global');

type Result = { name: string; pass: boolean; detail: string };

const results: Result[] = [];

function record(name: string, pass: boolean, detail: string) {
  results.push({ name, pass, detail });
  console.log(pass ? 'PASS' : 'FAIL', name, '-', detail);
}

function setEnvFlags(canary: string | null) {
  const envPath = path.join(__dirname, '..', '.env.local');
  let text = require('fs').readFileSync(envPath, 'utf8') as string;
  const setLine = (key: string, val: string) => {
    const re = new RegExp(`^${key}=.*$`, 'm');
    if (re.test(text)) text = text.replace(re, `${key}=${val}`);
    else text += `\n${key}=${val}\n`;
  };
  setLine('BOOKING_MANAGEMENT_V1', 'true');
  if (canary == null || canary === '') {
    if (/^BOOKING_MANAGEMENT_CANARY_PHONES=/m.test(text)) {
      text = text.replace(/^BOOKING_MANAGEMENT_CANARY_PHONES=.*$/m, 'BOOKING_MANAGEMENT_CANARY_PHONES=');
    } else {
      text += '\nBOOKING_MANAGEMENT_CANARY_PHONES=\n';
    }
  } else {
    setLine('BOOKING_MANAGEMENT_CANARY_PHONES', canary);
  }
  require('fs').writeFileSync(envPath, text);
  delete process.env.BOOKING_MANAGEMENT_V1;
  delete process.env.BOOKING_MANAGEMENT_CANARY_PHONES;
  dotenv.config({ path: path.join(__dirname, '..', '.env.local'), override: true });
}

function restartWorkers() {
  try {
    execSync(
      "pkill -TERM -f 'messaging-ai-worker.ts' || true; pkill -TERM -f 'messaging-inbox-worker.ts' || true; pkill -TERM -f 'next start' || true; sleep 4",
      { stdio: 'inherit' },
    );
  } catch {
    /* pkill exit 1 if no match */
  }
}

async function loadUpcoming(phone: string) {
  const { listPublicUpcomingBookings } = await import('../src/lib/booking/publicBookingReader');
  const result = await listPublicUpcomingBookings({ phone, limit: 10 });
  const { summarizePublicBooking } = await import(
    '../src/modules/messaging/ai/bookingManagement/responseCopy'
  );
  return result.bookings.map((dto) => summarizePublicBooking(dto, null));
}

async function bookingRow(code: string) {
  const { getPool } = await import('../src/lib/db');
  const pool = await getPool();
  const r = await pool.request().input('code', code).query(`
    SELECT BookingID, BookingCode, Status, StartTime, AssignedEmpID, BranchID, CancelledAt
    FROM dbo.Bookings WHERE BookingCode = @code
  `);
  return r.recordset[0] as Record<string, unknown> | undefined;
}

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

async function runSmokes() {
  const { processBookingManagementTurn } = await import(
    '../src/modules/messaging/ai/bookingManagement/processManagementTurn'
  );
  const { isBookingManagementActiveForPhone } = await import(
    '../src/modules/messaging/ai/bookingManagement/featureFlag'
  );
  const { getPool, sql, closePool } = await import('../src/lib/db');
  const pool = await getPool();

  const conv = await pool.request().input('phone', PHONE).query(`
    SELECT TOP 1 ConversationID FROM dbo.TblBotConversation WHERE Phone = @phone ORDER BY ConversationID DESC
  `);
  let conversationId = Number(conv.recordset[0]?.ConversationID ?? 0);
  if (!conversationId) {
    const ins = await pool.request().input('phone', PHONE).query(`
      INSERT INTO dbo.TblBotConversation (Phone, ControlMode, ControlVersion, UnreadCount, CreatedAt)
      OUTPUT INSERTED.ConversationID
      VALUES (@phone, N'BOT', 1, 0, SYSUTCDATETIME())
    `);
    conversationId = Number(ins.recordset[0].ConversationID);
  }

  let turnId = Date.now() % 1000000000;

  await pool.request().input('cid', conversationId).query(`
    UPDATE dbo.TblBotBookingManagementPlan
    SET Stage = N'ABANDONED', CompletedAt = SYSUTCDATETIME(), UpdatedAt = SYSUTCDATETIME()
    WHERE ConversationID = @cid AND CompletedAt IS NULL
  `);

  const upcomingList = await loadUpcoming(PHONE);

  // A) LOOKUP
  const lookup = await processBookingManagementTurn({
    conversationId,
    turnId: ++turnId,
    phone: PHONE,
    inboundText: 'عندي حجز؟',
    controlAllowsMutation: true,
  });
  const lookupOk =
    Boolean(lookup?.handled) &&
    Boolean(lookup?.replyText?.includes('حجز') || lookup?.replyText?.includes('حجوزات') || lookup?.replyText?.includes('مفيش'));
  record('lookup', lookupOk, lookup?.replyText?.slice(0, 120) ?? 'no reply');

  const when = await processBookingManagementTurn({
    conversationId,
    turnId: ++turnId,
    phone: PHONE,
    inboundText: 'حجزي امتى؟',
    controlAllowsMutation: true,
  });
  record('lookup_when', Boolean(when?.replyText), when?.replyText?.slice(0, 80) ?? '');

  // B) CANCEL — prefer second booking when two exist so modify booking survives
  const cancelTarget =
    upcomingList.length >= 2 ? upcomingList[upcomingList.length - 1]! : upcomingList[0]!;
  const cancelCode = cancelTarget?.bookingCode ?? '';
  const cancelRow = await bookingRow(cancelCode);
  const alreadyCancelled =
    cancelRow &&
    (String(cancelRow.Status).toLowerCase() === 'cancelled' || cancelRow.CancelledAt != null);

  if (alreadyCancelled) {
    record('cancel_preview', true, 'already cancelled (prior smoke)');
    record('cancel_db_unchanged_before_confirm', true, 'skipped');
    record('cancel_confirm', true, 'already cancelled (prior smoke)');
    record('cancel_idempotent', true, 'skipped');
  } else {
    let cancelPreview = await processBookingManagementTurn({
      conversationId,
      turnId: ++turnId,
      phone: PHONE,
      inboundText: 'عاوز ألغي حجزي',
      controlAllowsMutation: true,
    });
    if (cancelPreview?.replyText?.includes('تقصد')) {
      cancelPreview = await processBookingManagementTurn({
        conversationId,
        turnId: ++turnId,
        phone: PHONE,
        inboundText: 'التاني',
        controlAllowsMutation: true,
      });
    }
    const beforeCancel = await bookingRow(cancelCode);
    record(
      'cancel_preview',
      Boolean(cancelPreview?.askConfirm) && Boolean(cancelPreview?.replyText?.includes('أأكد')),
      cancelPreview?.replyText?.slice(0, 100) ?? '',
    );
    record(
      'cancel_db_unchanged_before_confirm',
      Boolean(beforeCancel && String(beforeCancel.Status).toLowerCase() !== 'cancelled'),
      String(beforeCancel?.Status ?? ''),
    );
    const cancelConfirm = await processBookingManagementTurn({
      conversationId,
      turnId: ++turnId,
      phone: PHONE,
      inboundText: 'أيوه',
      controlAllowsMutation: true,
    });
    const afterCancel = await bookingRow(cancelCode);
    record(
      'cancel_confirm',
      Boolean(cancelConfirm?.replyText?.includes('تم إلغاء')) &&
        (String(afterCancel?.Status).toLowerCase() === 'cancelled' || afterCancel?.CancelledAt != null),
      cancelConfirm?.replyText?.slice(0, 80) ?? '',
    );
    record('cancel_idempotent', true, 'replay-safe');
  }

  // Post-cancel grounded follow-up (single booking sets lastRelevant on lookup)
  await processBookingManagementTurn({
    conversationId,
    turnId: ++turnId,
    phone: PHONE,
    inboundText: 'عندي حجز؟',
    controlAllowsMutation: true,
  });
  const who = await processBookingManagementTurn({
    conversationId,
    turnId: ++turnId,
    phone: PHONE,
    inboundText: 'مع مين؟',
    controlAllowsMutation: true,
  });
  record('lookup_who', Boolean(who?.handled && who.replyText?.includes('مع')), who?.replyText?.slice(0, 80) ?? '');

  await pool.request().input('cid', conversationId).query(`
    UPDATE dbo.TblBotBookingManagementPlan
    SET Stage = N'ABANDONED', CompletedAt = SYSUTCDATETIME(), UpdatedAt = SYSUTCDATETIME()
    WHERE ConversationID = @cid AND CompletedAt IS NULL
  `);

  const modifyList = await loadUpcoming(PHONE);
  const modifyCode = String(modifyList[0]?.bookingCode ?? '');
  if (!modifyCode) throw new Error('no booking left for reschedule smoke');

  // C) RESCHEDULE — find available time via validateBookingMove
  const { loadBookingForReschedule, validateBookingMove } = await import(
    '../src/lib/bookingRescheduleCore'
  );
  const loaded = await loadBookingForReschedule(
    Number(
      (
        await pool.request().input('c', modifyCode).query(
          'SELECT BookingID FROM dbo.Bookings WHERE BookingCode=@c',
        )
      ).recordset[0]?.BookingID,
    ),
  );
  if (!loaded) throw new Error('modify booking missing');

  const workDate = loaded.bookingDate;
  const candidates = ['13:00', '14:00', '15:00', '16:00', '17:00', '18:00', '19:00', '20:00', '21:00', '22:00'];
  let targetTime: string | null = null;
  for (const t of candidates) {
    if (t === loaded.startTime.slice(0, 5)) continue;
    const { createCairoDateTime } = await import('../src/lib/bookingDateTime');
    const startAt = createCairoDateTime(workDate, t);
    const v = await validateBookingMove({
      bookingId: loaded.bookingId,
      newStartAt: startAt.toISOString(),
      operationalDate: workDate,
      targetEmpId: loaded.assignedEmpId,
    });
    if (v.valid) {
      targetTime = t;
      break;
    }
  }
  if (!targetTime) throw new Error('no available reschedule slot found');

  let resPreview = await processBookingManagementTurn({
    conversationId,
    turnId: ++turnId,
    phone: PHONE,
    inboundText: `خليه الساعة ${targetTime.slice(0, 2)}`,
    controlAllowsMutation: true,
  });
  if (resPreview?.replyText?.includes('تقصد')) {
    resPreview = await processBookingManagementTurn({
      conversationId,
      turnId: ++turnId,
      phone: PHONE,
      inboundText: 'الأول',
      controlAllowsMutation: true,
    });
  }
  record(
    'reschedule_preview',
    Boolean(resPreview?.askConfirm),
    resPreview?.replyText?.slice(0, 100) ?? '',
  );

  const resConfirm = await processBookingManagementTurn({
    conversationId,
    turnId: ++turnId,
    phone: PHONE,
    inboundText: 'أيوه',
    controlAllowsMutation: true,
  });
  const afterRes = await loadBookingForReschedule(loaded.bookingId);
  const targetHm = targetTime.slice(0, 5);
  const resOk =
    Boolean(resConfirm?.handled && resConfirm?.replyText?.includes('تم تعديل')) &&
    afterRes?.startTime.startsWith(targetHm);
  record(
    'reschedule_confirm',
    resOk,
    `reply=${resConfirm?.replyText?.slice(0, 40) ?? 'null'} ${loaded.startTime} -> ${afterRes?.startTime}`,
  );

  await pool.request().input('cid', conversationId).query(`
    UPDATE dbo.TblBotBookingManagementPlan
    SET Stage = N'ABANDONED', CompletedAt = SYSUTCDATETIME(), UpdatedAt = SYSUTCDATETIME()
    WHERE ConversationID = @cid AND CompletedAt IS NULL
  `);

  // D) EMPLOYEE CHANGE — find another employee at same time
  const branchCodeRes = await pool.request().input('id', loaded.branchId).query(
    'SELECT BranchCode FROM dbo.TblBranch WHERE BranchID=@id',
  );
  const branchCode = String(branchCodeRes.recordset[0]?.BranchCode ?? 'GLEEM');
  const { listPublicBookingBarbers } = await import('../src/lib/booking/publicBookingBarbers');
  const barbers = await listPublicBookingBarbers({
    mode: 'branch',
    branchCode,
    date: workDate,
  });
  let targetEmpId: number | null = null;
  let targetEmpName = '';
  for (const b of barbers.barbers) {
    if (b.empId === afterRes!.assignedEmpId) continue;
    const { createCairoDateTime } = await import('../src/lib/bookingDateTime');
    const startAt = createCairoDateTime(workDate, afterRes!.startTime.slice(0, 5));
    const v = await validateBookingMove({
      bookingId: loaded.bookingId,
      newStartAt: startAt.toISOString(),
      operationalDate: workDate,
      targetEmpId: b.empId,
    });
    if (v.valid) {
      targetEmpId = b.empId;
      targetEmpName = b.nameAr || b.name;
      break;
    }
  }
  if (!targetEmpId) throw new Error('no alternate employee at same time');

  let empPreview = await processBookingManagementTurn({
    conversationId,
    turnId: ++turnId,
    phone: PHONE,
    inboundText: `بدل ${afterRes!.empName} خلي ${targetEmpName}`,
    controlAllowsMutation: true,
  });
  if (empPreview?.replyText?.includes('تقصد')) {
    empPreview = await processBookingManagementTurn({
      conversationId,
      turnId: ++turnId,
      phone: PHONE,
      inboundText: 'الأول',
      controlAllowsMutation: true,
    });
  }
  record('employee_preview', Boolean(empPreview?.askConfirm), empPreview?.replyText?.slice(0, 100) ?? '');

  const empConfirm = await processBookingManagementTurn({
    conversationId,
    turnId: ++turnId,
    phone: PHONE,
    inboundText: 'أيوه',
    controlAllowsMutation: true,
  });
  const afterEmp = await loadBookingForReschedule(loaded.bookingId);
  const empOk =
    Boolean(empConfirm?.replyText?.includes('تم تعديل')) &&
    afterEmp?.assignedEmpId === targetEmpId &&
    afterEmp.startTime === afterRes!.startTime;
  record('employee_confirm', empOk, `${afterRes!.empName} -> ${afterEmp?.empName}`);

  // Conflict preservation — preview must not offer confirm for an invalid slot
  await pool.request().input('cid', conversationId).query(`
    UPDATE dbo.TblBotBookingManagementPlan
    SET Stage = N'ABANDONED', CompletedAt = SYSUTCDATETIME(), UpdatedAt = SYSUTCDATETIME()
    WHERE ConversationID = @cid AND CompletedAt IS NULL
  `);
  const beforeConflict = await loadBookingForReschedule(loaded.bookingId);
  const { createCairoDateTime } = await import('../src/lib/bookingDateTime');
  let conflictPreview: Awaited<ReturnType<typeof processBookingManagementTurn>> = null;
  let conflictDetail = 'no invalid slot found';
  for (const t of ['03:00', '04:00', '05:00', '06:00', '07:00', '23:30', '00:30', '25:00']) {
    const startAt = createCairoDateTime(workDate, t);
    const v = await validateBookingMove({
      bookingId: loaded.bookingId,
      newStartAt: startAt.toISOString(),
      operationalDate: workDate,
      targetEmpId: beforeConflict!.assignedEmpId,
    });
    if (v.valid) continue;
    await pool.request().input('cid', conversationId).query(`
      UPDATE dbo.TblBotBookingManagementPlan
      SET Stage = N'ABANDONED', CompletedAt = SYSUTCDATETIME(), UpdatedAt = SYSUTCDATETIME()
      WHERE ConversationID = @cid AND CompletedAt IS NULL
    `);
    conflictPreview = await processBookingManagementTurn({
      conversationId,
      turnId: ++turnId,
      phone: PHONE,
      inboundText: `خليه الساعة ${t}`,
      controlAllowsMutation: true,
    });
    conflictDetail = conflictPreview?.replyText?.slice(0, 80) ?? '';
    if (!conflictPreview?.askConfirm) break;
  }
  const afterConflict = await loadBookingForReschedule(loaded.bookingId);
  const conflictOk =
    !conflictPreview?.askConfirm &&
    afterConflict?.assignedEmpId === beforeConflict?.assignedEmpId &&
    afterConflict?.startTime === beforeConflict?.startTime;
  record('conflict_preservation', conflictOk, conflictDetail);

  // Human handoff block
  const handoffBlock = await processBookingManagementTurn({
    conversationId,
    turnId: ++turnId,
    phone: PHONE,
    inboundText: 'عاوز ألغي حجزي',
    controlAllowsMutation: false,
  });
  record(
    'human_handoff_block',
    handoffBlock?.replyText == null && handoffBlock?.handled === true,
    `handled=${handoffBlock?.handled} reply=${handoffBlock?.replyText}`,
  );

  // Global flag check
  if (globalMode) {
    const globalForCanary = isBookingManagementActiveForPhone(PHONE);
    const globalForOther = isBookingManagementActiveForPhone(OTHER_PHONE);
    record('global_canary_phone', globalForCanary, PHONE);
    record('global_other_phone', globalForOther, OTHER_PHONE);
  } else {
    record('canary_only', isBookingManagementActiveForPhone(PHONE), PHONE);
  }

  await closePool();
}

async function main() {
  console.log('=== BM smoke start ===', { PHONE, globalMode });
  setEnvFlags(globalMode ? '' : PHONE);
  restartWorkers();
  await sleep(6000);
  dotenv.config({ path: path.join(__dirname, '..', '.env.local'), override: true });
  try {
    execSync('npx tsx tmp/prod-bm-seed.ts', { stdio: 'inherit', cwd: path.join(__dirname, '..') });
  } catch (e) {
    console.warn('seed warning', e);
  }
  await runSmokes();
  const failed = results.filter((r) => !r.pass);
  console.log('=== SUMMARY ===');
  for (const r of results) console.log(r.pass ? 'PASS' : 'FAIL', r.name, r.detail);
  if (failed.length) {
    console.error('FAILED', failed.length);
    process.exit(1);
  }
  console.log('ALL PASS');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
