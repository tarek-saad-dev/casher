/**
 * After public self-service signup, land on the tenant Workspace — not floor ops.
 * /operations remains available for staff who are already operationally ready.
 */
export const PUBLIC_SIGNUP_NEXT_PATH = '/workspace' as const;
