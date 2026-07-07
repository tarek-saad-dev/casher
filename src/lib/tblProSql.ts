/** Non-deleted rows in dbo.TblPro (TblPro has isDeleted, not IsActive). */
export function getServiceActiveWhereClause(alias = 'p'): string {
  return `(${alias}.isDeleted = 0 OR ${alias}.isDeleted IS NULL)`;
}
