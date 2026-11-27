/**
 * CUT CLUB reward financial integration fixture.
 * Only disposable localhost SQL 2022 container on GitHub Actions; never a VPS.
 */
const fs=require('node:fs');
const sql=require('mssql');
const host='127.0.0.1';
const saPass=process.env.CUT_CLUB_REWARD_EPHEMERAL_SA_PASSWORD;
const agentPass=process.env.CUT_CLUB_REWARD_EPHEMERAL_AGENT_PASSWORD;
if(process.env.CI!=='true'||process.env.CUT_CLUB_REWARD_EPHEMERAL_SQL!=='1'||
   process.env.CUT_CLUB_REWARD_EPHEMERAL_HOST!==host||!saPass||!agentPass||
   process.env.CLOUD_DB_SERVER||process.env.DB_SERVER)
  throw Error('CUT_CLUB_FINANCIAL_FIXTURE_REFUSES_UNSAFE_ENV');
const config=(user,password,db='master')=>({
  server:host,port:1433,database:db,user,password,
  options:{encrypt:false,trustServerCertificate:true,enableArithAbort:true},
  connectionTimeout:2500,requestTimeout:30000,pool:{max:10,min:0},
});
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function connect(cfg){
  for(let i=0;i<60;i++){
    try{return await new sql.ConnectionPool(cfg).connect();}
    catch(e){if(i===59)throw e;await sleep(1500);}
  }
}
async function run(){
  const root=await connect(config('sa',saPass));
  try{
    await root.request().query(`
      IF DB_ID(N'last132_agent') IS NOT NULL
        THROW 51950,'REWARD_EPHEMERAL_DB_COLLISION',1;
      CREATE DATABASE last132_agent;
    `);
    await root.request().query(`CREATE LOGIN drvo_agent WITH PASSWORD='${agentPass.replaceAll("'","''")}',CHECK_POLICY=OFF;`);
  }finally{await root.close();}
  const db=await connect(config('sa',saPass,'last132_agent'));
  try{
    await db.request().query(`
      CREATE USER drvo_agent FOR LOGIN drvo_agent;
      ALTER ROLE db_owner ADD MEMBER drvo_agent;
      CREATE TABLE dbo.Tenant(TenantId UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
        Code NVARCHAR(64) NOT NULL,Status NVARCHAR(16) NOT NULL);
      CREATE TABLE dbo.TblClient(ClientID INT NOT NULL PRIMARY KEY,TenantId UNIQUEIDENTIFIER NOT NULL);
      CREATE TABLE dbo.TblBranch(BranchID INT NOT NULL PRIMARY KEY,BranchName NVARCHAR(100) NOT NULL);
      CREATE TABLE dbo.TblPro(ProID INT NOT NULL PRIMARY KEY,TenantId UNIQUEIDENTIFIER NOT NULL,isDeleted BIT NOT NULL DEFAULT(0));
      CREATE TABLE dbo.TblLoyaltyTier(TierID INT NOT NULL PRIMARY KEY,SortOrder INT NOT NULL,IsActive BIT NOT NULL);
      CREATE TABLE dbo.TblClientLoyalty(
        ClientLoyaltyID INT NOT NULL PRIMARY KEY,ClientID INT NOT NULL,PointsBalance DECIMAL(18,2) NOT NULL,
        TierID INT NOT NULL,IsActive BIT NOT NULL,UpdatedAt DATETIME NOT NULL DEFAULT GETDATE());
      CREATE TABLE dbo.TblLoyaltyStoreItem(
        ItemID INT NOT NULL PRIMARY KEY,SalonID INT NULL,ServiceID INT NULL,ItemType NVARCHAR(50) NOT NULL,
        PriceCoins DECIMAL(18,2) NOT NULL,MinTierID INT NULL,IsActive BIT NOT NULL,
        UnlimitedStock BIT NOT NULL,StockQuantity INT NULL,ExpiresAfterDays INT NULL,
        UpdatedAt DATETIME NOT NULL DEFAULT GETDATE());
      CREATE TABLE dbo.TblClientInventory(
        InventoryID INT IDENTITY(1,1) NOT NULL PRIMARY KEY,ClientID INT NOT NULL,ItemID INT NOT NULL,
        Quantity INT NOT NULL,Status NVARCHAR(24) NOT NULL,PurchasePriceCoins DECIMAL(18,2) NOT NULL,
        VoucherCode NVARCHAR(100) NOT NULL UNIQUE,PurchasedAt DATETIME NOT NULL,
        ExpiresAt DATETIME2 NULL);
      CREATE TABLE dbo.TblLoyaltyPointLedger(
        LedgerID INT IDENTITY(1,1) PRIMARY KEY,ClientID INT NOT NULL,ClientLoyaltyID INT NOT NULL,
        MovementType NVARCHAR(40) NOT NULL,PointsDelta DECIMAL(18,2) NOT NULL,
        PointsBefore DECIMAL(18,2) NOT NULL,PointsAfter DECIMAL(18,2) NOT NULL,
        IdempotencyKey NVARCHAR(100) NOT NULL,CreatedAt DATETIME NOT NULL);
      INSERT dbo.Tenant VALUES('413d433e-f36b-1410-8820-009ec495c7e1','CASHER_BOOT','active');
      INSERT dbo.TblClient VALUES(7,'413d433e-f36b-1410-8820-009ec495c7e1');
      INSERT dbo.TblBranch VALUES(1,N'جليم – سابا باشا');
      INSERT dbo.TblPro VALUES(39,'413d433e-f36b-1410-8820-009ec495c7e1',0);
      INSERT dbo.TblLoyaltyTier VALUES(1,1,1);
      INSERT dbo.TblClientLoyalty(ClientLoyaltyID,ClientID,PointsBalance,TierID,IsActive)
        VALUES(100,7,500,1,1);
      INSERT dbo.TblLoyaltyStoreItem(ItemID,SalonID,ServiceID,ItemType,PriceCoins,
        MinTierID,IsActive,UnlimitedStock,StockQuantity,ExpiresAfterDays)
        VALUES(15,NULL,39,'FREE_SERVICE',200,1,1,0,1,30);
    `);
  }finally{await db.close();}
  const agent=await connect(config('drvo_agent',agentPass,'last132_agent'));
  try{
    await agent.request().query(fs.readFileSync('docs/cut-club/sql/reward-command-staging-v2.sql','utf8'));
    const exists=await agent.request().query(`
      SELECT DB_NAME() AS Db,SUSER_SNAME() AS LoginName,
        OBJECT_ID(N'dbo.CutClubRewardCommand',N'U') AS ObjectID
    `);
    const r=exists.recordset[0];
    if(r.Db!=='last132_agent'||r.LoginName!=='drvo_agent'||!r.ObjectID)
      throw Error('STAGING_COMMAND_SCHEMA_UNAVAILABLE');
    console.log('CUT CLUB reward isolated financial schema PASS');
  }finally{await agent.close();}
}
run().catch(e=>{console.error('Ephemeral CUT CLUB reward fixture failed:',e.message);process.exitCode=1;});
