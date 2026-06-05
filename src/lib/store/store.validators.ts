// ============================================
// CUT CLUB STORE - Validation Functions
// ============================================

import type { ItemType } from "./store.types";

// ============================================
// Validate Item Type
// ============================================
export function isValidItemType(itemType: string): itemType is ItemType {
  const validTypes: ItemType[] = [
    "DISCOUNT_AMOUNT",
    "DISCOUNT_PERCENT",
    "FREE_SERVICE",
    "FREE_PRODUCT",
    "DOUBLE_POINTS",
    "BONUS_POINTS",
    "VIP_UPGRADE",
    "PRIORITY_BOOKING",
    "MYSTERY_BOX",
    "CUSTOM",
  ];
  return validTypes.includes(itemType as ItemType);
}

// ============================================
// Validate Inventory Status
// ============================================
export function isValidInventoryStatus(status: string): boolean {
  const validStatuses = ["ACTIVE", "USED", "EXPIRED", "CANCELLED"];
  return validStatuses.includes(status);
}

// ============================================
// Validate Referral Status
// ============================================
export function isValidReferralStatus(status: string): boolean {
  const validStatuses = ["PENDING", "COMPLETED", "EXPIRED", "CANCELLED"];
  return validStatuses.includes(status);
}

// ============================================
// Validate Mystery Box Reward Type
// ============================================
export function isValidMysteryBoxRewardType(rewardType: string): boolean {
  const validTypes = ["COINS", "STORE_ITEM", "DISCOUNT", "BONUS_POINTS", "JACKPOT"];
  return validTypes.includes(rewardType);
}

// ============================================
// Validate Price
// ============================================
export function isValidPrice(price: number): boolean {
  return price >= 0 && Number.isFinite(price);
}

// ============================================
// Validate Quantity
// ============================================
export function isValidQuantity(quantity: number): boolean {
  return Number.isInteger(quantity) && quantity > 0;
}

// ============================================
// Validate Voucher Code Format
// ============================================
export function isValidVoucherCodeFormat(code: string): boolean {
  return /^CC-\d+-\d+-[A-Z0-9]+-[A-Z0-9]+$/.test(code);
}

// ============================================
// Validate Referral Code Format
// ============================================
export function isValidReferralCodeFormat(code: string): boolean {
  return /^CUT-[A-Z0-9]{6,12}$/.test(code);
}

// ============================================
// Validate Client ID
// ============================================
export function isValidClientId(clientId: unknown): clientId is number {
  return typeof clientId === "number" && Number.isInteger(clientId) && clientId > 0;
}

// ============================================
// Validate Item ID
// ============================================
export function isValidItemId(itemId: unknown): itemId is number {
  return typeof itemId === "number" && Number.isInteger(itemId) && itemId > 0;
}

// ============================================
// Validate Inventory ID
// ============================================
export function isValidInventoryId(inventoryId: unknown): inventoryId is number {
  return typeof inventoryId === "number" && Number.isInteger(inventoryId) && inventoryId > 0;
}

// ============================================
// Validate Percentage Value
// ============================================
export function isValidPercentage(value: number): boolean {
  return value >= 0 && value <= 100 && Number.isFinite(value);
}

// ============================================
// Validate Phone Number (Egyptian format)
// ============================================
export function isValidPhoneNumber(phone: string): boolean {
  return /^(010|011|012|015)\d{8}$/.test(phone);
}

// ============================================
// Sanitize Input String
// ============================================
export function sanitizeString(input: string): string {
  return input.trim().replace(/[<>]/g, "");
}

// ============================================
// Validate Date Range
// ============================================
export function isValidDateRange(fromDate: Date, toDate: Date): boolean {
  return fromDate <= toDate;
}

// ============================================
// Check if Date is in Future
// ============================================
export function isFutureDate(date: Date): boolean {
  return date > new Date();
}

// ============================================
// Check if Date is in Past
// ============================================
export function isPastDate(date: Date): boolean {
  return date < new Date();
}
