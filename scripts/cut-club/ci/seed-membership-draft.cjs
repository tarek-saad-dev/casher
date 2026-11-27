// Disposable localhost SQL only; refuse ambient DB settings.
const sql=require('mssql'),fs=require('node:fs');
const host='127.0.0.1',sa=process.env.MEMBERSHIP_EPHEMERAL_SA,agent=process.env.MEMBERSHIP_EPHEMERAL_AGENT;
if(process.env.CI!=='true'||process.env.MEMBERSHIP_EPHEMERAL_SQL!=='1'||process.env.MEMBERSHIP_EPHEMERAL_HOST!==host||process.env.DB_SERVER||process.env.CLOUD_DB_SERVER||!sa||!agent)throw Error('UNSAFE_FIXTURE');
const cfg=(user,password,database)=>({server:host,port:1433,user,password,database,options:{encrypt:false,trustServerCertificate:true},connectionTimeout:2500,requestTimeout:30000});
async function connect(c){for(let i=0;i<60;i++){try{return await new sql.ConnectionPool(c).connect();}catch(e){if(i===59)throw e;await new Promise(r=>setTimeout(r,1500));}}}
async function run(){
 const root=await connect(cfg('sa',sa,'master'));
 try{
 await root.request().query("IF DB_ID(N'last132_agent') IS NOT NULL THROW 52210,'DB_COLLISION',1; CREATE DATABASE last132_agent;");
 await root.request().query("CREATE LOGIN drvo_agent WITH PASSWORD='"+agent.replaceAll("'","''")+"',CHECK_POLICY=OFF;");
 }finally{await root.close();}
 const db=await connect(cfg('sa',sa,'last132_agent'));
 try{await db.request().query(`
 CREATE USER drvo_agent FOR LOGIN drvo_agent; ALTER ROLE db_owner ADD MEMBER drvo_agent;
 CREATE TABLE dbo.Tenant(TenantId UNIQUEIDENTIFIER PRIMARY KEY,Code NVARCHAR(64) NOT NULL,Status NVARCHAR(16) NOT NULL);
 INSERT dbo.Tenant VALUES('413d433e-f36b-1410-8820-009ec495c7e1','CASHER_BOOT','active'),
 ('11111111-1111-4111-8111-111111111111','OTHER','active');
 CREATE TABLE dbo.TblClient(ClientID INT PRIMARY KEY,TenantId UNIQUEIDENTIFIER NOT NULL,Mobile NVARCHAR(32) NOT NULL);
 CREATE TABLE dbo.TblClientLoyalty(ClientLoyaltyID INT PRIMARY KEY,ClientID INT NOT NULL,TotalVisits INT NULL,IsActive BIT NOT NULL);
 INSERT dbo.TblClientLoyalty VALUES(1,7,3,1);
 CREATE TABLE dbo.CutClubMemberAccount(AccountID UNIQUEIDENTIFIER PRIMARY KEY,TenantId UNIQUEIDENTIFIER NOT NULL,
 PhoneNormalized NVARCHAR(20) NOT NULL,LegacyClientID INT NULL,LinkStatus VARCHAR(24) NOT NULL,AccessStatus VARCHAR(16) NOT NULL);
 INSERT dbo.TblClient VALUES(7,'413d433e-f36b-1410-8820-009ec495c7e1','01000000000'),
 (8,'413d433e-f36b-1410-8820-009ec495c7e1','01000000000'),
 (9,'11111111-1111-4111-8111-111111111111','01000000001');
 INSERT dbo.CutClubMemberAccount VALUES
 ('22222222-2222-4222-8222-222222222222','413d433e-f36b-1410-8820-009ec495c7e1','201000000000',7,'ACTIVE','ENABLED'),
 ('33333333-3333-4333-8333-333333333333','11111111-1111-4111-8111-111111111111','201000000001',9,'ACTIVE','ENABLED');`);}finally{await db.close();}
 const local=await connect(cfg('drvo_agent',agent,'last132_agent'));
 try{await local.request().query(fs.readFileSync('docs/cut-club/sql/membership-draft-staging-only.sql','utf8'));await local.request().query(fs.readFileSync('docs/cut-club/sql/membership-proof-staging-only.sql','utf8'));await local.request().query(fs.readFileSync('docs/cut-club/sql/membership-trial-staging-only.sql','utf8'));}finally{await local.close();}
 console.log('Disposable membership draft schema ready');
}
run().catch(e=>{console.error(e.message);process.exitCode=1;});
