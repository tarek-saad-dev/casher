/**
 * Live smoke samples for Booking Phase 1 (read-only).
 */
import path from 'path';
import Module from 'module';
import dotenv from 'dotenv';
dotenv.config({ path: path.join(__dirname, '..', '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '..', '.env.local'), override: true });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const m = Module as any;
const orig = m._load;
m._load = function (req: string, ...rest: unknown[]) {
  if (req === 'server-only') return {};
  return orig.call(this, req, ...rest);
};

async function main() {
  const {
    listPublicDiscoverableBranches,
    resolvePublicBookingBranchContext,
    PublicBookingBranchContextError,
  } = await import('../../src/lib/booking/publicBookingBranchContext');
  const { publicBookingErrorBody } = await import('../../src/lib/booking/publicBookingErrorCatalog');

  const branches = await listPublicDiscoverableBranches();
  console.log('BRANCHES', JSON.stringify(branches.map((b) => b.branchCode)));

  const gleem = await resolvePublicBookingBranchContext({
    branchCode: 'GLEEM',
    purpose: 'public_booking',
  });
  console.log(
    'GLEEM_CONFIG_OK',
    JSON.stringify({
      branchCode: gleem.branchCode,
      timezone: gleem.timezone,
      bookingEnabled: gleem.bookingEnabled,
      hours: gleem.operatingHours,
    }),
  );

  try {
    await resolvePublicBookingBranchContext({ branchCode: null, purpose: 'public_booking' });
  } catch (e) {
    if (e instanceof PublicBookingBranchContextError) {
      console.log('MISSING', JSON.stringify(publicBookingErrorBody(e.code)));
    }
  }

  try {
    await resolvePublicBookingBranchContext({
      branchCode: 'CAMP_CAESAR',
      purpose: 'public_booking',
    });
  } catch (e) {
    if (e instanceof PublicBookingBranchContextError) {
      console.log('CC_REJECT', JSON.stringify(publicBookingErrorBody(e.code)));
    }
  }

  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
