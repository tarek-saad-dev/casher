/**
 * Types for Today Sales Page
 * Comprehensive daily sales analysis with multiple views
 */

// ═══════════════════════════════════════════════════════════
// KPI SUMMARY
// ═══════════════════════════════════════════════════════════

export interface TodaySalesKPI {
  totalSales: number;
  invoiceCount: number;
  averageInvoice: number;
  customerCount: number;
  topShift: string | null;
  topPaymentMethod: string | null;
  topBarber: string | null;
  topService: string | null;
}

// ═══════════════════════════════════════════════════════════
// BY SHIFT
// ═══════════════════════════════════════════════════════════

export interface ShiftSales {
  shiftMoveId: number;
  shiftName: string;
  userName: string;
  totalSales: number;
  invoiceCount: number;
  averageInvoice: number;
  percentageOfTotal: number;
  topBarber: string | null;
  topPaymentMethod: string | null;
}

// ═══════════════════════════════════════════════════════════
// BY PAYMENT METHOD
// ═══════════════════════════════════════════════════════════

export interface PaymentMethodSales {
  paymentMethodId: number;
  paymentMethodName: string;
  totalAmount: number;
  invoiceCount: number;
  percentageOfTotal: number;
  averageTransaction: number;
}

// ═══════════════════════════════════════════════════════════
// BY BARBER
// ═══════════════════════════════════════════════════════════

export interface BarberSales {
  empId: number;
  empName: string;
  totalSales: number;
  serviceCount: number;
  invoiceContribution: number;
  averageSale: number;
  topService: string | null;
  percentageOfTotal: number;
}

// ═══════════════════════════════════════════════════════════
// BY SERVICE
// ═══════════════════════════════════════════════════════════

export interface ServiceSales {
  proId: number;
  proName: string;
  totalSales: number;
  quantitySold: number;
  timesSold: number;
  percentageOfTotal: number;
  averagePrice: number;
}

// ═══════════════════════════════════════════════════════════
// BY HOUR
// ═══════════════════════════════════════════════════════════

export interface HourlySales {
  hour: string; // "09:00-11:00" or "10" for single hour
  totalSales: number;
  invoiceCount: number;
  topPaymentMethod: string | null;
  topBarber: string | null;
  percentageOfTotal: number;
}

// ═══════════════════════════════════════════════════════════
// DETAILED TRANSACTIONS
// ═══════════════════════════════════════════════════════════

export interface TodaySaleTransaction {
  invId: number;
  invDate: string;
  invTime: string;
  clientName: string | null;
  barbers: string; // comma-separated
  services: string; // comma-separated
  totalAmount: number;
  paymentMethod: string;
  shiftName: string;
  userName: string;
  discount: number;
  isSplitPayment: boolean; // future use
}

// ═══════════════════════════════════════════════════════════
// API RESPONSE
// ═══════════════════════════════════════════════════════════

export interface TodaySalesData {
  date: string;
  kpi: TodaySalesKPI;
  byShift: ShiftSales[];
  byPaymentMethod: PaymentMethodSales[];
  byBarber: BarberSales[];
  byService: ServiceSales[];
  byHour: HourlySales[];
  transactions: TodaySaleTransaction[];
}

export interface TodaySalesFilters {
  date?: string; // YYYY-MM-DD
  shiftMoveId?: number;
  paymentMethodId?: number;
  empId?: number;
}
