import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import sql from 'mssql';
import { purgeSmokeTenant } from './smokeTenantPurge';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.RUNNER_TEMP + '/onboarding-browser/node_modules/playwright');
const base = 'http://127.0.0.1:5500';
const tag = 'QA-ONBOARD-' + crypto.randomBytes(6).toString('hex').toUpperCase();
const password = crypto.randomBytes(24).toString('hex');
const accounts = ['A','B'].map(letter => {
  const phone = '010' + crypto.randomInt(10000000, 99999999);
  const normalized = '20' + phone.slice(1);
  const businessName = tag + '-' + letter;
  const digest = crypto.createHash('sha256').update(normalized+'|'+businessName).digest('hex').slice(0,10).toUpperCase();
  return { phone, normalized, businessName, tenantCode:'DRVO_'+digest, login:'u'+normalized, attempted:false };
});
const routes = [
  ['/setup','بيزنسك جاهز يبدأ رحلته'],
  ['/setup/identity','خلّي النظام يشبه بيزنسك.'],
  ['/setup/branch','ظبط بيانات أول فرع'],
  ['/setup/services','إيه الخدمات اللي بتقدمها؟'],
  ['/setup/team','ضيف أول فرد في فريقك'],
  ['/setup/operating','خلّي كل حاجة جاهزة قبل أول عميل.'],
  ['/setup/training','اتعلم النظام قبل أول عميل حقيقي.'],
  ['/setup/launch','جهّز أول يوم شغل'],
  ['/setup/finish','راجع آخر خطوات التجهيز'],
] as const;
async function assertDb(pool:sql.ConnectionPool){
  const r=await pool.request().query('SELECT DB_NAME() db,SUSER_SNAME() login');
  assert.equal(r.recordset[0].db,'last132_agent');
  assert.equal(String(r.recordset[0].login).toLowerCase(),'drvo_agent');
}
async function main(){
  assert.equal(process.env.DB_DATABASE,'last132_agent');
  assert.equal(process.env.CLOUD_DB_NAME,'last132_agent');
  assert.equal(process.env.LOCAL_DB_NAME,'last132_agent');
  assert.equal(process.env.PUBLIC_SIGNUP_OTP_REQUIRED,'false');
  assert.ok(process.env.DRVO_STAGING_DB_PASSWORD);
  assert.notEqual(accounts[0].phone,accounts[1].phone);
  const pool=await new sql.ConnectionPool({server:'127.0.0.1',port:14330,database:'last132_agent',user:'drvo_agent',password:process.env.DRVO_STAGING_DB_PASSWORD!,options:{encrypt:false,trustServerCertificate:true},requestTimeout:120000}).connect();
  let verified=false;
  let browser:any;
  try{
    await assertDb(pool);verified=true;
    for(const a of accounts){
      const result=await pool.request().input('phone',sql.NVarChar(32),a.normalized).input('code',sql.NVarChar(64),a.tenantCode).input('login',sql.NVarChar(50),a.login).query(`
        SELECT (SELECT COUNT(*) FROM dbo.PublicSignupRegistration WHERE PhoneNormalized=@phone)
          +(SELECT COUNT(*) FROM dbo.Tenant WHERE Code=@code)
          +(SELECT COUNT(*) FROM dbo.TblUser WHERE loginName=@login) AS n;
      `);
      assert.equal(Number(result.recordset[0].n),0,'Synthetic identity collision; refuse before any signup');
    }
    browser=await chromium.launch({headless:true});
    fs.mkdirSync('authenticated-evidence',{recursive:true});
    const contexts:any[]=[];
    for(const [i,a] of accounts.entries()){
      const context=await browser.newContext({viewport:{width:i===0?390:1440,height:900},locale:'ar-EG',serviceWorkers:'block'});
      contexts.push(context);
      // The browser may only access the loopback runner. Prevent accidental UI writes other than explicit test requests.
      await context.route('**/*',async (route:any)=>{
        const req=route.request();
        if(new URL(req.url()).origin!==base)return route.abort();
        if(!['GET','HEAD','OPTIONS'].includes(req.method()))return route.abort();
        return route.continue();
      });
      a.attempted=true;
      const response=await context.request.post(base+'/api/public/signup/complete',{data:{industry:'salon',needs:[],contactName:a.businessName,businessName:a.businessName,phone:a.phone,email:null,password,startMode:'real'},timeout:300000});
      assert.equal(response.status(),201,'Real staging signup status for '+i);
      const result=await response.json();
      assert.equal(result.tenantCode,a.tenantCode);
      assert.equal(result.ownerLoginName,a.login);
      assert.equal(result.nextPath,'/setup');
      assert.ok((await context.cookies()).some((c:any)=>c.name==='pos_session'),'Actual signup session cookie');
      const journey=await context.request.get(base+'/api/tenant/onboarding',{timeout:120000});
      assert.equal(journey.status(),200);
      assert.equal((await journey.json()).journey.tenantName,a.businessName);
      const data=await context.request.get(base+'/api/tenant/onboarding/setup-data',{timeout:120000});
      assert.equal(data.status(),200);
      const setup=await data.json();
      assert.equal(setup.editable,true);
      assert.equal(setup.services.length,0);
      assert.equal(setup.employees.length,0);
      const page=await context.newPage();
      page.setDefaultTimeout(90000);
      for(const [path,heading] of routes){
        const nav=await page.goto(base+path,{waitUntil:'load',timeout:120000});
        assert.equal(nav?.status(),200,'Setup response '+path);
        assert.equal(new URL(page.url()).pathname,path,'Unexpected setup redirect');
        await page.waitForFunction(expected=>[...document.querySelectorAll('h1,h2')].filter(el=>el.textContent?.trim()===expected&&el.getClientRects().length>0&&(el as HTMLElement).checkVisibility({visibilityProperty:true})).length===1,heading,{timeout:90000});
        assert.equal(await page.getByRole('heading',{name:heading,exact:true}).count(),1);
        await page.evaluate(()=>document.fonts.ready);
        const overflow=await page.evaluate(()=>Math.max(document.documentElement.scrollWidth,document.body.scrollWidth)-document.documentElement.clientWidth);
        assert.ok(overflow<=2,'Horizontal overflow '+path+' / '+i);
        await page.screenshot({path:'authenticated-evidence/'+i+'-'+path.replaceAll('/','_')+'.png',fullPage:true});
      }
      console.log('PASS authenticated setup route smoke for synthetic tenant '+i);
    }
    const name=tag+'-SERVICE';
    const saved=await contexts[0].request.post(base+'/api/tenant/onboarding/setup-data',{data:{action:'service',name,price:100,durationMinutes:30},timeout:120000});
    assert.equal(saved.status(),200);
    assert.equal((await saved.json()).ok,true);
    for(const [i,context] of contexts.entries()){
      const response=await context.request.get(base+'/api/tenant/onboarding/setup-data',{timeout:120000});
      assert.equal(response.status(),200);
      const body=await response.json();
      assert.equal(body.services.some((row:any)=>row.ProName===name),i===0,'Service must stay inside tenant A');
    }
    const anonymous=await browser.newContext();
    const denied=await anonymous.request.get(base+'/api/tenant/onboarding/setup-data');
    assert.equal(denied.status(),401);
    await anonymous.close();
    console.log('PASS two independent public salon signups, authenticated routes, service isolation and anonymous denial');
  }finally{
    try{if(browser)await browser.close();}finally{
      // Stop this runner's isolated app before cleanup, including an interrupted signup.
      const pid=Number(process.env.ONBOARDING_QA_APP_PID);
      if(Number.isInteger(pid)&&pid>1){
        try{process.kill(-pid,'SIGTERM');}catch(err:any){if(err.code!=='ESRCH')throw err;}
      }
      try{
        if(verified){
          await assertDb(pool);
          for(const a of accounts.filter(x=>x.attempted)){
            const result=await pool.request().input('phone',sql.NVarChar(32),a.normalized).input('code',sql.NVarChar(64),a.tenantCode).query(`
              SELECT r.BusinessName AS registeredName,r.TenantId AS registeredId,t.TenantId AS actualId,t.Name AS actualName
              FROM (SELECT 1 AS n) seed
              LEFT JOIN dbo.PublicSignupRegistration r ON r.PhoneNormalized=@phone
              LEFT JOIN dbo.Tenant t ON t.Code=@code;
            `);
            const row=result.recordset[0];
            if(row.registeredName!=null)assert.equal(row.registeredName,a.businessName,'Refuse unrelated registration cleanup');
            if(row.actualId){
              assert.equal(row.actualName,a.businessName,'Refuse unrelated tenant cleanup');
              if(row.registeredId)assert.equal(String(row.registeredId).toLowerCase(),String(row.actualId).toLowerCase());
              await purgeSmokeTenant(pool,a.tenantCode);
            }
            await pool.request().input('phone',sql.NVarChar(32),a.normalized).input('name',sql.NVarChar(200),a.businessName).query('DELETE FROM dbo.PublicSignupRegistration WHERE PhoneNormalized=@phone AND BusinessName=@name');
            const residue=await pool.request().input('phone',sql.NVarChar(32),a.normalized).input('code',sql.NVarChar(64),a.tenantCode).query('SELECT (SELECT COUNT(*) FROM dbo.Tenant WHERE Code=@code)+(SELECT COUNT(*) FROM dbo.PublicSignupRegistration WHERE PhoneNormalized=@phone) AS n');
            assert.equal(Number(residue.recordset[0].n),0,'Synthetic tenant/registration cleanup');
          }
          console.log('PASS authenticated staging smoke cleanup');
        }
      }finally{await pool.close();}
    }
  }
}
void main().then(()=>process.exit(0),err=>{console.error('Authenticated staging QA FAIL:',err instanceof Error?err.message:String(err));process.exit(1)});
