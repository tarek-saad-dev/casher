/**
 * queueSchema.ts
 * Schema detection helpers for QueueTickets table
 * Detects available columns dynamically to avoid "Invalid column name" errors
 */

import { getPool } from '@/lib/db';

export interface QueueTicketsSchema {
  hasEstimatedDurationMinutes: boolean;  // Does NOT exist in actual schema
  hasEstimatedEndTime: boolean;          // Does NOT exist in actual schema
  hasEstimatedWaitMinutes: boolean;      // EXISTS in actual schema
  hasWaitingCountAtCreation: boolean;    // EXISTS in actual schema
  hasCreatedAt: boolean;                  // Does NOT exist (use CreatedTime)
  hasCreatedTime: boolean;                // EXISTS in actual schema
  hasAnnouncedAt: boolean;               // EXISTS in actual schema
  hasCalledAt: boolean;                  // EXISTS in actual schema
  hasUpdatedAt: boolean;                  // Does NOT exist
  hasClientID: boolean;                  // EXISTS in actual schema
  hasTicketNumber: boolean;              // EXISTS in actual schema
  hasTicketPrefix: boolean;              // EXISTS in actual schema
  hasQueueTime: boolean;                 // May not exist (use CreatedTime)
  hasPriority: boolean;                  // EXISTS in actual schema
  hasNotes: boolean;                     // EXISTS in actual schema
  hasSource: boolean;                    // EXISTS in actual schema
  hasBookingID: boolean;                 // EXISTS in actual schema
  hasCustomerName: boolean;              // May or may not exist
  hasCustomerPhone: boolean;             // May or may not exist
  hasDurationMinutes: boolean;
  hasExpectedStartAt: boolean;
  hasExpectedEndAt: boolean;
  allColumns: string[];
}

let schemaCache: QueueTicketsSchema | null = null;
let schemaCacheTime = 0;
const CACHE_TTL_MS = 60000; // 1 minute cache

/**
 * Detect QueueTickets schema columns
 * Caches result for 1 minute to avoid repeated queries
 */
export async function detectQueueTicketsSchema(): Promise<QueueTicketsSchema> {
  const now = Date.now();
  if (schemaCache && now - schemaCacheTime < CACHE_TTL_MS) {
    return schemaCache;
  }

  const db = await getPool();

  try {
    const result = await db.request().query(`
      SELECT COLUMN_NAME
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_NAME = 'QueueTickets'
      ORDER BY ORDINAL_POSITION
    `);

    const columns = result.recordset.map((r: any) => r.COLUMN_NAME.toLowerCase());

    const schema: QueueTicketsSchema = {
      hasEstimatedDurationMinutes: columns.includes('estimateddurationminutes'),
      hasEstimatedEndTime: columns.includes('estimatedendtime'),
      hasEstimatedWaitMinutes: columns.includes('estimatedwaitminutes'),
      hasWaitingCountAtCreation: columns.includes('waitingcountatcreation'),
      hasCreatedAt: columns.includes('createdat'),
      hasCreatedTime: columns.includes('createdtime'),
      hasAnnouncedAt: columns.includes('announcedat'),
      hasCalledAt: columns.includes('calledat'),
      hasUpdatedAt: columns.includes('updatedat'),
      hasClientID: columns.includes('clientid'),
      hasTicketNumber: columns.includes('ticketnumber'),
      hasTicketPrefix: columns.includes('ticketprefix'),
      hasQueueTime: columns.includes('queuetime'),
      hasPriority: columns.includes('priority'),
      hasNotes: columns.includes('notes'),
      hasSource: columns.includes('source'),
      hasBookingID: columns.includes('bookingid'),
      hasCustomerName: columns.includes('customername'),
      hasCustomerPhone: columns.includes('customerphone'),
      hasDurationMinutes: columns.includes('durationminutes'),
      hasExpectedStartAt: columns.includes('expectedstartat'),
      hasExpectedEndAt: columns.includes('expectedendat'),
      allColumns: columns,
    };

    schemaCache = schema;
    schemaCacheTime = now;

    console.log('[queueSchema] Detected columns:', columns.join(', '));
    return schema;
  } catch (err) {
    console.error('[queueSchema] Failed to detect schema:', err);
    // Return conservative fallback - assume minimal columns based on actual schema
    return {
      hasEstimatedDurationMinutes: false,
      hasEstimatedEndTime: false,
      hasEstimatedWaitMinutes: false,
      hasWaitingCountAtCreation: false,
      hasCreatedAt: false,
      hasCreatedTime: true,  // Most likely exists
      hasAnnouncedAt: false,
      hasCalledAt: false,
      hasUpdatedAt: false,
      hasClientID: false,
      hasTicketNumber: true,  // Most likely exists
      hasTicketPrefix: false,
      hasQueueTime: false,
      hasPriority: false,
      hasNotes: false,
      hasSource: true,  // Most likely exists
      hasBookingID: false,
      hasCustomerName: false,
      hasCustomerPhone: false,
      hasDurationMinutes: false,
      hasExpectedStartAt: false,
      hasExpectedEndAt: false,
      allColumns: [],
    };
  }
}

