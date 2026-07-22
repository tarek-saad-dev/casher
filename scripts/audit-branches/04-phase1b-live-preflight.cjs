#!/usr/bin/env node
/**
 * READ-ONLY: Phase 1B live preflight.
 * Uses SELECT and SQL Server catalog views only.
 */
const { connectReadOnly } = require('./_db.cjs');

async function query(pool, label, text) {
  try {
    const result = await pool.request().query(text);
    return { label, ok: true, rows: result.recordset };
  } catch (error) {
    return {
      label,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function main() {
  const { pool, target, database } = await connectReadOnly();
  try {
    const report = {
      generatedAt: new Date().toISOString(),
      target,
      database,
      checks: [],
    };

    report.checks.push(
      await query(
        pool,
        'user_employee_columns',
        `
          SELECT
            s.name AS schema_name,
            t.name AS table_name,
            c.column_id,
            c.name AS column_name,
            ty.name AS type_name,
            c.max_length,
            c.is_nullable
          FROM sys.tables t
          INNER JOIN sys.schemas s ON s.schema_id = t.schema_id
          INNER JOIN sys.columns c ON c.object_id = t.object_id
          INNER JOIN sys.types ty ON ty.user_type_id = c.user_type_id
          WHERE s.name = N'dbo' AND t.name IN (N'TblUser', N'TblEmp')
          ORDER BY t.name, c.column_id;
        `,
      ),
    );

    report.checks.push(
      await query(
        pool,
        'user_employee_primary_keys',
        `
          SELECT
            s.name AS schema_name,
            t.name AS table_name,
            kc.name AS constraint_name,
            c.name AS column_name,
            ic.key_ordinal
          FROM sys.key_constraints kc
          INNER JOIN sys.tables t ON t.object_id = kc.parent_object_id
          INNER JOIN sys.schemas s ON s.schema_id = t.schema_id
          INNER JOIN sys.index_columns ic
            ON ic.object_id = kc.parent_object_id
           AND ic.index_id = kc.unique_index_id
          INNER JOIN sys.columns c
            ON c.object_id = ic.object_id
           AND c.column_id = ic.column_id
          WHERE kc.type = N'PK'
            AND s.name = N'dbo'
            AND t.name IN (N'TblUser', N'TblEmp')
          ORDER BY t.name, ic.key_ordinal;
        `,
      ),
    );

    report.checks.push(
      await query(
        pool,
        'user_counts',
        `
          SELECT
            COUNT_BIG(*) AS total_users,
            SUM(CASE WHEN ISNULL(isDeleted, 0) = 0 THEN 1 ELSE 0 END) AS active_users,
            SUM(CASE WHEN ISNULL(isDeleted, 0) = 1 THEN 1 ELSE 0 END) AS deleted_users,
            SUM(CASE WHEN ISNULL(isDeleted, 0) = 0 AND UserLevel = N'admin' THEN 1 ELSE 0 END)
              AS active_legacy_admin_users,
            SUM(CASE WHEN ISNULL(isDeleted, 0) = 0 AND UserLevel <> N'admin' THEN 1 ELSE 0 END)
              AS active_non_admin_users
          FROM dbo.TblUser;
        `,
      ),
    );

    report.checks.push(
      await query(
        pool,
        'employee_counts',
        `
          SELECT
            COUNT_BIG(*) AS total_employees,
            SUM(CASE WHEN ISNULL(isActive, 1) = 1 THEN 1 ELSE 0 END) AS active_employees,
            SUM(CASE WHEN ISNULL(isActive, 1) = 0 THEN 1 ELSE 0 END) AS inactive_employees
          FROM dbo.TblEmp;
        `,
      ),
    );

    report.checks.push(
      await query(
        pool,
        'authoritative_admin_counts',
        `
          WITH ActiveUserAdminState AS (
            SELECT
              u.UserID,
              CASE
                WHEN u.UserLevel = N'admin'
                  OR MAX(CASE
                    WHEN r.IsActive = 1
                     AND r.RoleKey IN (N'admin', N'super_admin')
                    THEN 1 ELSE 0
                  END) = 1
                THEN 1 ELSE 0
              END AS IsAuthoritativeAdmin
            FROM dbo.TblUser u
            LEFT JOIN dbo.TblUserRoles ur ON ur.UserID = u.UserID
            LEFT JOIN dbo.TblRoles r ON r.RoleID = ur.RoleID
            WHERE ISNULL(u.isDeleted, 0) = 0
            GROUP BY u.UserID, u.UserLevel
          )
          SELECT
            COUNT_BIG(*) AS active_users,
            SUM(IsAuthoritativeAdmin) AS authoritative_admin_users,
            SUM(CASE WHEN IsAuthoritativeAdmin = 0 THEN 1 ELSE 0 END) AS non_admin_users
          FROM ActiveUserAdminState;
        `,
      ),
    );

    report.checks.push(
      await query(
        pool,
        'branch_like_tables',
        `
          SELECT s.name AS schema_name, t.name AS table_name
          FROM sys.tables t
          INNER JOIN sys.schemas s ON s.schema_id = t.schema_id
          WHERE t.name LIKE N'%Branch%'
             OR t.name LIKE N'%Salon%'
          ORDER BY s.name, t.name;
        `,
      ),
    );

    report.checks.push(
      await query(
        pool,
        'salon_id_columns',
        `
          SELECT
            s.name AS schema_name,
            t.name AS table_name,
            c.name AS column_name,
            ty.name AS type_name,
            c.is_nullable
          FROM sys.columns c
          INNER JOIN sys.tables t ON t.object_id = c.object_id
          INNER JOIN sys.schemas s ON s.schema_id = t.schema_id
          INNER JOIN sys.types ty ON ty.user_type_id = c.user_type_id
          WHERE c.name IN (N'SalonID', N'SalonId')
          ORDER BY s.name, t.name;
        `,
      ),
    );

    report.checks.push(
      await query(
        pool,
        'salon_id_population',
        `
          SELECT N'TblLoyaltyStoreCategory' AS table_name,
                 COUNT_BIG(*) AS total_rows,
                 SUM(CASE WHEN SalonID IS NULL THEN 1 ELSE 0 END) AS null_salon_rows,
                 COUNT(DISTINCT SalonID) AS distinct_non_null_salons
          FROM dbo.TblLoyaltyStoreCategory
          UNION ALL
          SELECT N'TblLoyaltyStoreItem', COUNT_BIG(*),
                 SUM(CASE WHEN SalonID IS NULL THEN 1 ELSE 0 END),
                 COUNT(DISTINCT SalonID)
          FROM dbo.TblLoyaltyStoreItem
          UNION ALL
          SELECT N'TblClientReferral', COUNT_BIG(*),
                 SUM(CASE WHEN SalonID IS NULL THEN 1 ELSE 0 END),
                 COUNT(DISTINCT SalonID)
          FROM dbo.TblClientReferral
          UNION ALL
          SELECT N'TblMysteryBoxReward', COUNT_BIG(*),
                 SUM(CASE WHEN SalonID IS NULL THEN 1 ELSE 0 END),
                 COUNT(DISTINCT SalonID)
          FROM dbo.TblMysteryBoxReward
          UNION ALL
          SELECT N'TblReferralReward', COUNT_BIG(*),
                 SUM(CASE WHEN SalonID IS NULL THEN 1 ELSE 0 END),
                 COUNT(DISTINCT SalonID)
          FROM dbo.TblReferralReward;
        `,
      ),
    );

    report.checks.push(
      await query(
        pool,
        'operational_branch_columns',
        `
          SELECT s.name AS schema_name, t.name AS table_name, c.name AS column_name
          FROM sys.columns c
          INNER JOIN sys.tables t ON t.object_id = c.object_id
          INNER JOIN sys.schemas s ON s.schema_id = t.schema_id
          WHERE c.name IN (N'BranchID', N'BranchId', N'branch_id')
            AND t.name NOT IN (
              N'TblBranch',
              N'TblUserBranchAccess',
              N'TblEmpBranchAssignment'
            )
          ORDER BY s.name, t.name;
        `,
      ),
    );

    console.log(JSON.stringify(report, null, 2));
  } finally {
    await pool.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
