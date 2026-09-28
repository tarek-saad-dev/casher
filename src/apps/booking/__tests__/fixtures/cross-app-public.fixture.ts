/**
 * Boundary fixture: an app must not import another app, including a public path.
 * Not imported by production code. Scanned only by the boundary test.
 */
import { APP_CODE as POS_APP_CODE } from '@/apps/pos/public';

export const CROSS_APP_PUBLIC_FIXTURE = POS_APP_CODE;
