/**
 * WhatsApp Integration — Payload Builders
 *
 * Constructs typed payloads from POS domain objects.
 * All builders are pure functions — no DB calls.
 */

import { getConfig } from './config';
import type {
  SaleWhatsAppPayload,
  BookingWhatsAppPayload,
  FirstTimeWhatsAppPayload,
  EmployeeSaleWhatsAppPayload,
  EmployeeAdvanceWhatsAppPayload,
  EmployeeFundingWhatsAppPayload,
  QuickMessageWhatsAppPayload,
  EmployeeDailyReportWhatsAppPayload,
  OtherWhatsAppPayload,
} from './types';

export interface SalePayloadInput {
  phone: string;
  customerName: string;
  invID: number;
  total: number;
  paymentMethod?: string;
  services?: string[];
  employeeNames?: string[];
  branchName?: string;
}

export interface BookingPayloadInput {
  phone: string;
  customerName: string;
  bookingId?: number | string;
  bookingDate: string;
  bookingTime: string;
  barberName?: string;
  services?: string[];
  branchName?: string;
  bookingLink?: string;
}

export interface FirstTimePayloadInput {
  phone: string;
  customerName: string;
  branchName?: string;
  bookingLink?: string;
}

export interface EmployeeSalePayloadInput {
  phone: string;
  employeeName: string;
  invID: number;
  services: string[];
  branchName?: string;
  customerName?: string;
  employeeId?: number;
  employeeTotal?: number;
  invoiceTotal?: number;
  message?: string;
  serviceDetails?: Array<{
    detailId?: number;
    proId: number;
    serviceName: string;
    grossAmount: number;
    discountValue: number;
    netAmount: number;
  }>;
}

export interface EmployeeAdvancePayloadInput {
  phone: string;
  employeeName: string;
  invID: number;
  amount: number;
  paymentMethod?: string;
  notes?: string;
  branchName?: string;
}

export interface EmployeeFundingPayloadInput {
  phone: string;
  employeeName: string;
  invID: number;
  amount: number;
  paymentMethod?: string;
  notes?: string;
  branchName?: string;
}

export interface QuickMessagePayloadInput {
  phone: string;
  customerName?: string;
  message?: string;
  branchName?: string;
}

export interface EmployeeDailyReportPayloadInput {
  phone: string;
  employeeName: string;
  message: string;
  workDate: string;
  ledgerBalance: number;
  branchName?: string;
  checkIn?: string | null;
  checkOut?: string | null;
  actualHours?: number | null;
  scheduledHours?: number | null;
  statusLabelAr?: string | null;
  lateMinutes?: number | null;
  baseWage?: number | null;
  fullDayBase?: number | null;
  isPartialDay?: boolean;
  baseWageNoteAr?: string | null;
  targetSales?: number | null;
  targetAmount?: number | null;
  deductions?: number | null;
  advances?: number | null;
  dayNet?: number | null;
  payrollMonth?: string;
}

export interface OtherPayloadInput {
  phone: string;
  customerName: string;
  message: string;
  branchName?: string;
}

export function buildSalePayload(input: SalePayloadInput): SaleWhatsAppPayload {
  const cfg = getConfig();

  const uniqueEmployees = input.employeeNames
    ? [...new Set(input.employeeNames.filter(Boolean))]
    : undefined;

  const employeeName =
    uniqueEmployees && uniqueEmployees.length > 0
      ? uniqueEmployees.join(' / ')
      : undefined;

  return {
    type: 'sale',
    phone: input.phone.trim(),
    customerName: input.customerName.trim(),
    invoiceNumber: `INV-${input.invID}`,
    total: input.total,
    paymentMethod: input.paymentMethod,
    branchName: input.branchName ?? cfg.defaultBranchName,
    employeeName,
    services: input.services && input.services.length > 0 ? input.services : undefined,
  };
}

export function buildBookingPayload(input: BookingPayloadInput): BookingWhatsAppPayload {
  const cfg = getConfig();

  return {
    type: 'booking',
    phone: input.phone.trim(),
    customerName: input.customerName.trim(),
    bookingId: input.bookingId !== undefined ? `BK-${input.bookingId}` : undefined,
    bookingDate: input.bookingDate,
    bookingTime: input.bookingTime,
    branchName: input.branchName ?? cfg.defaultBranchName,
    barberName: input.barberName,
    services: input.services && input.services.length > 0 ? input.services : undefined,
    bookingLink: input.bookingLink ?? cfg.defaultBookingLink,
  };
}

export function buildFirstTimePayload(input: FirstTimePayloadInput): FirstTimeWhatsAppPayload {
  const cfg = getConfig();

  return {
    type: 'first_time',
    phone: input.phone.trim(),
    customerName: input.customerName.trim(),
    branchName: input.branchName ?? cfg.defaultBranchName,
    bookingLink: input.bookingLink ?? cfg.defaultBookingLink,
  };
}

