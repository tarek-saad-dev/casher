/**
 * CUT CLUB isolated SQL acceptance: REAL mssql transactions, NEVER shared staging
 * or production. GitHub Actions starts a disposable SQL Server service container.
 *
 * This proves the stageVoucherOnNewSale / reverseStagingClaimBeforeSaleDeletion
 * functions against exact, synthetic tenant+service fixtures. It is NOT POS HTTP E2E.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import sql from "mssql";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  CUT_CLUB_CASHER_BOOT_TENANT,
  denyEditOfStagingClaimedSale,
  reverseStagingClaimBeforeSaleDeletion,
  stageVoucherOnNewSale,
} from "@/lib/cut-club/stagingInvoiceClaim";

const TENANT = CUT_CLUB_CASHER_BOOT_TENANT;
const FOREIGN_TENANT = "18cb423e-f36b-1410-8822-009ec495c7e1";
const DB = "last132_agent";
const LOGIN = "drvo_agent";
const adminPassword = process.env.CUT_CLUB_SQL_SA_PASSWORD || "";
const loginPassword = process.env.CUT_CLUB_SQL_LOGIN_PASSWORD || "";
let stage: sql.ConnectionPool | undefined;
let admin: sql.ConnectionPool | undefined;
let nextInventory = 100;
let nextInvoice = 1000;

const config = (database: string, user: string, password: string): sql.config => ({
  server: "127.0.0.1",
  port: 1433,
  database, user, password,
  options: { encrypt: false, trustServerCertificate: true, enableArithAbort: true },
  pool: { min: 0, max: 8 },
  connectionTimeout: 5000, requestTimeout: 24000,
});
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function query(statement: string) {
  if (!stage) throw Error("STAGE_TEST_POOL_MISSING");
  return stage.request().query(statement);
}
async function issueVoucher(clientId = 42, itemId = 17, options?: {
  status?: "ACTIVE" | "USED"; expires?: string; quantity?: number;
}) {
  const id = nextInventory++;
  const code = "CC-ISOLATED-" + String(id);
  await stage!.request()
    .input("id", sql.Int, id).input("client", sql.Int, clientId)
    .input("item", sql.Int, itemId).input("code", sql.NVarChar(100), code)
    .input("status", sql.NVarChar(20), options?.status || "ACTIVE")
    .input("qty", sql.Int, options?.quantity || 1)
    .input("expiry", sql.DateTime, options?.expires ? new Date(options.expires) : null)
    .query("INSERT dbo.TblClientInventory (InventoryID, ClientID, ItemID, Quantity, Status, UsedInvID, ExpiresAt, VoucherCode) VALUES (@id,@client,@item,@qty,@status,NULL,@expiry,@code)");
  return { id, code };
}
type SaleOptions = {
  code: string; client?: number; branch?: number; tenant?: string;
  service?: number; price?: number; after?: number; qty?: number;
  duplicateLine?: boolean;
};
async function sale(input: SaleOptions) {
  const inv = nextInvoice++;
  const tx = new sql.Transaction(stage!);
  await tx.begin();
  try {
    const client = input.client ?? 42;
    const branch = input.branch ?? 1;
    const service = input.service ?? 11;
    const price = input.price ?? 200;
    const after = input.after ?? 0;
    const qty = input.qty ?? 1;
    await new sql.Request(tx)
      .input("inv", sql.Int, inv).input("client", sql.Int, client)
      .input("branch", sql.Int, branch)
      .query("INSERT dbo.TblinvServHead(invID, invType, ClientID, BranchID) VALUES (@inv,N'مبيعات',@client,@branch)");
    const line = async () => new sql.Request(tx)
      .input("inv", sql.Int, inv).input("pro", sql.Int, service)
      .input("price", sql.Decimal(12,2), price)
      .input("after", sql.Decimal(12,2), after)
      .input("qty", sql.Int, qty)
      .query("INSERT dbo.TblinvServDetail(invID,invType,ProID,SPrice,SPriceAfterDis,Qty) VALUES (@inv,N'مبيعات',@pro,@price,@after,@qty)");
    await line();
    if (input.duplicateLine) await line();
    await new sql.Request(tx).input("inv", sql.Int, inv)
      .query("INSERT dbo.TestSalePayment(InvID,Amount) VALUES (@inv,0)");
    const applied = await stageVoucherOnNewSale(tx, {
      trustedTenantId: input.tenant ?? TENANT,
      trustedBranchId: branch, trustedClientId: client,
      invoiceId: inv, voucherCode: input.code,
    });
    if (!applied) throw Error("EXPECTED_ATOMIC_CLAIM");
    await tx.commit();
    return { ok: true, inv, error: "" };
  } catch (err) {
    try { await tx.rollback(); } catch { /* XACT_ABORT may have rolled back already */ }
    return { ok: false, inv, error: err instanceof Error ? err.message : String(err) };
  }
}
async function counts(inv: number) {
  const r = await stage!.request().input("inv", sql.Int, inv).query(
    "SELECT (SELECT COUNT(*) FROM dbo.TblinvServHead WHERE invID=@inv) AS Head, " +
    "(SELECT COUNT(*) FROM dbo.TblinvServDetail WHERE invID=@inv) AS Detail, " +
    "(SELECT COUNT(*) FROM dbo.TestSalePayment WHERE InvID=@inv) AS Payment, " +
    "(SELECT COUNT(*) FROM dbo.CutClubVoucherInvoiceClaim WHERE InvID=@inv AND Status=N'APPLIED') AS Applied"
  );
  return r.recordset[0];
}
async function voucherState(id: number) {
  const r = await stage!.request().input("id", sql.Int, id)
    .query("SELECT Status, UsedInvID FROM dbo.TblClientInventory WHERE InventoryID=@id");
  return r.recordset[0];
}

