# Phase 2.2 — Database Latency Diagnosis

## Topology summary

| Runtime | Host | DB path | Notes |
|---------|------|---------|-------|
| **Production Cashier** | VPS `/home/casher/app` (`casher.service`) | Should be `127.0.0.1:1433` | Same host as `mssql-server.service` |
| **Production inbox worker** | Same VPS (`messaging-inbox-worker.service`) | Same pool config as Cashier | Reads `.env.local` in app dir |
| **Production outbox worker** | Same VPS (`messaging-worker.service`) | Same pool config | |
| **Developer machine** | Windows | `127.0.0.1:14330` | SSH tunnel / forwarded port to remote SQL |

Historical VPS verification used `187.77.75.79:1433` (public IP on same host). That is **not** the optimal production path when SQL runs locally — it can add hairpin latency.

`127.0.0.1:14330` on a developer machine is **not** direct SQL. It is almost always a tunnel.

## Commands (run on the target runtime)

```bash
# 1) Topology (no secrets)
npm run messaging:diagnose-db-topology

# 2) Compare safe connection paths
npm run messaging:benchmark-db-paths

# 3) Singleton-pool SQL benchmark (same pool as app)
npm run messaging:benchmark-sql-latency

# 4) Full Phase 2.2 report (paths + SQL + messaging samples)
npm run messaging:phase22-benchmarks

# 5) On VPS only — inspect SQL listeners
bash scripts/vps-inspect-sql-listeners.sh
```

On production VPS, run as user `casher`:

```bash
cd /home/casher/app
npm run messaging:phase22-benchmarks | tee /tmp/phase22-benchmarks.json
```

## Recommended production `.env.local` (same-host SQL)

```env
HAWAI_DB_CLASS=local
DB_SERVER=127.0.0.1
DB_PORT=1433
LOCAL_DB_SERVER=127.0.0.1
LOCAL_DB_PORT=1433
DB_DATABASE=last132_migrated
LOCAL_DB_NAME=last132_migrated
DB_ENCRYPT=false
LOCAL_DB_ENCRYPT=false
DB_TRUST_SERVER_CERTIFICATE=true
LOCAL_DB_TRUST_CERT=true
```

After changing DB host, restart:

```bash
sudo systemctl restart casher
sudo systemctl restart messaging-worker.service
sudo systemctl restart messaging-inbox-worker.service
```

## Development (keep tunnel)

```env
HAWAI_DB_CLASS=local
LOCAL_DB_SERVER=127.0.0.1
LOCAL_DB_PORT=14330
DB_SERVER=127.0.0.1
DB_PORT=14330
```

Do **not** copy production loopback settings onto a machine that still needs an SSH tunnel.

## Decision gate

| SELECT 1 warm p50 | Conversation Ready p50 | Recommendation |
|-------------------|------------------------|----------------|
| < 10ms | < 300ms | READY_FOR_PHASE_3 |
| < 25ms | < 500ms | READY_WITH_KNOWN_LATENCY |
| > 50ms | > 800ms | NOT_READY_FOR_PHASE_3 |

Measure on the **production VPS runtime**, not through a developer tunnel.