export function buildEmployeeSalePayload(
  input: EmployeeSalePayloadInput,
): EmployeeSaleWhatsAppPayload {
  const cfg = getConfig();
  const services = input.services.filter(Boolean);
  const clientName = input.customerName?.trim() || undefined;

  return {
    type: 'employee_sale',
    phone: input.phone.trim(),
    // Bot templates historically use customerName as the employee display name.
    customerName: input.employeeName.trim(),
    employeeName: input.employeeName.trim(),
    clientName,
    invoiceNumber: `INV-${input.invID}`,
    invoiceId: input.invID,
    employeeId: input.employeeId,
    employeeTotal: input.employeeTotal,
    invoiceTotal: input.invoiceTotal,
    branchName: input.branchName ?? cfg.defaultBranchName,
    services: services.length > 0 ? services : undefined,
    message: input.message?.trim() || undefined,
    serviceDetails: input.serviceDetails?.map((s) => ({
      detailId: s.detailId,
      proId: s.proId,
      name: s.serviceName,
      grossAmount: s.grossAmount,
      discountValue: s.discountValue,
      netAmount: s.netAmount,
    })),
  };
}

export function resolvePhone(
  mobile: string | null | undefined,
  phone: string | null | undefined,
): string | null {
  return mobile?.trim() || phone?.trim() || null;
}

export function buildEmployeeAdvancePayload(
  input: EmployeeAdvancePayloadInput,
): EmployeeAdvanceWhatsAppPayload {
  const cfg = getConfig();

  return {
    type: 'employee_advance',
    phone: input.phone.trim(),
    customerName: input.employeeName.trim(),
    invoiceNumber: `ADV-${input.invID}`,
    amount: input.amount,
    paymentMethod: input.paymentMethod,
    branchName: input.branchName ?? cfg.defaultBranchName,
    notes: input.notes?.trim() || undefined,
  };
}

export function buildEmployeeFundingPayload(
  input: EmployeeFundingPayloadInput,
): EmployeeFundingWhatsAppPayload {
  const cfg = getConfig();

  return {
    type: 'employee_funding',
    phone: input.phone.trim(),
    customerName: input.employeeName.trim(),
    invoiceNumber: `FUND-${input.invID}`,
    amount: input.amount,
    paymentMethod: input.paymentMethod,
    branchName: input.branchName ?? cfg.defaultBranchName,
    notes: input.notes?.trim() || undefined,
  };
}

export function resolveEmployeeWhatsAppPhone(
  whatsApp: string | null | undefined,
  mobile: string | null | undefined,
): string | null {
  return whatsApp?.trim() || mobile?.trim() || null;
}

export function buildQuickMessagePayload(
  input: QuickMessagePayloadInput,
): QuickMessageWhatsAppPayload {
  const cfg = getConfig();
  const message = (input.message ?? cfg.defaultQuickMessage).trim();

  return {
    type: 'quick_message',
    phone: input.phone.trim(),
    customerName: (input.customerName ?? 'عميل').trim() || 'عميل',
    message,
    branchName: input.branchName ?? cfg.defaultBranchName,
  };
}

export function buildEmployeeDailyReportPayload(
  input: EmployeeDailyReportPayloadInput,
): EmployeeDailyReportWhatsAppPayload {
  const cfg = getConfig();

  return {
    type: 'employee_daily_report',
    phone: input.phone.trim(),
    customerName: input.employeeName.trim(),
    message: input.message.trim(),
    branchName: input.branchName ?? cfg.defaultBranchName,
    workDate: input.workDate,
    employeeName: input.employeeName.trim(),
    checkIn: input.checkIn ?? null,
    checkOut: input.checkOut ?? null,
    actualHours: input.actualHours ?? null,
    scheduledHours: input.scheduledHours ?? null,
    statusLabelAr: input.statusLabelAr ?? null,
    lateMinutes: input.lateMinutes ?? null,
    baseWage: input.baseWage ?? null,
    fullDayBase: input.fullDayBase ?? null,
    isPartialDay: input.isPartialDay ?? false,
    baseWageNoteAr: input.baseWageNoteAr ?? null,
    targetSales: input.targetSales ?? null,
    targetAmount: input.targetAmount ?? null,
    deductions: input.deductions ?? null,
    advances: input.advances ?? null,
    dayNet: input.dayNet ?? null,
    ledgerBalance: input.ledgerBalance,
    payrollMonth: input.payrollMonth,
  };
}

export function buildOtherPayload(input: OtherPayloadInput): OtherWhatsAppPayload {
  const cfg = getConfig();

  return {
    type: 'other',
    phone: input.phone.trim(),
    customerName: input.customerName.trim(),
    message: input.message.trim(),
    branchName: input.branchName ?? cfg.defaultBranchName,
  };
}
