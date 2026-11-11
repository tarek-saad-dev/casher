# CUT Salon — Multiple cashier devices and shared printers

**Status:** design for a future feature. Current implementation prints only through each browser PC's localhost Agent. This file is architecture, not a claim that remote printing is enabled.

## V1: install the Agent on each Windows PC that owns a physical XP-80

- Each Windows PC has a distinct local `http://127.0.0.1:7788`. A healthy Agent on another PC does **not** make the current PC healthy.
- Windows browsers cannot inspect Scheduled Tasks or install executables. If /health is unreachable, the UI reports **unknown (missing / stopped / blocked)**, not "not installed."
- Each PC with its own XP-80 can download `/downloads/Install-CUT-Print-Agent.ps1` from the Cashier website. The user must run it locally using Windows PowerShell.
- The installer checks `CUT Salon Print Agent` in the current user's Scheduled Tasks. If it exists, starts it when needed; if missing, checks locally installed printer + Node.js and copies official source files from the public CUT GitHub repo, installs npm deps and registers a user-login startup task.
- The task installer uses **no admin elevation**, no physical print test, and does not open TCP port 7788 beyond localhost. A physical test print remains a separate deliberate action.
- Windows prerequisites: the XP-80 must be installed and named `XP-80`, Node 22+ available, Internet connection for GitHub archive + npm, and permission to create the current user's scheduled task.
- Script is intentionally readable/plain PowerShell and served from a first-party URL. For wider distribution, sign and version a standalone Windows installer, pin the distribution artifacts using SHA-256, and keep a version/pairing inventory. Avoid long-term dependence on the moving `main` branch.
- If the PC has no physical printer, **do not install an Agent merely to print to another PC's printer**; implement the centralized print route below.

## Future: centrally routed print jobs, no raw TCP exposure

```
Cashier A ----(authenticated HTTPS)----\
Cashier B ----(authenticated HTTPS)-----+--> Cashier API / SQL Queue --> Worker poll (HTTPS) --> Printer PC Agent --> XP-80
Cashier C ----(authenticated HTTPS)----/            |                       ^
                                                 tenant/branch device registry
```

A branch can have several workstations, 1+ printers, and one default printer route. The printer host is simply the Windows device directly connected to XP-80. The worker on that PC regularly **polls the Cashier HTTPS API outbound**, so it works without an inbound LAN firewall rule, public IP, or open 7788 port.

### Proposed entities

`PrintDevices`: DeviceId, TenantId, BranchId, Nickname, HasPrinter, LastHeartbeatUtc, LastAgentVersion, Enabled, RevokedAt. Enrollment token stored encrypted / as server-side hash, scoped to branch and explicit printer capabilities.

`PrintQueues`: QueueId, TenantId, BranchId, Name, DefaultDeviceId, Status.

`PrintJobs`: JobId UUID, TenantId, BranchId, QueueId, IssuerUserId, InvoiceId/SourceRef, ReceiptType, ContentHash, RenderedPayloadRef or encrypted HTML, State (queued/leased/submitted/confirmed/failed/ambiguous/canceled), LeaseOwnerDeviceId, LeaseExpiresAt, Attempts, CreatedAt, ExpiresAt.

`PrintEvents`: append-only request, lease, Windows spool ACK, explicit physical check, cancellation and failure metadata. Never treat spool ACK as proof of paper.

### Trust boundary

- Only authenticated, branch-authorized Cashier sessions may create print jobs.
- Printer PC enrollment is explicit and approved by branch admin; each Agent has an independently revocable device credential and outbound HTTPS-only connection.
- A printer worker must receive jobs **only** for its bound tenant, branch, queue and device.
- Do **not** expose the existing localhost `/print/html` or `/settings` endpoint on 0.0.0.0. Never forward arbitrary HTML from untrusted users or unauthenticated workstations to a thermal printer.
- Render invoices on the trusted server from the authoritative sale and an immutable approved receipt-template version. Encrypt at rest if containing customer identifiers. Restrict diagnostic logs to non-sensitive IDs and purge job payload after short retention.
- TLS, replay protection, rate limits, job payload size/height limits (<=576x4800 pixels) and receipt type policies apply at job creation and final Agent spool.
- Deduplicate by JobId and requestId. On network timeout after submission, mark **ambiguous** and require user to check the printer before an intentional reprint. No automatic fallback to Chrome.
- Status states are distinct: queue accepted, device leased, Windows spool accepted, and human-confirmed paper printed. Device heartbeat indicates Agent process responsiveness, not printer hardware status.

### Delivery plan

1. **Now (implemented separately):** local Agent recovery + per-PC installer download, no remote print service.
2. **Phase A:** admin Devices screen, enrollment/rename/revoke, per-branch default printer queue, heartbeat; read-only device status and version.
3. **Phase B:** server-backed print job queue and outbound worker polling from printer host; at-most-once processing where practical, lease/ack/idempotency and retention.
4. **Phase C:** choose target printer from Cashier, test one queue job, audit logs and force/manual reprint confirmation.
5. **Phase D:** multiple printers per branch, offline buffering with expiry, failover routes (explicit manual choice, never silent double-print), dashboards and maintenance alerts.

**Acceptance:** Cashier A (without any locally connected printer) sends an invoice print job to Printer PC B, and B prints one paper without opening any inbound port or accidentally duplicating it; correct branch isolation and offline queue handling verified physically. Hardware, firmware and driver tests are prerequisites before production activation.
