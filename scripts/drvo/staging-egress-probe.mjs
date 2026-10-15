// Executed under the staging systemd unit network sandbox (ExecStartPre).
// It MUST be impossible to connect to a public IP. No application or DB writes.
import net from 'node:net';

function probe(host, port, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(timeoutMs, () => finish(false));
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
  });
}

if (process.env.DRVO_STAGING_MODE !== 'true' ||
    process.env.STAGING_SAFETY_ENFORCE !== 'true' ||
    process.env.STAGING_SAFETY_DB_NAME !== 'last132_agent' ||
    process.env.DRVO_STAGING_OUTBOUND_DISABLED !== 'true' ||
    process.env.DRVO_STAGING_WORKERS_DISABLED !== 'true' ||
    process.env.DRVO_STAGING_CRON_DISABLED !== 'true') {
  console.error('STAGING_EGRESS_PROBE_FAIL: required safety configuration missing');
  process.exit(1);
}
const dbHost = process.env.LOCAL_DB_SERVER ?? process.env.DB_SERVER;
const dbPort = Number(process.env.LOCAL_DB_PORT ?? process.env.DB_PORT ?? '1433');
if (!['127.0.0.1', 'localhost'].includes(dbHost) || dbPort !== 1433) {
  console.error('STAGING_EGRESS_PROBE_FAIL: expected local SQL endpoint only');
  process.exit(1);
}
const localSql = await probe('127.0.0.1', 1433);
const externalTcp = await probe('1.1.1.1', 443);
if (!localSql || externalTcp) {
  console.error('STAGING_EGRESS_PROBE_FAIL: SQL unavailable or outbound internet accessible');
  process.exit(1);
}
console.log('STAGING_EGRESS_PROBE_PASS: local SQL reachable, public TCP blocked');
