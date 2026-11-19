/**
 * READ ONLY shared staging schema/tenant provenance inspection.
 * Explicitly refuses non-staging and does not print real customer data.
 * No CREATE/UPDATE/DELETE/EXEC; only SQL Server metadata/aggregate counts.
 */
const sql=require('mssql');
const host=process.env.CUT_CLUB_STAGING_HOST;
const port=Number(process.env.CUT_CLUB_STAGING_PORT);
const user=process.env.CUT_CLUB_STAGING_USER;
const database=process.env.CUT_CLUB_STAGING_DATABASE;
const password=process.env.CUT_CLUB_STAGING_PASSWORD;
if(process.env.CUT_CLUB_STAGING_READ_ONLY!=='1'||host!=='127.0.0.1'||port!==14330||
   database!=='last132_agent'||user!=='drvo_agent'||!password||
   process.env.CI!=='true'){
  throw Error('CUT_CLUB_STAGE_INSPECTION_REFUSED');
}
async function main(){
 const pool=await new sql.ConnectionPool({
   server:host,port,user,password,database,options:{encrypt:false,trustServerCertificate:true},
   connectionTimeout:15000,requestTimeout:30000,
 }).connect();
 try{
  const id=await pool.request().query(`
    SELECT DB_NAME() AS DatabaseName,SUSER_SNAME() AS LoginName
  `);
  if(id.recordset.length!==1||id.recordset[0].DatabaseName!==database||id.recordset[0].LoginName!==user)
    throw Error('CUT_CLUB_STAGE_SQL_IDENTITY_MISMATCH');

  const result=await pool.request().query(`
   SELECT
     OBJECT_ID(N'dbo.Tenant',N'U') AS TenantTable,
     OBJECT_ID(N'dbo.TblClient',N'U') AS ClientTable,
     OBJECT_ID(N'dbo.TblClientLoyalty',N'U') AS LoyaltyTable,
     OBJECT_ID(N'dbo.TblLoyaltyPointLedger',N'U') AS LedgerTable,
     OBJECT_ID(N'dbo.TblClientInventory',N'U') AS InventoryTable,
     OBJECT_ID(N'dbo.TblLoyaltyStoreItem',N'U') AS ItemTable,
     OBJECT_ID(N'dbo.TblLoyaltyTier',N'U') AS TierTable,
     COL_LENGTH(N'dbo.TblClient',N'TenantId') AS ClientTenantColumn,
     COL_LENGTH(N'dbo.TblClient',N'ClientID') AS ClientIDColumn,
     COL_LENGTH(N'dbo.TblClient',N'Mobile') AS ClientPhoneColumn,
     COL_LENGTH(N'dbo.TblClientLoyalty',N'PointsBalance') AS CoinsColumn,
     COL_LENGTH(N'dbo.TblClientLoyalty',N'IsActive') AS LoyaltyActiveColumn,
     COL_LENGTH(N'dbo.TblClientInventory',N'PurchasedAt') AS InventoryDateColumn,
     COL_LENGTH(N'dbo.TblClientInventory',N'ExpiresAt') AS VoucherExpiryColumn,
     COL_LENGTH(N'dbo.TblLoyaltyPointLedger',N'ClientLoyaltyID') AS LedgerLoyaltyColumn,
     COL_LENGTH(N'dbo.TblLoyaltyPointLedger',N'PointsDelta') AS LedgerDeltaColumn,
     COL_LENGTH(N'dbo.TblLoyaltyPointLedger',N'CreatedAt') AS LedgerDateColumn
  `);
  const row=result.recordset[0];
  const shape=Object.fromEntries(Object.entries(row).map(([k,v])=>[k,v!==null && v!==undefined]));
  console.log('CUT CLUB STAGING TABLE/COLUMN CONTRACT (presence booleans only):',JSON.stringify(shape));
  const missing=Object.entries(shape).filter(([,exists])=>!exists).map(([name])=>name);
  if(missing.length){
    console.error('CUT_CLUB_STAGE_SCHEMA_UNPROVEN: Missing '+missing.join(', '));
    process.exitCode=2;return;
  }
  // Compile the exact wallet projections with zero real customer rows:
  // SQL Server validates every selected column, join and client/tenant predicate.
  const tenant='413d433e-f36b-1410-8820-009ec495c7e1';
  const walletQueries=[
    ['customer/loyalty/tier',`
      SELECT TOP (0) c.ClientID,c.Name AS ClientName,
        cl.ClientLoyaltyID,cl.PointsBalance,lt.TierNameAr,cl.TotalVisits
      FROM dbo.TblClient c
      LEFT JOIN dbo.TblClientLoyalty cl ON cl.ClientID=c.ClientID AND cl.IsActive=1
      LEFT JOIN dbo.TblLoyaltyTier lt ON lt.TierID=cl.TierID
      WHERE c.TenantId=@tenant AND c.ClientID=@clientId`],
    ['inventory/voucher',`
      SELECT TOP (0) i.InventoryID,s.NameAr,i.Status,i.ExpiresAt
      FROM dbo.TblClientInventory i
      JOIN dbo.TblClient c ON c.ClientID=i.ClientID AND c.TenantId=@tenant
      JOIN dbo.TblLoyaltyStoreItem s ON s.ItemID=i.ItemID
      WHERE i.ClientID=@clientId
      ORDER BY i.PurchasedAt DESC,i.InventoryID DESC`],
    ['ledger/movements',`
      SELECT TOP (0) l.LedgerID,l.MovementType,l.PointsDelta,l.CreatedAt
      FROM dbo.TblLoyaltyPointLedger l
      JOIN dbo.TblClient c ON c.ClientID=l.ClientID AND c.TenantId=@tenant
      WHERE l.ClientID=@clientId AND l.ClientLoyaltyID=@loyaltyId
      ORDER BY l.CreatedAt DESC,l.LedgerID DESC`],
  ];
  for(const [label,query] of walletQueries){
    const r=await pool.request()
      .input('tenant',sql.UniqueIdentifier,tenant)
      .input('clientId',sql.Int,0)
      .input('loyaltyId',sql.Int,0)
      .query(query);
    if(r.recordset.length!==0)throw Error('STAGING_WALLET_ZERO_ROW_SMOKE_RETURNED_DATA');
    console.log('CUT CLUB STAGING SQL WALLET COMPILE PASS:',label);
  }
  const tenantIdentity=await pool.request()
    .input('tenant',sql.UniqueIdentifier,tenant)
    .query(`SELECT COUNT_BIG(*) AS C FROM dbo.Tenant WHERE TenantId=@tenant`);
  if(Number(tenantIdentity.recordset[0]?.C)!==1)
    throw Error('CUT_CLUB_STAGE_CONFIGURED_TENANT_NOT_FOUND');
  console.log('CUT CLUB STAGING CONFIGURED TENANT EXISTS: true (identity label requires operator signoff)');
  const count=await pool.request().query(`
     SELECT COUNT_BIG(*) AS ClientRows,
       COUNT(DISTINCT TenantId) AS DistinctTenantIDs
     FROM dbo.TblClient
  `);
  console.log('CUT CLUB STAGING AGGREGATES:',JSON.stringify({
    clientRows:Number(count.recordset[0].ClientRows),
    distinctTenantIds:count.recordset[0].DistinctTenantIDs,
  }));
  if(count.recordset[0].DistinctTenantIDs<1)
    throw Error('CUT_CLUB_STAGE_LEGACY_TENANT_OWNERSHIP_UNPROVEN');
  console.log('CUT CLUB STAGING READ-ONLY PREFLIGHT PASS; NO WRITES');
 }finally{await pool.close();}
}
main().catch(e=>{console.error('CUT CLUB STAGING READ-ONLY PREFLIGHT FAIL:',e.message);process.exitCode=1;});
