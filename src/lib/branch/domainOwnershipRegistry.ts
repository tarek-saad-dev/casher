/**
 * Phase 1I — Central domain ownership registry (verification metadata only).
 * Not used as runtime authorization. Compared by verify-multibranch-boundaries.
 */
export type OwnershipClassification =
  | 'GLOBAL_MASTER'
  | 'BRANCH_OWNED_ROOT'
  | 'CHILD_INHERIT'
  | 'EMPLOYEE_GLOBAL_CONFLICT'
  | 'HYBRID_GLOBAL_IDENTITY_BRANCH_ACTIVITY'
  | 'CONSOLIDATED_READ'
  | 'DEVICE_OR_DEPLOYMENT_LOCAL'
  | 'INACTIVE_LEGACY'
  | 'DEFERRED_REQUIRES_BUSINESS_DECISION';

export type DomainOwnershipEntry = {
  domain: string;
  classification: OwnershipClassification;
  roots: string[];
  masters: string[];
  children?: string[];
  branchRequiredOnWrite: boolean;
  consolidatedReadAllowed: boolean;
  goLiveBlocker?: boolean;
  notes: string;
};

export const DOMAIN_OWNERSHIP_REGISTRY: DomainOwnershipEntry[] = [
  {
    domain: 'branches',
    classification: 'GLOBAL_MASTER',
    roots: ['TblBranch'],
    masters: ['TblBranch'],
    branchRequiredOnWrite: false,
    consolidatedReadAllowed: true,
    notes: 'Branch registry; GLEEM founding seed by BranchCode only',
  },
  {
    domain: 'users_roles',
    classification: 'HYBRID_GLOBAL_IDENTITY_BRANCH_ACTIVITY',
    roots: ['TblUserBranchAccess'],
    masters: ['TblUser'],
    branchRequiredOnWrite: true,
    consolidatedReadAllowed: false,
    notes: 'User identity global; CanOperate access per branch',
  },
  {
    domain: 'employees',
    classification: 'HYBRID_GLOBAL_IDENTITY_BRANCH_ACTIVITY',
    roots: ['TblEmpBranchAssignment'],
    masters: ['TblEmp'],
    branchRequiredOnWrite: true,
    consolidatedReadAllowed: true,
    notes: 'Employee identity global; assignment = branch eligibility',
  },
  {
    domain: 'employee_schedule_conflicts',
    classification: 'EMPLOYEE_GLOBAL_CONFLICT',
    roots: ['Bookings', 'QueueTickets'],
    masters: ['TblEmp'],
    branchRequiredOnWrite: true,
    consolidatedReadAllowed: false,
    notes: 'Overlap/busy intervals intentionally global across branches',
  },
  {
    domain: 'clients',
    classification: 'GLOBAL_MASTER',
    roots: ['TblClient'],
    masters: ['TblClient'],
    branchRequiredOnWrite: false,
    consolidatedReadAllowed: true,
    notes: 'Global phone identity; operational history filtered by transaction branch',
  },
  {
    domain: 'loyalty',
    classification: 'HYBRID_GLOBAL_IDENTITY_BRANCH_ACTIVITY',
    roots: ['TblLoyaltyPointLedger'],
    masters: ['TblClientLoyalty', 'TblClient'],
    branchRequiredOnWrite: false,
    consolidatedReadAllowed: true,
    goLiveBlocker: false,
    notes:
      'Balance global; earn/redeem source branch attribution preferred but not enforced as blocker yet',
  },
  {
    domain: 'catalog_services_products',
    classification: 'GLOBAL_MASTER',
    roots: ['TblPro', 'TblCat', 'TblBarCode'],
    masters: ['TblPro', 'TblCat'],
    branchRequiredOnWrite: false,
    consolidatedReadAllowed: true,
    notes: 'Catalog identity/price global until business chooses overrides',
  },
  {
    domain: 'inventory_stock',
    classification: 'HYBRID_GLOBAL_IDENTITY_BRANCH_ACTIVITY',
    roots: ['TblBranchInventory', 'TblInventoryMovement'],
    masters: ['TblPro'],
    branchRequiredOnWrite: true,
    consolidatedReadAllowed: true,
    goLiveBlocker: false,
    notes:
      'Phase 1J: TblPro catalog global; QtyOnHand branch-owned; TblPro.Qty deprecated snapshot',
  },
  {
    domain: 'purchases',
    classification: 'BRANCH_OWNED_ROOT',
    roots: ['TblinvPurchaseHead'],
    masters: ['TblPro'],
    children: ['TblinvPurchaseDetail', 'TblinvRePurchase'],
    branchRequiredOnWrite: true,
    consolidatedReadAllowed: true,
    goLiveBlocker: false,
    notes: 'Phase 1J: purchase BranchID NOT NULL; details CHILD_INHERIT; stock on POST only',
  },
  {
    domain: 'business_day',
    classification: 'BRANCH_OWNED_ROOT',
    roots: ['TblNewDay'],
    masters: [],
    branchRequiredOnWrite: true,
    consolidatedReadAllowed: false,
    notes: 'Independent open day per branch',
  },
  {
    domain: 'shift_instance',
    classification: 'BRANCH_OWNED_ROOT',
    roots: ['TblShiftMove'],
    masters: ['TblShift'],
    branchRequiredOnWrite: true,
    consolidatedReadAllowed: false,
    notes: 'Shift definition global; instance branch-owned; one open shift per user globally',
  },
  {
    domain: 'sales_invoice',
    classification: 'BRANCH_OWNED_ROOT',
    roots: ['TblinvServHead'],
    masters: [],
    children: ['TblinvServDetail', 'TblinvServPayment'],
    branchRequiredOnWrite: true,
    consolidatedReadAllowed: true,
    notes: 'Ownership immutable from session day/shift',
  },
  {
    domain: 'cash_move',
    classification: 'BRANCH_OWNED_ROOT',
    roots: ['TblCashMove'],
    masters: [],
    branchRequiredOnWrite: true,
    consolidatedReadAllowed: true,
    notes: 'Treasury hub per branch',
  },
  {
    domain: 'treasury_recon',
    classification: 'BRANCH_OWNED_ROOT',
    roots: ['TblTreasuryCloseRecon'],
    masters: [],
    branchRequiredOnWrite: true,
    consolidatedReadAllowed: true,
    notes: 'Per-branch close reconciliation',
  },
  {
    domain: 'bookings',
    classification: 'BRANCH_OWNED_ROOT',
    roots: ['Bookings'],
    masters: [],
    children: ['BookingServices'],
    branchRequiredOnWrite: true,
    consolidatedReadAllowed: false,
    notes: 'BookingCode remains GLOBAL_UNIQUE; board filtered by BranchID',
  },
  {
    domain: 'queue',
    classification: 'BRANCH_OWNED_ROOT',
    roots: ['QueueTickets', 'QueueBookingSettings'],
    masters: [],
    children: ['QueueTicketServices', 'QueueTicketHistory'],
    branchRequiredOnWrite: true,
    consolidatedReadAllowed: false,
    notes: 'TicketCode unique per BranchID+date',
  },
  {
    domain: 'attendance',
    classification: 'BRANCH_OWNED_ROOT',
    roots: ['TblEmpAttendance'],
    masters: ['TblEmp'],
    children: ['TblEmpAttendanceBreak', 'TblEmpAttendanceBreakTime'],
    branchRequiredOnWrite: true,
    consolidatedReadAllowed: true,
    goLiveBlocker: false,
    notes:
      'Phase 1K: BranchID NOT NULL; unique Branch+Emp+WorkDate; open-session conflict employee-global; payroll still employee/date aggregate until 1L',
  },
  {
    domain: 'payroll_ledger_targets',
    classification: 'DEFERRED_REQUIRES_BUSINESS_DECISION',
    roots: ['TblEmpPayroll', 'TblEmpLedgerEntry', 'TblEmpTarget'],
    masters: ['TblEmp'],
    branchRequiredOnWrite: false,
    consolidatedReadAllowed: true,
    goLiveBlocker: true,
    notes: 'Cost attribution / source branch undecided — no speculative redesign in 1I',
  },
  {
    domain: 'budgets',
    classification: 'DEFERRED_REQUIRES_BUSINESS_DECISION',
    roots: ['TblBudget'],
    masters: [],
    branchRequiredOnWrite: true,
    consolidatedReadAllowed: true,
    goLiveBlocker: false,
    notes: 'TblBudget absent on last132; defer until budget feature reactivated',
  },
  {
    domain: 'offers',
    classification: 'DEFERRED_REQUIRES_BUSINESS_DECISION',
    roots: [],
    masters: [],
    branchRequiredOnWrite: true,
    consolidatedReadAllowed: false,
    goLiveBlocker: false,
    notes: 'No TblOffers on last132 — classify GLOBAL_ALL_BRANCHES vs SELECTED before activation',
  },
  {
    domain: 'printers',
    classification: 'DEVICE_OR_DEPLOYMENT_LOCAL',
    roots: ['TblPrinter', 'TblPrintSetting'],
    masters: [],
    branchRequiredOnWrite: false,
    consolidatedReadAllowed: false,
    notes: 'Local print agent 127.0.0.1:7788; receipt data must be active-branch owned',
  },
  {
    domain: 'settings',
    classification: 'HYBRID_GLOBAL_IDENTITY_BRANCH_ACTIVITY',
    roots: ['TblSettingValues', 'QueueBookingSettings'],
    masters: ['TblSettings'],
    branchRequiredOnWrite: true,
    consolidatedReadAllowed: false,
    notes: 'No silent GLEEM settings fallback for missing branch settings',
  },
  {
    domain: 'calendar_sync',
    classification: 'INACTIVE_LEGACY',
    roots: ['TblCalendarSync', 'TblCalendarOutboundSync'],
    masters: [],
    branchRequiredOnWrite: false,
    consolidatedReadAllowed: false,
    notes: 'Sync/calendar remain stopped; must not write branch-less bookings',
  },
  {
    domain: 'partner_shares',
    classification: 'BRANCH_OWNED_ROOT',
    roots: ['TblBranchPartnerShare'],
    masters: [],
    branchRequiredOnWrite: true,
    consolidatedReadAllowed: true,
    notes: 'Per-branch periods; consolidate after branch calc',
  },
  {
    domain: 'reports',
    classification: 'CONSOLIDATED_READ',
    roots: [],
    masters: [],
    branchRequiredOnWrite: false,
    consolidatedReadAllowed: true,
    notes: 'ACTIVE_BRANCH or authorized multi-branch; never unscoped financial joins',
  },
];

