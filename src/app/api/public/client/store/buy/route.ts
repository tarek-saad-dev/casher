/**
 * CUT CLUB legacy customer route retired. Historical endpoints trusted a
 * caller-provided phone/clientId; exposing financial records or applying
 * Coins/box mutations here would bypass verified member ownership.
 * See /api/public/cut-club/wallet for the authenticated replacement.
 */
import { legacyCutClubPublicDenied } from '@/lib/cut-club/legacyPublicQuarantine';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function POST(){return legacyCutClubPublicDenied();}
export async function OPTIONS(){return legacyCutClubPublicDenied();}
