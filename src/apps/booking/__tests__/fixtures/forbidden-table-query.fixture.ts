/**
 * Boundary fixture: extracted booking code must not raw-query forbidden tables.
 */
export const FORBIDDEN_BOOKING_SQL = `
  SELECT * FROM dbo.TblinvServHead
  UNION ALL
  SELECT * FROM dbo.TblCashMove
  UNION ALL
  SELECT * FROM dbo.QueueTickets
`;
