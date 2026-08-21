#!/usr/bin/env npx tsx
/**
 * Apply isolated AUTH schema + localadmin seed to HawaiBookingV2Isolated via sqlcmd -E.
 * Azure is never written.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { requireBookingV2WriteTestSafety } from '../src/lib/booking/bookingV2WriteSafety';

const DEST_SERVER = process.env.BOOKING_V2_TEST_DB_SERVER || '.\\SQLEXPRESS';
const DEST_DB = process.env.BOOKING_V2_TEST_DB_NAME || 'HawaiBookingV2Isolated';
const SQL_FILE = path.join(process.cwd(), 'scripts', 'sql', 'booking-v2-isolated-auth-seed.sql');

function sqlcmd(args: string[]) {
  return execFileSync('sqlcmd', args, {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
}

process.env.HAWAI_DB_CLASS = 'isolated';
process.env.BOOKING_V2_WRITE_TEST_OK = '1';
process.env.BOOKING_V2_TEST_DB_SERVER = DEST_SERVER;
process.env.BOOKING_V2_TEST_DB_NAME = DEST_DB;
process.env.DB_SERVER = DEST_SERVER;
process.env.DB_DATABASE = DEST_DB;

const safety = requireBookingV2WriteTestSafety();
console.log('[isolated-auth]', safety);

if (!fs.existsSync(SQL_FILE)) throw new Error(`missing ${SQL_FILE}`);

const dest = sqlcmd(['-S', DEST_SERVER, '-E', '-d', DEST_DB, '-h', '-1', '-W', '-Q', 'SET NOCOUNT ON; SELECT DB_NAME();']).trim();
if (dest.toLowerCase() === 'last132') throw new Error('REFUSING last132');
console.log(`[isolated-auth] dest=${dest}`);

const out = sqlcmd(['-S', DEST_SERVER, '-E', '-d', DEST_DB, '-f', '65001', '-b', '-i', SQL_FILE]);
console.log(out);
