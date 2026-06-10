import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { getSession } from '@/lib/session';

export const runtime = 'nodejs';

export async function POST() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 });

  try {
    const db = await getPool();

    // ── 1. TblRoles ─────────────────────────────────────────────────────────
    await db.request().query(`
      IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'TblRoles')
      BEGIN
        CREATE TABLE dbo.TblRoles (
          RoleID     INT IDENTITY(1,1) PRIMARY KEY,
          RoleKey    NVARCHAR(50)  NOT NULL UNIQUE,
          RoleName   NVARCHAR(100) NOT NULL,
          Description NVARCHAR(255) NULL,
          IsActive   BIT NOT NULL DEFAULT 1,
          CreatedAt  DATETIME2 NOT NULL DEFAULT GETDATE()
        )
      END
    `);

    // ── 2. TblUserRoles ──────────────────────────────────────────────────────
    await db.request().query(`
      IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'TblUserRoles')
      BEGIN
        CREATE TABLE dbo.TblUserRoles (
          ID        INT IDENTITY(1,1) PRIMARY KEY,
          UserID    INT NOT NULL REFERENCES dbo.TblUser(UserID),
          RoleID    INT NOT NULL REFERENCES dbo.TblRoles(RoleID),
          AssignedAt DATETIME2 NOT NULL DEFAULT GETDATE(),
          CONSTRAINT UQ_UserRoles UNIQUE (UserID, RoleID)
        )
      END
    `);

    // ── 3. TblSystemPages ───────────────────────────────────────────────────
    await db.request().query(`
      IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'TblSystemPages')
      BEGIN
        CREATE TABLE dbo.TblSystemPages (
          PageID      INT IDENTITY(1,1) PRIMARY KEY,
          PageKey     NVARCHAR(100) NOT NULL UNIQUE,
          PageName    NVARCHAR(150) NOT NULL,
          PagePath    NVARCHAR(255) NOT NULL,
          Section     NVARCHAR(100) NULL,
          AccessMode  NVARCHAR(30)  NOT NULL DEFAULT 'roles',
          -- 'all' = any authenticated user
          -- 'roles' = only assigned roles
          -- 'super_admin_only' = super_admin only
          SortOrder   INT NOT NULL DEFAULT 0,
          IsActive    BIT NOT NULL DEFAULT 1,
          CreatedAt   DATETIME2 NOT NULL DEFAULT GETDATE()
        )
      END
    `);

    // ── 4. TblPageRoleAccess ─────────────────────────────────────────────────
    await db.request().query(`
      IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'TblPageRoleAccess')
      BEGIN
        CREATE TABLE dbo.TblPageRoleAccess (
          ID       INT IDENTITY(1,1) PRIMARY KEY,
          PageID   INT NOT NULL REFERENCES dbo.TblSystemPages(PageID),
          RoleID   INT NOT NULL REFERENCES dbo.TblRoles(RoleID),
          CanView  BIT NOT NULL DEFAULT 1,
          CanEdit  BIT NOT NULL DEFAULT 0,
          CanDelete BIT NOT NULL DEFAULT 0,
          CONSTRAINT UQ_PageRoleAccess UNIQUE (PageID, RoleID)
        )
      END
    `);

    // ── 5. TblPermissionAuditLog ─────────────────────────────────────────────
    await db.request().query(`
      IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'TblPermissionAuditLog')
      BEGIN
        CREATE TABLE dbo.TblPermissionAuditLog (
          LogID      INT IDENTITY(1,1) PRIMARY KEY,
          ActorUserID INT NULL,
          Action     NVARCHAR(50)  NOT NULL,
          TargetType NVARCHAR(50)  NULL,
          TargetID   INT NULL,
          Details    NVARCHAR(500) NULL,
          CreatedAt  DATETIME2 NOT NULL DEFAULT GETDATE()
        )
      END
    `);

    return NextResponse.json({ success: true, message: 'Migration completed successfully' });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
