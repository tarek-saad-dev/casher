/** Isolated GitHub Actions SQL 2022 only — never runs on a real salon DB. */
const fs=require('node:fs');
const sql=require('mssql');
const host='127.0.0.1',sa=process.env.CUT_CLUB_CLAIM_EPHEMERAL_SA_PASSWORD,agent=process.env.CUT_CLUB_CLAIM_EPHEMERAL_AGENT_PASSWORD;
if(process.env.CI!=='true'||process.env.CUT_CLUB_CLAIM_EPHEMERAL_SQL!=='1'||
  process.env.CUT_CLUB_CLAIM_EPHEMERAL_HOST!==host||!sa||!agent||
  process.env.CLOUD_DB_SERVER||process.env.DB_SERVER)
  throw Error('CLAIM_SQL_FIXTURE_REFUSES_UNSAFE_ENV');
const cfg=(u,p,db='master')=>({server:host,port:1433,database:db,user:u,password:p,
  options:{encrypt:false,trustServerCertificate:true},connectionTimeout:2500,requestTimeout:30000,
  pool:{max:10,min:0,idleTimeoutMillis:5000}});
const delay=n=>new Promise(r=>setTimeout(r,n));
async function pool(config){
  for(let i=0;i<60;i++){
    try{return await new sql.ConnectionPool(config).connect();}
    catch(e){if(i===59)throw e;await delay(1500);}
  }
}
async function main(){
  const root=await pool(cfg('sa',sa));
  try{
    await root.request().query(`
      IF DB_ID(N'last132_agent') IS NOT NULL THROW 51991,'CLAIM_SQL_COLLISION',1;
      CREATE DATABASE last132_agent;
    `);
    await root.request().query(`CREATE LOGIN drvo_agent WITH PASSWORD='${agent.replaceAll("'","''")}',CHECK_POLICY=OFF;`);
  }finally{await root.close();}
  const db=await pool(cfg('sa',sa,'last132_agent'));
  try{
    await db.request().query(`
      CREATE USER drvo_agent FOR LOGIN drvo_agent;
      ALTER ROLE db_owner ADD MEMBER drvo_agent;
      CREATE TABLE dbo.TblClient(ClientID INT NOT NULL PRIMARY KEY,TenantId UNIQUEIDENTIFIER NOT NULL);
      CREATE TABLE dbo.TblPro(ProID INT NOT NULL PRIMARY KEY,TenantId UNIQUEIDENTIFIER NOT NULL,isDeleted BIT NOT NULL);
      CREATE TABLE dbo.TblLoyaltyStoreItem(
        ItemID INT NOT NULL PRIMARY KEY,ItemType NVARCHAR(40) NOT NULL,
        ServiceID INT NULL,SalonID INT NULL,IsActive BIT NOT NULL);
      CREATE TABLE dbo.TblClientInventory(
        InventoryID INT NOT NULL PRIMARY KEY,ClientID INT NOT NULL,ItemID INT NOT NULL,
        Quantity INT NOT NULL,Status NVARCHAR(24) NOT NULL,
        UsedInvID INT NULL,ExpiresAt DATETIME2 NULL,VoucherCode NVARCHAR(100) NOT NULL UNIQUE,
        UsedAt DATETIME NULL,PurchasedAt DATETIME NOT NULL DEFAULT GETDATE());
      CREATE TABLE dbo.TblinvServHead(
        invID INT NOT NULL PRIMARY KEY,invType NVARCHAR(30) NOT NULL,
        ClientID INT NOT NULL,BranchID INT NOT NULL);
      CREATE TABLE dbo.TblinvServDetail(
        invID INT NOT NULL,invType NVARCHAR(30) NOT NULL,ProID INT NOT NULL,
        SPrice DECIMAL(18,2) NOT NULL,SPriceAfterDis DECIMAL(18,2) NOT NULL,
        Qty INT NOT NULL);
      CREATE TABLE dbo.TblInventoryUsageLog(
        UsageID INT IDENTITY(1,1) PRIMARY KEY,InventoryID INT NOT NULL,
        ClientID INT NOT NULL,InvID INT NULL,BookingID INT NULL,
        ActionType NVARCHAR(50) NOT NULL,UsedAt DATETIME NOT NULL,Notes NVARCHAR(500) NULL);
      INSERT dbo.TblClient VALUES
        (7,'413d433e-f36b-1410-8820-009ec495c7e1'),
        (8,'413d433e-f36b-1410-8820-009ec495c7e1');
      INSERT dbo.TblPro VALUES(39,'413d433e-f36b-1410-8820-009ec495c7e1',0);
      INSERT dbo.TblLoyaltyStoreItem VALUES(15,'FREE_SERVICE',39,NULL,1);
      INSERT dbo.TblClientInventory(InventoryID,ClientID,ItemID,Quantity,Status,VoucherCode)
        VALUES(31,7,15,1,N'ACTIVE',N'CUT-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
    `);
  }finally{await db.close();}
  const local=await pool(cfg('drvo_agent',agent,'last132_agent'));
  try{
    await local.request().query(fs.readFileSync('docs/cut-club/sql/cashier-invoice-claim-staging-only.sql','utf8'));
    const r=await local.request().query(`
      SELECT DB_NAME() AS Db,SUSER_SNAME() AS LoginName,
        OBJECT_ID(N'dbo.CutClubVoucherInvoiceClaim',N'U') AS Claim
    `);
    if(r.recordset[0]?.Db!=='last132_agent'||r.recordset[0]?.LoginName!=='drvo_agent'||!r.recordset[0]?.Claim)
      throw Error('STAGE_CLAIM_SCHEMA_UNAVAILABLE');
    console.log('Disposable CUT CLUB invoice voucher claim stage ready');
  }finally{await local.close();}
}
main().catch(e=>{console.error('CUT CLUB claim ephemeral fixture failed:',e.message);process.exitCode=1;});
