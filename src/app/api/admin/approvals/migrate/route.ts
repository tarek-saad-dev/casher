import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { requireRole, isAuthResult } from '@/lib/api-auth';

// POST /api/admin/approvals/migrate
// Idempotent: creates TblApprovalRequests if it doesn't exist.
// super_admin only (or ADMIN_SETUP_SECRET header).
export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-admin-setup-secret');
  if (secret !== process.env.ADMIN_SETUP_SECRET) {
    const auth = await requireRole(['admin']);
    if (!isAuthResult(auth)) return auth;
  }

  const db = await getPool();

  await db.request().query(`
    IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'dbo.TblApprovalRequests') AND type = 'U')
    BEGIN
      CREATE TABLE dbo.TblApprovalRequests (
        ApprovalID           INT IDENTITY(1,1) PRIMARY KEY,
        RequestType          NVARCHAR(100)  NOT NULL,
        EntityType           NVARCHAR(100)  NOT NULL,
        EntityID             NVARCHAR(100)  NULL,
        ActionMethod         NVARCHAR(20)   NOT NULL,
        EndpointPath         NVARCHAR(300)  NULL,
        RequestedByUserID    INT            NOT NULL,
        Status               NVARCHAR(30)   NOT NULL DEFAULT 'pending',
        OldData              NVARCHAR(MAX)  NULL,
        NewData              NVARCHAR(MAX)  NULL,
        Reason               NVARCHAR(500)  NULL,
        RiskLevel            NVARCHAR(30)   NOT NULL DEFAULT 'medium',
        ReviewedByUserID     INT            NULL,
        ReviewedAt           DATETIME2      NULL,
        ReviewNote           NVARCHAR(500)  NULL,
        ExecutedAt           DATETIME2      NULL,
        ErrorMessage         NVARCHAR(MAX)  NULL,
        CreatedAt            DATETIME2      NOT NULL DEFAULT GETDATE(),
        CONSTRAINT FK_ApprovalReq_RequestedBy FOREIGN KEY (RequestedByUserID) REFERENCES dbo.TblUser(UserID),
        CONSTRAINT FK_ApprovalReq_ReviewedBy  FOREIGN KEY (ReviewedByUserID)  REFERENCES dbo.TblUser(UserID)
      );

      CREATE INDEX IX_ApprovalReq_Status         ON dbo.TblApprovalRequests (Status);
      CREATE INDEX IX_ApprovalReq_RequestedBy    ON dbo.TblApprovalRequests (RequestedByUserID);
      CREATE INDEX IX_ApprovalReq_RequestType    ON dbo.TblApprovalRequests (RequestType);
      CREATE INDEX IX_ApprovalReq_CreatedAt      ON dbo.TblApprovalRequests (CreatedAt DESC);
    END
  `);

  return NextResponse.json({ ok: true, message: 'TblApprovalRequests ready' });
}