describe("CUT CLUB isolated real SQL voucher+invoice atomic acceptance", () => {
  beforeAll(async () => {
    // The workflow supplies NO SSH credentials or external DB coordinates.
    // Refuse all execution outside the disposable local CI service.
    if (process.env.CUT_CLUB_EPHEMERAL_SQL_E2E !== "true" ||
        process.env.GITHUB_ACTIONS !== "true" ||
        process.env.CUT_CLUB_STAGING_CLAIM_WRITE_ENABLED !== "true" ||
        !adminPassword || !loginPassword ||
        process.env.LOCAL_DB_NAME !== DB ||
        process.env.LOCAL_DB_USER !== LOGIN ||
        process.env.LOCAL_DB_SERVER !== "127.0.0.1" ||
        process.env.LOCAL_DB_PORT !== "1433")
      throw Error("CUT_CLUB_EPHEMERAL_SQL_SAFETY_GATE");

    for (let n = 0; n < 45; n++) {
      try {
        admin = await new sql.ConnectionPool(config("master", "sa", adminPassword)).connect();
        break;
      } catch (e) { if (n === 44) throw e; await sleep(2000); }
    }
    // Only create in newly started ephemeral container; fail on existing DB/login.
    const existing = await admin!.request().query(
      "SELECT DB_ID(N'last132_agent') AS StageDbId, " +
      "(SELECT COUNT(*) FROM sys.sql_logins WHERE name=N'drvo_agent') AS LoginCount"
    );
    if (existing.recordset[0].StageDbId !== null ||
        Number(existing.recordset[0].LoginCount) !== 0)
      throw Error("CUT_CLUB_EPHEMERAL_SQL_NOT_EMPTY");

    await admin!.request().query("CREATE DATABASE [last132_agent]");
    // Passwords supplied only by ephemeral workflow; escaped before SQL literal use.
    const pwd = loginPassword.replace(/'/g, "''");
    await admin!.request().query("CREATE LOGIN [drvo_agent] WITH PASSWORD=N'" + pwd + "', CHECK_POLICY=OFF");
    await admin!.close();
    admin = undefined;
    // The only DB user in this new DB is the expected staging SQL identity.
    const stageAdmin = await new sql.ConnectionPool(config(DB,"sa",adminPassword)).connect();
    try {
      await stageAdmin.request().query(
        "CREATE USER [drvo_agent] FOR LOGIN [drvo_agent]; ALTER ROLE [db_owner] ADD MEMBER [drvo_agent]"
      );
    } finally { await stageAdmin.close(); }
    stage = await new sql.ConnectionPool(config(DB, LOGIN, loginPassword)).connect();
    process.env.CUT_CLUB_STAGING_APPROVED_BRANCHES_JSON = JSON.stringify([TENANT + ":1"]);
    const ctx = await query("SELECT DB_NAME() AS DbName,SUSER_SNAME() AS LoginName");
    expect(ctx.recordset[0]).toMatchObject({ DbName: DB, LoginName: LOGIN });

    const schema = [
      "CREATE TABLE dbo.TblClient(ClientID int NOT NULL PRIMARY KEY,TenantId uniqueidentifier NOT NULL)",
      "CREATE TABLE dbo.TblPro(ProID int NOT NULL PRIMARY KEY,TenantId uniqueidentifier NOT NULL,isDeleted bit NOT NULL)",
      "CREATE TABLE dbo.TblLoyaltyStoreItem(ItemID int NOT NULL PRIMARY KEY,ItemType nvarchar(50) NOT NULL,ServiceID int NULL,SalonID int NULL,IsActive bit NOT NULL)",
      "CREATE TABLE dbo.TblClientInventory(InventoryID int NOT NULL PRIMARY KEY,ClientID int NOT NULL,ItemID int NOT NULL,Quantity int NOT NULL,Status nvarchar(24) NOT NULL,UsedInvID int NULL,UsedAt datetime NULL,ExpiresAt datetime NULL,VoucherCode nvarchar(100) NOT NULL UNIQUE)",
      "CREATE TABLE dbo.TblinvServHead(invID int NOT NULL PRIMARY KEY,invType nvarchar(30) NOT NULL,ClientID int NOT NULL,BranchID int NOT NULL)",
      "CREATE TABLE dbo.TblinvServDetail(LineID int IDENTITY PRIMARY KEY,invID int NOT NULL,invType nvarchar(30) NOT NULL,ProID int NOT NULL,SPrice decimal(12,2) NOT NULL,SPriceAfterDis decimal(12,2) NOT NULL,Qty int NOT NULL)",
      "CREATE TABLE dbo.TestSalePayment(PaymentID int IDENTITY PRIMARY KEY,InvID int NOT NULL,Amount decimal(12,2) NOT NULL)",
      "CREATE TABLE dbo.TblInventoryUsageLog(UsageID int IDENTITY PRIMARY KEY,InventoryID int NOT NULL,ClientID int NOT NULL,InvID int NULL,BookingID int NULL,ActionType nvarchar(30) NOT NULL,UsedAt datetime NOT NULL,Notes nvarchar(500) NULL)",
    ];
    for (const stmt of schema) await query(stmt);
    await stage.request().input("tenant",sql.UniqueIdentifier,TENANT)
      .input("foreign",sql.UniqueIdentifier,FOREIGN_TENANT).query([
        "INSERT dbo.TblClient (ClientID,TenantId) VALUES (42,@tenant),(43,@tenant),(99,@foreign);",
        "INSERT dbo.TblPro(ProID,TenantId,isDeleted) VALUES (9,@tenant,0),(11,@tenant,0),(22,@tenant,0),(39,@tenant,0);",
        "INSERT dbo.TblLoyaltyStoreItem(ItemID,ItemType,ServiceID,SalonID,IsActive) VALUES",
        "(15,N'FREE_SERVICE',NULL,NULL,1),(16,N'FREE_SERVICE',NULL,NULL,1),",
        "(17,N'FREE_SERVICE',NULL,NULL,1),(18,N'FREE_SERVICE',NULL,NULL,1);",
      ].join("\n"));
    const ddl = readFileSync(resolve(process.cwd(),"docs/cut-club/sql/cashier-invoice-claim-staging-only.sql"),"utf8");
    await query("SET ANSI_NULLS ON; SET QUOTED_IDENTIFIER ON; SET ANSI_PADDING ON; " +
      "SET ANSI_WARNINGS ON; SET CONCAT_NULL_YIELDS_NULL ON; SET ARITHABORT ON; " +
      "SET NUMERIC_ROUNDABORT OFF;\n" + ddl);
    const index = await query("SELECT COUNT(*) AS C FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.CutClubVoucherInvoiceClaim') AND is_unique=1 AND has_filter=1");
    expect(index.recordset[0].C).toBe(2);
  }, 180000);

  afterAll(async () => {
    process.env.CUT_CLUB_STAGING_CLAIM_WRITE_ENABLED = "false";
    if (stage) await stage.close();
    if (admin) await admin.close();
  });

  it("commits real invoice, payment, claim, USED voucher, usage; blocks edit; reverses and reissues", async () => {
    const v = await issueVoucher();
    const first = await sale({ code:v.code });
    expect(first.ok,first.error).toBe(true);
    expect(await counts(first.inv)).toMatchObject({Head:1,Detail:1,Payment:1,Applied:1});
    expect(await voucherState(v.id)).toMatchObject({Status:"USED",UsedInvID:first.inv});
    let r = await stage!.request().input("id",sql.Int,v.id).query(
      "SELECT COUNT(*) AS C FROM dbo.TblInventoryUsageLog WHERE InventoryID=@id");
    expect(r.recordset[0].C).toBe(1);
    const denied = new sql.Transaction(stage!); await denied.begin();
    try {
      await expect(denyEditOfStagingClaimedSale(denied,first.inv))
        .rejects.toThrow("CUT_CLUB_CLAIMED_INVOICE_REQUIRES_CANCEL_REISSUE");
    } finally { await denied.rollback(); }
    const cancelled = new sql.Transaction(stage!); await cancelled.begin();
    try {
      expect(await reverseStagingClaimBeforeSaleDeletion(cancelled,{
        trustedTenantId:TENANT,trustedBranchId:1,invoiceId:first.inv
      })).toBe(true);
      await new sql.Request(cancelled).input("inv",sql.Int,first.inv).query(
        "DELETE dbo.TestSalePayment WHERE InvID=@inv; DELETE dbo.TblinvServDetail WHERE invID=@inv; DELETE dbo.TblinvServHead WHERE invID=@inv"
      );
      await cancelled.commit();
    } catch(e) { try {await cancelled.rollback();}catch{} throw e; }
    expect(await voucherState(v.id)).toMatchObject({Status:"ACTIVE",UsedInvID:null});
    expect(await counts(first.inv)).toMatchObject({Head:0,Detail:0,Payment:0,Applied:0});
    const second = await sale({ code:v.code });
    expect(second.ok,second.error).toBe(true);
    expect(second.inv).not.toBe(first.inv);
    expect(await counts(second.inv)).toMatchObject({Head:1,Payment:1,Applied:1});
    r = await stage!.request().input("id",sql.Int,v.id).query(
      "SELECT Status,COUNT(*) AS C FROM dbo.CutClubVoucherInvoiceClaim WHERE InventoryID=@id GROUP BY Status");
    expect(Object.fromEntries(r.recordset.map(x=>[x.Status,x.C]))).toEqual({APPLIED:1,REVERSED:1});
    r = await stage!.request().input("id",sql.Int,v.id).query(
      "SELECT COUNT(*) AS C FROM dbo.TblInventoryUsageLog WHERE InventoryID=@id");
    expect(r.recordset[0].C).toBe(2); // original history preserved
  }, 90000);

  it("rejects ownership/branch/service/expiry/price/replay with complete invoice rollback", async () => {
    const cases: Array<{label:string, make:Parameters<typeof issueVoucher>[2], override:Partial<SaleOptions>, client?:number}> = [
      {label:"wrong customer",make:undefined,override:{client:43}},
      {label:"unapproved branch",make:undefined,override:{branch:2}},
      {label:"unapproved service",make:undefined,override:{service:9}},
      {label:"expired",make:{expires:"2020-01-01T00:00:00Z"},override:{}},
      {label:"USED voucher",make:{status:"USED"},override:{}},
      {label:"wrong Qty",make:{quantity:2},override:{}},
      {label:"wrong line Qty",make:undefined,override:{qty:2}},
      {label:"zero original price",make:undefined,override:{price:0}},
      {label:"not fully discounted",make:undefined,override:{after:10}},
      {label:"duplicate benefit lines",make:undefined,override:{duplicateLine:true}},
      {label:"wrong tenant",make:undefined,override:{tenant:FOREIGN_TENANT}},
    ];
    for (const c of cases) {
      const v = await issueVoucher(c.client||42,17,c.make);
      const r = await sale({code:v.code,...c.override});
      expect(r.ok,c.label + ": " + r.error).toBe(false);
      expect(await counts(r.inv),c.label).toMatchObject({Head:0,Detail:0,Payment:0,Applied:0});
      const voucher = await voucherState(v.id);
      expect(voucher.UsedInvID,c.label).toBeNull();
    }
    const valid=await issueVoucher();
    const success=await sale({code:valid.code});
    expect(success.ok).toBe(true);
    const retry=await sale({code:valid.code});
    expect(retry.ok).toBe(false);
    expect(await counts(retry.inv)).toMatchObject({Head:0,Detail:0,Payment:0,Applied:0});
  },90000);

  it("two concurrent claims for one voucher produce exactly one invoice/usage", async () => {
    const v=await issueVoucher();
    const [a,b]=await Promise.all([sale({code:v.code}),sale({code:v.code})]);
    expect([a.ok,b.ok].filter(Boolean)).toHaveLength(1);
    const winner=a.ok?a:b, loser=a.ok?b:a;
    expect(await counts(winner.inv)).toMatchObject({Head:1,Payment:1,Applied:1});
    expect(await counts(loser.inv)).toMatchObject({Head:0,Payment:0,Applied:0});
    const r=await stage!.request().input("id",sql.Int,v.id).query(
      "SELECT (SELECT COUNT(*) FROM dbo.CutClubVoucherInvoiceClaim WHERE InventoryID=@id AND Status=N'APPLIED') AS Claims," +
      "(SELECT COUNT(*) FROM dbo.TblInventoryUsageLog WHERE InventoryID=@id) AS Logs");
    expect(r.recordset[0]).toMatchObject({Claims:1,Logs:1});
  },90000);

  it("cancellation failure rolls back BOTH voucher restoration and claim reversal",async()=>{
    const v=await issueVoucher();
    const first=await sale({code:v.code});
    expect(first.ok).toBe(true);
    const tx=new sql.Transaction(stage!); await tx.begin();
    try {
      expect(await reverseStagingClaimBeforeSaleDeletion(tx,{
        trustedTenantId:TENANT,trustedBranchId:1,invoiceId:first.inv
      })).toBe(true);
      // Emulate an invoice/treasury deletion failure AFTER voucher restoration.
      throw Error("SIMULATED_TREASURY_DELETE_FAILURE");
    } catch(e) {
      await tx.rollback();
      expect(String(e)).toContain("SIMULATED_TREASURY_DELETE_FAILURE");
    }
    expect(await voucherState(v.id)).toMatchObject({Status:"USED",UsedInvID:first.inv});
    expect(await counts(first.inv)).toMatchObject({Head:1,Payment:1,Applied:1});
    const r=await stage!.request().input("id",sql.Int,v.id).query(
      "SELECT COUNT(*) AS Reversals FROM dbo.CutClubVoucherInvoiceClaim WHERE InventoryID=@id AND Status=N'REVERSED'");
    expect(r.recordset[0].Reversals).toBe(0);
  });

  it("flag OFF blocks claimed invoice reversal and preserves invoice/voucher",async()=>{
    const v=await issueVoucher();
    const first=await sale({code:v.code});
    expect(first.ok).toBe(true);
    process.env.CUT_CLUB_STAGING_CLAIM_WRITE_ENABLED="false";
    try {
      const tx=new sql.Transaction(stage!); await tx.begin();
      try {
        await expect(reverseStagingClaimBeforeSaleDeletion(tx,{
          trustedTenantId:TENANT,trustedBranchId:1,invoiceId:first.inv
        })).rejects.toThrow("CUT_CLUB_REVERSAL_WRITE_DISABLED");
      } finally { await tx.rollback(); }
      expect(await voucherState(v.id)).toMatchObject({Status:"USED",UsedInvID:first.inv});
      expect(await counts(first.inv)).toMatchObject({Head:1,Payment:1,Applied:1});
    } finally {process.env.CUT_CLUB_STAGING_CLAIM_WRITE_ENABLED="true";}
  });

  it("flag OFF fails closed and rolls back invoice/payment",async()=>{
    const v=await issueVoucher();
    process.env.CUT_CLUB_STAGING_CLAIM_WRITE_ENABLED="false";
    try {
      const r=await sale({code:v.code});
      expect(r.ok).toBe(false);
      expect(r.error).toContain("CUT_CLUB_STAGING_WRITE_DISABLED");
      expect(await counts(r.inv)).toMatchObject({Head:0,Payment:0,Applied:0});
      expect(await voucherState(v.id)).toMatchObject({Status:"ACTIVE",UsedInvID:null});
    } finally { process.env.CUT_CLUB_STAGING_CLAIM_WRITE_ENABLED="true"; }
  });
});