/**
 * Build INSERT columns for creating a queue ticket based on actual schema
 * ONLY includes columns that exist in the database
 */
export function buildInsertColumns(schema: QueueTicketsSchema): {
  columns: string[];
  paramNames: string[];
} {
  // Core columns that should always exist
  const columns: string[] = [
    'TicketCode',
    'QueueDate',
    'EmpID',
    'Status',
  ];

  const paramNames: string[] = [
    '@ticketCode',
    '@queueDate',
    '@empId',
    '@status',
  ];

  // Optional columns based on actual schema
  if (schema.hasTicketNumber) {
    columns.push('TicketNumber');
    paramNames.push('(SELECT ISNULL(MAX(TicketNumber), 0) + 1 FROM [dbo].[QueueTickets] WHERE QueueDate = @queueDate)');
  }

  if (schema.hasTicketPrefix) {
    columns.push('TicketPrefix');
    paramNames.push("@ticketPrefix");
  }

  if (schema.hasClientID) {
    columns.push('ClientID');
    paramNames.push('@clientId');
  }

  if (schema.hasSource) {
    columns.push('Source');
    paramNames.push('@source');
  }

  if (schema.hasPriority) {
    columns.push('Priority');
    paramNames.push('@priority');
  }

  // Customer info - only if columns exist
  // Prefer ClientID over CustomerName/CustomerPhone
  if (schema.hasCustomerName) {
    columns.push('CustomerName');
    paramNames.push('@customerName');
  }
  if (schema.hasCustomerPhone) {
    columns.push('CustomerPhone');
    paramNames.push('@customerPhone');
  }

  // Estimated timing - only use existing columns
  columns.push('EstimatedStartTime');
  paramNames.push('@estimatedStartTime');

  // Use EstimatedWaitMinutes instead of EstimatedDurationMinutes/EndTime
  if (schema.hasEstimatedWaitMinutes) {
    columns.push('EstimatedWaitMinutes');
    paramNames.push('@estimatedWaitMinutes');
  }

  if (schema.hasDurationMinutes) {
    columns.push('DurationMinutes');
    paramNames.push('@durationMinutes');
  }
  if (schema.hasExpectedStartAt) {
    columns.push('ExpectedStartAt');
    paramNames.push('@expectedStartAt');
  }
  if (schema.hasExpectedEndAt) {
    columns.push('ExpectedEndAt');
    paramNames.push('@expectedEndAt');
  }

  if (schema.hasWaitingCountAtCreation) {
    columns.push('WaitingCountAtCreation');
    paramNames.push('@waitingCountAtCreation');
  }

  if (schema.hasNotes) {
    columns.push('Notes');
    paramNames.push('@notes');
  }

  // Created time - use CreatedTime (exists) not CreatedAt (doesn't exist)
  if (schema.hasCreatedTime) {
    columns.push('CreatedTime');
    paramNames.push('GETDATE()');
  }

  return { columns, paramNames };
}

/**
 * Get ORDER BY clause for queue tickets (avoids CreatedAt if not present)
 */
export function getQueueOrderBy(schema: QueueTicketsSchema): string {
  if (schema.hasCreatedAt) {
    return 'ORDER BY qt.EstimatedStartTime ASC, qt.CreatedAt ASC';
  }
  if (schema.hasCreatedTime) {
    return 'ORDER BY qt.EstimatedStartTime ASC, qt.CreatedTime ASC';
  }
  if (schema.hasQueueTime) {
    return 'ORDER BY qt.EstimatedStartTime ASC, qt.QueueTime ASC';
  }
  // Fallback to just EstimatedStartTime + ID
  return 'ORDER BY qt.EstimatedStartTime ASC, qt.QueueTicketID ASC';
}

/**
 * Clear schema cache (useful after migrations)
 */
export function clearSchemaCache(): void {
  schemaCache = null;
  schemaCacheTime = 0;
}
