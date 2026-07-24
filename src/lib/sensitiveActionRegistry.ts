/**
 * Sensitive Action Registry
 *
 * Central metadata for every audited operation.  Keeps Arabic labels,
 * risk levels, entity mapping, and the set of sensitive fields that
 * must never be stored in audit JSON.
 */

export type SensitiveRiskLevel = 'low' | 'medium' | 'high' | 'critical';

export interface SensitiveActionMetadata {
  actionType: string;
  label: string;
  entityType: string;
  riskLevel: SensitiveRiskLevel;
  requiresReason: boolean;
  sensitiveFields: string[];
}

export const SENSITIVE_ACTIONS: Record<string, SensitiveActionMetadata> = {
  edit_expense: {
    actionType: 'edit_expense',
    label: 'تعديل مصروف',
    entityType: 'TblCashMove',
    riskLevel: 'high',
    requiresReason: false,
    sensitiveFields: ['password', 'token', 'secret', 'cookie'],
  },
  delete_expense: {
    actionType: 'delete_expense',
    label: 'حذف مصروف',
    entityType: 'TblCashMove',
    riskLevel: 'high',
    requiresReason: true,
    sensitiveFields: ['password', 'token', 'secret', 'cookie'],
  },
  edit_income: {
    actionType: 'edit_income',
    label: 'تعديل إيراد',
    entityType: 'TblCashMove',
    riskLevel: 'high',
    requiresReason: false,
    sensitiveFields: ['password', 'token', 'secret', 'cookie'],
  },
  delete_income: {
    actionType: 'delete_income',
    label: 'حذف إيراد',
    entityType: 'TblCashMove',
    riskLevel: 'high',
    requiresReason: true,
    sensitiveFields: ['password', 'token', 'secret', 'cookie'],
  },
  edit_invoice: {
    actionType: 'edit_invoice',
    label: 'تعديل فاتورة مبيعات',
    entityType: 'TblinvServHead',
    riskLevel: 'high',
    requiresReason: false,
    sensitiveFields: ['password', 'token', 'secret', 'cookie'],
  },
  delete_invoice: {
    actionType: 'delete_invoice',
    label: 'حذف فاتورة مبيعات',
    entityType: 'TblinvServHead',
    riskLevel: 'critical',
    requiresReason: true,
    sensitiveFields: ['password', 'token', 'secret', 'cookie'],
  },
  treasury_transfer: {
    actionType: 'treasury_transfer',
    label: 'تحويل في الخزنة',
    entityType: 'TblCashMove',
    riskLevel: 'high',
    requiresReason: false,
    sensitiveFields: ['password', 'token', 'secret', 'cookie'],
  },
  close_day: {
    actionType: 'close_day',
    label: 'تقفيل اليوم',
    entityType: 'TblNewDay',
    riskLevel: 'critical',
    requiresReason: true,
    sensitiveFields: ['password', 'token', 'secret', 'cookie'],
  },
  update_user_roles: {
    actionType: 'update_user_roles',
    label: 'تعديل صلاحيات مستخدم',
    entityType: 'TblUserRoles',
    riskLevel: 'critical',
    requiresReason: true,
    sensitiveFields: ['password', 'token', 'secret', 'cookie'],
  },
  update_page_access: {
    actionType: 'update_page_access',
    label: 'تعديل صلاحيات صفحة',
    entityType: 'TblSystemPages',
    riskLevel: 'critical',
    requiresReason: true,
    sensitiveFields: ['password', 'token', 'secret', 'cookie'],
  },
  delete_cash_move: {
    actionType: 'delete_cash_move',
    label: 'حذف حركة خزنة',
    entityType: 'TblCashMove',
    riskLevel: 'critical',
    requiresReason: true,
    sensitiveFields: ['password', 'token', 'secret', 'cookie'],
  },
  create_page: {
    actionType: 'create_page',
    label: 'إنشاء صفحة جديدة',
    entityType: 'TblSystemPages',
    riskLevel: 'medium',
    requiresReason: false,
    sensitiveFields: ['password', 'token', 'secret', 'cookie'],
  },
  BRANCH_SESSION_SWITCH: {
    actionType: 'BRANCH_SESSION_SWITCH',
    label: 'تبديل الفرع النشط',
    entityType: 'TblBranch',
    riskLevel: 'medium',
    requiresReason: false,
    sensitiveFields: ['password', 'token', 'secret', 'cookie', 'authorization'],
  },
  BRANCH_SESSION_SWITCH_DENIED: {
    actionType: 'BRANCH_SESSION_SWITCH_DENIED',
    label: 'رفض تبديل الفرع',
    entityType: 'TblBranch',
    riskLevel: 'medium',
    requiresReason: false,
    sensitiveFields: ['password', 'token', 'secret', 'cookie', 'authorization'],
  },
};

export function getSensitiveAction(actionType: string): SensitiveActionMetadata {
  const meta = SENSITIVE_ACTIONS[actionType];
  if (!meta) {
    return {
      actionType,
      label: actionType,
      entityType: 'unknown',
      riskLevel: 'high',
      requiresReason: true,
      sensitiveFields: ['password', 'token', 'secret', 'cookie'],
    };
  }
  return meta;
}
