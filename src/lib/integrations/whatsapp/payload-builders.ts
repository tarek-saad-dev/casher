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

export function resolvePhone(
  mobile: string | null | undefined,
  phone: string | null | undefined,
): string | null {
  return mobile?.trim() || phone?.trim() || null;
}
