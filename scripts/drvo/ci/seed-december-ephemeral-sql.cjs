// Disposable SQL extension: only after the existing CUT CLUB localhost seed.
const fs=require('node:fs');
const sql=require('mssql');
if(process.env.CI!=='true'||process.env.DECEMBER_EPHEMERAL_SQL!=='1'||process.env.CUT_CLUB_EPHEMERAL_SQL!=='1'||process.env.CUT_CLUB_EPHEMERAL_HOST!=='127.0.0.1'||!process.env.CUT_CLUB_EPHEMERAL_AGENT_PASSWORD||process.env.DB_SERVER||process.env.CLOUD_DB_SERVER)throw Error('DECEMBER_UNSAFE_FIXTURE');
async function main(){
 const pool=await new sql.ConnectionPool({server:'127.0.0.1',port:1433,database:'last132_agent',user:'drvo_agent',password:process.env.CUT_CLUB_EPHEMERAL_AGENT_PASSWORD,options:{encrypt:false,trustServerCertificate:true}}).connect();
 try{
 const r=await pool.request().query("SELECT DB_NAME() db,SUSER_SNAME() login");
 if(r.recordset[0]?.db!=='last132_agent'||r.recordset[0]?.login!=='drvo_agent')throw Error('DECEMBER_UNSAFE_DB');
 await pool.request().query(`
 IF OBJECT_ID(N'dbo.TblinvServHead',N'U') IS NOT NULL THROW 51901,'DECEMBER_FIXTURE_ALREADY_EXISTS',1;
 UPDATE dbo.Tenant SET Code=N'CASHER_BOOT' WHERE TenantId='413d433e-f36b-1410-8820-009ec495c7e1' AND Code=N'CUT_SALON_TEST';
 CREATE TABLE dbo.Location(TenantId UNIQUEIDENTIFIER NOT NULL,LegacyBranchId INT NOT NULL,Status NVARCHAR(16) NOT NULL,PRIMARY KEY(TenantId,LegacyBranchId));
 CREATE TABLE dbo.TblCat(CatID INT PRIMARY KEY,TenantId UNIQUEIDENTIFIER NOT NULL,CatType VARCHAR(16));
 CREATE TABLE dbo.TblPro(ProID INT PRIMARY KEY,TenantId UNIQUEIDENTIFIER NOT NULL,CatID INT NOT NULL,SPrice1 DECIMAL(10,2) NOT NULL,isDeleted BIT NOT NULL DEFAULT 0);
 CREATE TABLE dbo.TblinvServHead(invID INT NOT NULL,invType NVARCHAR(20) NOT NULL,ClientID INT NOT NULL,BranchID INT NOT NULL,SubTotal DECIMAL(10,2) NOT NULL,DisVal DECIMAL(10,2) NOT NULL,GrandTotal DECIMAL(10,2) NOT NULL,PayDue DECIMAL(10,2) NOT NULL,isActive NVARCHAR(5) NULL,TotalBonus DECIMAL(10,2) NOT NULL DEFAULT(0),PRIMARY KEY(invID,invType));
 CREATE TABLE dbo.TblinvServDetail(invID INT NOT NULL,invType NVARCHAR(20) NOT NULL,ProID INT NOT NULL,SPriceAfterDis DECIMAL(10,2) NOT NULL,Bonus DECIMAL(10,2) NOT NULL DEFAULT(0));
 CREATE TABLE dbo.TblCashMove(invID INT NOT NULL,invType NVARCHAR(20) NOT NULL);
 CREATE TABLE dbo.TblinvServPayment(invID INT NOT NULL,invType NVARCHAR(20) NOT NULL);
 DECLARE @t UNIQUEIDENTIFIER='413d433e-f36b-1410-8820-009ec495c7e1';
 INSERT dbo.Location VALUES(@t,1,'active'),(@t,2,'active');
 INSERT dbo.TblCat VALUES(1,@t,'service'),(2,@t,'pro');
 INSERT dbo.TblPro(ProID,TenantId,CatID,SPrice1) VALUES(9,@t,1,200),(11,@t,1,100),(99,@t,2,50);
 INSERT dbo.TblClient(ClientID,TenantId,Mobile,Name) VALUES(101,@t,'01000000101',N'Fixture owner'),(102,@t,'01000000102',N'Fixture friend'),(103,@t,'01000000103',N'Fixture old customer'),(104,@t,'01000000104',N'Fixture zero'),(105,@t,'01000000105',N'Fixture other');
 `);
 // Apply the actual prerequisite profile migration in its original SQL batches.
 for(const batch of fs.readFileSync('db/drvo-migrations/025-customer-education-occupation-profile/schema.sql','utf8').split(/^GO\s*$/mi)){
  if(batch.trim())await pool.request().batch(batch);
 }
 for(const name of ['027-cut-offer-campaign','028-cut-education-catalog','029-cut-offer-operations']){
 await pool.request().query(fs.readFileSync('db/drvo-migrations/'+name+'/schema.sql','utf8'));
 }
 console.log('December disposable SQL schema applied (027–029); synthetic minimal legacy tables only');
 }finally{await pool.close();}
}
main().catch(e=>{console.error('Fixture failed:',e.message);process.exitCode=1;});
