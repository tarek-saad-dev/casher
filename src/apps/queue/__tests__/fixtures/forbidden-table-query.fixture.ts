/**
 * Boundary fixture: queue must not reference invoice/cash tables directly.
 */
export const FORBIDDEN_TABLE_QUERY = `
  SELECT * FROM dbo.TblinvServHead
  JOIN dbo.TblCashMove ON 1=1
`;
