export interface RecentInvoiceItem {
  InvID: number;
  InvNo: number;
  InvDate: string;
  InvTime?: string | null;
  TotalPrice: number;
  PaidAmount: number;
  RemainingAmount: number;
  Discount: number;
  PaymentMethodID: number;
  PaymentMethodName: string;
  IsSplitPayment: boolean;
  ClientID: number | null;
  ClientName: string | null;
  Phone: string | null;
  EmpID: number | null;
  EmpName: string | null;
  EmployeeNames: string | null;
  ServiceCount: number;
  ServicesSummary: string | null;
}

export interface RecentInvoicesResponse {
  items: RecentInvoiceItem[];
  nextCursor: number | null;
  hasMore: boolean;
  total: number;
}

export type RecentInvoiceStatusFilter = 'complete' | 'incomplete';

export type RecentInvoiceDatePreset =
  | 'today'
  | 'yesterday'
  | 'last7'
  | 'thisMonth'
  | 'custom';

export interface RecentInvoicesQueryParams {
  q?: string;
  paymentMethodIds?: number[];
  employeeIds?: number[];
  dateFrom?: string;
  dateTo?: string;
  minAmount?: number;
  maxAmount?: number;
  status?: RecentInvoiceStatusFilter;
  limit?: number;
  cursor?: number;
  /**
   * Client-known active branch id (from session/`/api/branches/active`), used only to key the
   * client-side response cache per branch. The server independently re-validates and filters by
   * the session's active branch — this value is never trusted for filtering.
   */
  branchId?: number;
}

export interface RecentInvoicesFilterState {
  invoiceSearchQuery: string;
  selectedPaymentMethodIds: number[];
  selectedEmployeeIds: number[];
  selectedDatePreset: RecentInvoiceDatePreset | null;
  customDateFrom: string;
  customDateTo: string;
  minAmount: string;
  maxAmount: string;
  selectedStatus: RecentInvoiceStatusFilter | null;
}

export const DEFAULT_RECENT_INVOICES_FILTERS: RecentInvoicesFilterState = {
  invoiceSearchQuery: '',
  selectedPaymentMethodIds: [],
  selectedEmployeeIds: [],
  selectedDatePreset: null,
  customDateFrom: '',
  customDateTo: '',
  minAmount: '',
  maxAmount: '',
  selectedStatus: null,
};

export const RECENT_INVOICES_DEFAULT_LIMIT = 20;
export const RECENT_INVOICES_MAX_LIMIT = 50;
export const RECENT_INVOICES_MAX_QUERY_LENGTH = 80;
