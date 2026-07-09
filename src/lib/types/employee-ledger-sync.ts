export interface EmployeeLedgerSyncPreviewRow {
  source: 'payroll' | 'advance';
  refId: number;
  empId: number;
  empName: string | null;
  entryDate: string;
  amount: number;
  action: 'insert' | 'update' | 'void' | 'skip';
  reason: string;
}

export interface EmployeeLedgerSyncCounts {
  payrollCreditsToInsert: number;
  payrollCreditsToUpdate: number;
  payrollCreditsToVoid: number;
  advanceDebitsToInsert: number;
  advanceDebitsToUpdate: number;
  skipped: number;
  errors: number;
}

export interface EmployeeLedgerSyncResponse {
  success: boolean;
  dryRun: boolean;
  month: string;
  empId: number | null;
  syncPayrollCredits: boolean;
  syncAdvanceDebits: boolean;
  counts: EmployeeLedgerSyncCounts;
  previewRows: EmployeeLedgerSyncPreviewRow[];
  errors: string[];
}
