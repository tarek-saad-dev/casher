/**
 * Intentional operational invariant — not an accidental leftover of the
 * pre-multi-branch schema.
 *
 * A user may have AT MOST ONE OPEN shift globally
 * (TblShiftMove.Status = 1, unique filtered index UX_TblShiftMove_OneOpenPerUser).
 *
 * The open shift instance is owned by:
 *   UserID + BranchID + BusinessDayID + ShiftID (definition).
 *
 * This is NOT one-open-per-(user, branch). Cross-branch work uses atomic handoff.
 */
export const ONE_OPEN_SHIFT_PER_USER = true as const;

/**
 * BusinessDay is branch-scoped. These are operational rules, not accidents:
 *
 * - Each Branch may have at most ONE OPEN BusinessDay
 *   (UX_TblNewDay_OneOpenPerBranch).
 * - A BusinessDay belongs to exactly one Branch.
 * - A ShiftSession may open only against an OPEN BusinessDay.
 * - A BusinessDay may close only when there are no OPEN shifts for
 *   that BranchID + BusinessDayID, unless forceCloseShifts is used.
 * - No new operational financial write may commit after that BusinessDay
 *   has been successfully closed.
 */
export const ONE_OPEN_BUSINESS_DAY_PER_BRANCH = true as const;

/** Auditable reason when close-day force-closes shifts. Not persisted (no column yet). */
export const BUSINESS_DAY_FORCE_CLOSE = 'BUSINESS_DAY_FORCE_CLOSE' as const;

/** Auditable reason when automatic rollover closes forgotten shifts. Not persisted. */
export const AUTO_BUSINESS_DAY_ROLLOVER = 'AUTO_BUSINESS_DAY_ROLLOVER' as const;

/** User-facing message when catch-up cannot make the current BusinessDay usable. */
export const BUSINESS_DAY_RECONCILE_USER_MESSAGE =
  'تعذر تجهيز يوم العمل الحالي. حاول مرة أخرى أو تواصل مع المسؤول.';
