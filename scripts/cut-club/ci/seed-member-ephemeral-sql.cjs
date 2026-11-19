/**
 * Disposable GitHub Actions SQL-Server fixture only.
 * NEVER accepts a remote host. Only 127.0.0.1 in an isolated runner.
 * Never uses staging/production DB credentials.
 */
const fs=require('node:fs');
const sql=require('mssql');
const host='127.0.0.1';
const saPassword=process.env.CUT_CLUB_EPHEMERAL_SA_PASSWORD;
const agentPassword=process.env.CUT_CLUB_EPHEMERAL_AGENT_PASSWORD;
if(process.env.CUT_CLUB_EPHEMERAL_SQL!=='1' || !saPassword || !agentPassword ||
  process.env.CI!=='true' || process.env.CUT_CLUB_EPHEMERAL_HOST!==host){
  throw Error('CUT_CLUB_SQL_FIXTURE_REFUSES_UNSAFE_ENVIRONMENT');
}
function config(user,password,database='master') {
  return {server:host,port:1433,database,user,password,
    options:{encrypt:false,trustServerCertificate:true,enableArithAbort:true},
    connectionTimeout:2000,requestTimeout:30000,pool:{max:5,min:0,idleTimeoutMillis:5000}};
}
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function connect(cfg) {
  for(let i=0;i<60;i++){
    try{return await new sql.ConnectionPool(cfg).connect();}
    catch(e){if(i===59)throw e;await sleep(2000);}
  }
}
async function main(){
  const master=await connect(config('sa',saPassword));
  try{
    await master.request().query(`
      IF DB_ID(N'last132_agent') IS NOT NULL
        THROW 51900,'CUT_CLUB_DISPOSABLE_DB_MUST_NOT_EXIST',1;
      CREATE DATABASE [last132_agent];
    `);
    await master.request().query(`
      CREATE LOGIN [drvo_agent] WITH PASSWORD = '${agentPassword.replaceAll("'","''")}',CHECK_POLICY=OFF;
    `);
  }finally{await master.close();}
  const sa=await connect(config('sa',saPassword,'last132_agent'));
  try{
    await sa.request().query(`
      CREATE USER [drvo_agent] FOR LOGIN [drvo_agent];
      ALTER ROLE db_owner ADD MEMBER [drvo_agent];
      CREATE TABLE dbo.Tenant(TenantId UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,Code NVARCHAR(64) NOT NULL UNIQUE,Status NVARCHAR(16) NOT NULL);
      CREATE TABLE dbo.TblClient(
        ClientID INT NOT NULL PRIMARY KEY, TenantId UNIQUEIDENTIFIER NOT NULL,
        Mobile NVARCHAR(30) NOT NULL, Name NVARCHAR(100) NULL
      );
      CREATE TABLE dbo.TblLoyaltyTier(
        TierID INT NOT NULL PRIMARY KEY, TierNameAr NVARCHAR(100) NULL
      );
      CREATE TABLE dbo.TblClientLoyalty(
        ClientLoyaltyID INT NOT NULL PRIMARY KEY, ClientID INT NOT NULL,
        PointsBalance DECIMAL(18,2) NULL, TierID INT NULL,
        TotalVisits INT NULL, IsActive BIT NOT NULL DEFAULT(1)
      );
      CREATE TABLE dbo.TblLoyaltyStoreItem(
        ItemID INT NOT NULL PRIMARY KEY, NameAr NVARCHAR(100) NULL
      );
      CREATE TABLE dbo.TblClientInventory(
        InventoryID INT NOT NULL PRIMARY KEY, ClientID INT NOT NULL, ItemID INT NOT NULL,
        Status VARCHAR(24) NOT NULL, ExpiresAt DATETIME2 NULL,
        PurchasedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
      );
      CREATE TABLE dbo.TblLoyaltyPointLedger(
        LedgerID INT NOT NULL PRIMARY KEY, ClientID INT NOT NULL,
        ClientLoyaltyID INT NOT NULL, MovementType VARCHAR(50) NOT NULL,
        PointsDelta DECIMAL(18,2) NOT NULL, CreatedAt DATETIME2 NOT NULL
      );
      INSERT dbo.Tenant(TenantId,Code,Status) VALUES
        ('413d433e-f36b-1410-8820-009ec495c7e1','CUT_SALON_TEST','active'),
        ('513d433e-f36b-1410-8820-009ec495c7e2','FOREIGN_TEST','active');
      INSERT dbo.TblClient(ClientID,TenantId,Mobile,Name) VALUES
        (7,'413d433e-f36b-1410-8820-009ec495c7e1','01557994946',N'عميل تجريبي'),
        (8,'413d433e-f36b-1410-8820-009ec495c7e1','01557994946',N'سجل ثانٍ'),
        (70,'513d433e-f36b-1410-8820-009ec495c7e2','01557994946',N'عميل مستأجر آخر');
      INSERT dbo.TblLoyaltyTier VALUES(1,N'ذهبي');
      INSERT dbo.TblClientLoyalty(ClientLoyaltyID,ClientID,PointsBalance,TierID,TotalVisits)
        VALUES(1007,7,225.75,1,8),(1008,8,810.00,1,3),(1070,70,9000.00,1,2);
      INSERT dbo.TblLoyaltyStoreItem VALUES(15,N'ماسك وجه');
      INSERT dbo.TblClientInventory(InventoryID,ClientID,ItemID,Status,PurchasedAt)
        VALUES(31,7,15,'ACTIVE',SYSUTCDATETIME()),
              (32,8,15,'ACTIVE',SYSUTCDATETIME()),
              (33,70,15,'ACTIVE',SYSUTCDATETIME());
      INSERT dbo.TblLoyaltyPointLedger
        (LedgerID,ClientID,ClientLoyaltyID,MovementType,PointsDelta,CreatedAt)
        VALUES(51,7,1007,'EARN_SALE',25.25,SYSUTCDATETIME()),
              (52,8,1008,'EARN_SALE',2.00,SYSUTCDATETIME()),
              (53,70,1070,'EARN_SALE',999.00,SYSUTCDATETIME());
    `);
  }finally{await sa.close();}
  const agent=await connect(config('drvo_agent',agentPassword,'last132_agent'));
  try{
    const migration=fs.readFileSync('scripts/cut-club/sql/member-wallet-staging-schema.sql','utf8');
    const result=await agent.request().query(migration);
    if(!JSON.stringify(result.recordset).includes('CUT_CLUB_OTP_STAGING_SCHEMA_READY'))
      throw Error('CUT_CLUB_MEMBER_MIGRATION_DID_NOT_REPORT_SUCCESS');
    console.log('CUT CLUB isolated SQL fixture+STAGING-GUARDED member migration PASS');
  }finally{await agent.close();}
}
main().catch(err=>{console.error('Isolated SQL fixture failed:',err.message);process.exitCode=1;});