export const BRANCH_OWNED_ROUTE_MARKERS = [
  { path: 'src/app/api/operations/status/route.ts', mustContain: 'requireActiveBranchContext' },
  { path: 'src/app/api/day/rollover-check/route.ts', mustContain: 'requireActiveBranchContext' },
  { path: 'src/app/api/day/history/route.ts', mustContain: 'BranchID = @branchId' },
  { path: 'src/app/api/day/summary/route.ts', mustContain: 'validateBusinessDayBelongsToBranch' },
  { path: 'src/app/api/shift/route.ts', mustContain: 'getUserOpenShiftForBranch' },
  { path: 'src/app/api/shift/history/route.ts', mustContain: 'BranchID = @branchId' },
  { path: 'src/app/api/shift/summary/route.ts', mustContain: 'validateShiftBelongsToBranch' },
  { path: 'src/app/api/shifts/current/route.ts', mustContain: 'BranchID = @branchId' },
  { path: 'src/app/api/business-days/route.ts', mustContain: 'BranchID = @branchId' },
  { path: 'src/app/api/sales/today/route.ts', mustContain: 'BranchID = @branchId' },
  { path: 'src/app/api/queue/settings/route.ts', mustContain: 'WHERE BranchID = @branchId' },
  { path: 'src/app/api/treasury/current/route.ts', mustContain: 'BranchID = @branchId' },
] as const;

export const GO_LIVE_BLOCKER_DOMAINS = DOMAIN_OWNERSHIP_REGISTRY.filter((d) => d.goLiveBlocker).map(
  (d) => d.domain,
);
