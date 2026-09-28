/**
 * Intentional boundary violation fixture for DRVO-003 import-boundary tests.
 * Do not import this file from production code.
 */
import type { CustomersPort } from '@/shared/customers/public';

export const FORBIDDEN_FIXTURE: CustomersPort | null = null;
