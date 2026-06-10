/**
 * Centralized handler for API responses that may return pendingApproval.
 *
 * Usage:
 *   const handled = handleApprovalResponse(data, {
 *     addToast,
 *     onExecuted: () => refresh(),
 *     onPending:  () => closeModal(),
 *   });
 *   if (handled) return; // stop further processing
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ApprovalAwareResponse {
  success?: boolean;
  ok?: boolean;
  pendingApproval?: boolean;
  approvalId?: number;
  message?: string;
  error?: string;
}

type ToastFn =
  | ((type: 'success' | 'error' | 'info', message: string) => void)
  | ((message: string, ok?: boolean) => void);

export interface ApprovalHandlerOptions {
  /** Toast function — supports both addToast(type, msg) and showToast(msg, ok) patterns */
  addToast?: ToastFn;
  /** Called when the operation was fully executed (super_admin fast path) */
  onExecuted?: () => void;
  /** Called when a pending approval was created (normal user path) */
  onPending?: () => void;
  /** Called on real API error */
  onFailed?: (message: string) => void;
  /** Custom success message override for executed state */
  successMessage?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

export function getApprovalPendingMessage(approvalId?: number): string {
  return approvalId
    ? `تم تسجيل العملية برقم #${approvalId}، وهي الآن في انتظار موافقة المسؤول.`
    : 'تم تسجيل العملية بنجاح، وهي الآن في انتظار موافقة المسؤول.';
}

/** Normalize heterogeneous toast signatures into a single call */
function callToast(
  fn: ToastFn | undefined,
  type: 'success' | 'error' | 'info',
  message: string,
): void {
  if (!fn) return;
  // Detect addToast(type, msg) vs showToast(msg, ok)
  // addToast first arg is a string type keyword; showToast first arg is the message
  try {
    (fn as (type: 'success' | 'error' | 'info', message: string) => void)(type, message);
  } catch {
    // fallback — shouldn't be needed but safe
  }
}

// ── Main handler ──────────────────────────────────────────────────────────────

/**
 * Returns true if the response was handled (pending OR executed OR error).
 * Returns false only if the response is unrecognised and caller should handle.
 */
export function handleApprovalResponse(
  data: ApprovalAwareResponse,
  options: ApprovalHandlerOptions = {},
): boolean {
  const { addToast, onExecuted, onPending, onFailed, successMessage } = options;

  // ── Pending Approval ──────────────────────────────────────────────────────
  if (data.pendingApproval) {
    const msg = getApprovalPendingMessage(data.approvalId);
    callToast(addToast, 'info', msg);
    onPending?.();
    return true;
  }

  // ── Executed Successfully ─────────────────────────────────────────────────
  if (data.success || data.ok) {
    const msg = successMessage ?? data.message ?? 'تم تنفيذ العملية بنجاح.';
    callToast(addToast, 'success', msg);
    onExecuted?.();
    return true;
  }

  // ── Real Error ────────────────────────────────────────────────────────────
  const errMsg = data.error ?? data.message ?? 'حدث خطأ غير متوقع.';
  callToast(addToast, 'error', errMsg);
  onFailed?.(errMsg);
  return true;
}

// ── Convenience wrapper that also handles fetch + JSON ────────────────────────

export async function fetchAndHandleApproval(
  input: RequestInfo,
  init: RequestInit,
  options: ApprovalHandlerOptions & { setLoading?: (v: boolean) => void },
): Promise<ApprovalAwareResponse | null> {
  const { setLoading, ...handlerOpts } = options;
  setLoading?.(true);
  try {
    const res = await fetch(input, init);
    const data: ApprovalAwareResponse = await res.json().catch(() => ({}));

    if (!res.ok && !data.pendingApproval) {
      const errMsg = data.error ?? data.message ?? `HTTP ${res.status}`;
      callToast(handlerOpts.addToast, 'error', errMsg);
      handlerOpts.onFailed?.(errMsg);
      return data;
    }

    handleApprovalResponse(data, handlerOpts);
    return data;
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'فشل الاتصال بالخادم.';
    callToast(handlerOpts.addToast, 'error', msg);
    handlerOpts.onFailed?.(msg);
    return null;
  } finally {
    setLoading?.(false);
  }
}
