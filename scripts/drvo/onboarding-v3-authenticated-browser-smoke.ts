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
    let allowLaunchWrites=false;
    for(const [i,a] of accounts.entries()){
      const context=await browser.newContext({viewport:{width:i===0?390:1440,height:900},locale:'ar-EG',serviceWorkers:'block'});
      contexts.push(context);
      // The browser may only access the loopback runner. Prevent accidental UI writes other than explicit test requests.
      await context.route('**/*',async (route:any)=>{
        const req=route.request();
        if(new URL(req.url()).origin!==base)return route.abort();
        if(!['GET','HEAD','OPTIONS'].includes(req.method())){
          const pathname=new URL(req.url()).pathname;
          if(!(i===0&&allowLaunchWrites&&req.method()==='POST'&&['/api/day/open','/api/shift/open'].includes(pathname)))return route.abort();
        }
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
    const [ownerA,ownerB]=contexts;
    async function read(context:any,path:string){
      const res=await context.request.get(base+path,{timeout:120000});
      assert.equal(res.status(),200,'GET '+path);return res.json();
    }
    async function write(context:any,path:string,method:string,data:any,expected=200){
      const res=await context.request.fetch(base+path,{method,data,timeout:120000});
      assert.equal(res.status(),expected,method+' '+path);return res.json();
    }
    // Registration duplicate protection is verified against the actual public endpoint.
    const duplicate=await write(ownerA,'/api/public/signup/complete','POST',{industry:'salon',needs:[],contactName:accounts[0].businessName,businessName:accounts[0].businessName,phone:accounts[0].phone,email:null,password,startMode:'real'},409);
    assert.equal(duplicate.code,'PHONE_ALREADY_REGISTERED');

    const brandPath='/api/tenant/brand';
    const brandA=(await read(ownerA,brandPath)).brand,brandB=(await read(ownerB,brandPath)).brand;
    assert.notEqual(brandA.tenantId,brandB.tenantId);
    const brandPayload={displayName:accounts[0].businessName+' Brand',logoUrl:'https://example.invalid/qa-logo.png',phone:brandA.phone,address:brandA.address,primaryColor:'#263E5C',accentColor:'#4269BC',receiptFooter:'QA receipt',timezone:brandA.timezone,publicBookingOrigins:brandA.publicBookingOrigins,expectedRevision:brandA.revision};
    await write(ownerA,brandPath,'PUT',{...brandPayload,logoUrl:'http://example.invalid/qa.png'},400);
    await write(ownerA,brandPath,'PUT',{...brandPayload,tenantId:brandB.tenantId},400);
    const updated=(await write(ownerA,brandPath,'PUT',brandPayload)).brand;
    assert.equal(updated.displayName,brandPayload.displayName);
    assert.equal(updated.revision,brandA.revision+1);
    assert.equal(updated.primaryColor,brandPayload.primaryColor);
    await write(ownerA,brandPath,'PUT',brandPayload,409);
    assert.deepEqual((await read(ownerB,brandPath)).brand,brandB,'Brand isolation');
    assert.equal((await read(ownerA,brandPath)).brand.receiptFooter,'QA receipt');
    console.log('PASS real identity validation, optimistic conflict and tenant isolation');

    const operatingPath='/api/tenant/onboarding/operating';
    const opA=await read(ownerA,operatingPath),opB=await read(ownerB,operatingPath);
    assert.ok(opA.booking&&opB.booking,'Fresh salon booking settings must be seeded');
    const preferences={slotIntervalMinutes:opA.booking.slotIntervalMinutes===30?15:30,minNoticeMinutes:60,maxBookingDaysAhead:21};
    await write(ownerA,operatingPath,'PATCH',{...preferences,publicBookingEnabled:true},400);
    await write(ownerA,operatingPath,'PATCH',preferences);
    const current=await read(ownerA,operatingPath);
    for(const key of Object.keys(preferences))assert.equal(current.booking[key],(preferences as any)[key]);
    assert.equal(current.booking.enabled,opA.booking.enabled);
    assert.equal(current.publicBookingEnabled,opA.publicBookingEnabled);
    assert.equal(current.publicBookingEnabled,false);
    assert.deepEqual(await read(ownerB,operatingPath),opB,'Booking preference isolation');
    console.log('PASS real operating preference save without public activation');

    const setupPath='/api/tenant/onboarding/setup-data';
    await write(ownerA,setupPath,'POST',{action:'branch',address:'QA-only address',phone:accounts[0].phone,defaultOpenTime:'11:00',defaultCloseTime:'23:00'});
    const employeeName=tag+'-EMPLOYEE';
    await write(ownerA,setupPath,'POST',{action:'employee',name:employeeName,job:'حلاق'});
    const aData=await read(ownerA,setupPath),bData=await read(ownerB,setupPath);
    assert.equal(aData.branch.address,'QA-only address');
    assert.notEqual(bData.branch.address,'QA-only address');
    assert.ok(aData.employees.some((row:any)=>row.EmpName===employeeName));
    assert.ok(!bData.employees.some((row:any)=>row.EmpName===employeeName));
    console.log('PASS real branch and employee setup isolation');

    const launchPage=ownerA.pages()[0];
    // Operational bootstrap may reconcile a missing day automatically; opening it
    // a second time is not a valid UI action. Verify the server state first.
    const bootstrapPath='/api/operations/bootstrap';
    const beforeLaunch=await read(ownerA,bootstrapPath);
    assert.ok(beforeLaunch.user?.userId,'Authenticated operational session must load');
    assert.equal(beforeLaunch.view?.branch?.branchCode,accounts[0].tenantCode+'_MAIN');
    assert.equal(beforeLaunch.stale,false,'Operational state must not be stale');
    assert.equal(beforeLaunch.operational?.shift,null,'Fresh owner must not already have an open shift');
    const initialDay=beforeLaunch.view?.businessDay??beforeLaunch.activeBranchState?.businessDay;
    console.log('Launch bootstrap: '+JSON.stringify({dayOpen:initialDay?.status===true,reconciliationAction:beforeLaunch.reconciliationAction,hasShift:!!beforeLaunch.operational?.shift}));
    const beforeB=(await read(ownerB,'/api/tenant/onboarding')).journey;
    await launchPage.goto(base+'/setup/launch',{waitUntil:'load',timeout:120000});
    const day=launchPage.getByRole('button',{name:'فتح يوم العمل',exact:true});
    const shift=launchPage.getByRole('button',{name:'فتح وردية',exact:true});
    allowLaunchWrites=true;
    try{
      await launchPage.getByRole('heading',{name:'تشغيل الفرع الحالي الآن',exact:true}).waitFor({timeout:90000});
      const current=await read(ownerA,bootstrapPath);
      assert.equal(current.stale,false);
      const currentDay=current.view?.businessDay??current.activeBranchState?.businessDay;
      if(currentDay?.status===true){
        assert.equal(currentDay.branchId,current.view.branch.branchId);
        if(initialDay?.status===true)assert.equal(currentDay.id,initialDay.id,'Bootstrap must not duplicate the current day');
        await launchPage.waitForFunction(()=>![...document.querySelectorAll('button')].some(b=>b.textContent?.trim()==='فتح يوم العمل'),null,{timeout:15000});
        console.log('PASS current business day already open via operational state; no duplicate day request');
      }else{
        await day.waitFor({timeout:15000});
        const response=launchPage.waitForResponse((res:any)=>new URL(res.url()).pathname==='/api/day/open'&&res.request().method()==='POST',{timeout:120000});
        await day.click();
        assert.equal((await response).status(),201,'Explicit day open must succeed');
        console.log('PASS explicit business day open');
      }
      await shift.waitFor({timeout:90000});
      const readyDay=await read(ownerA,bootstrapPath);
      assert.equal((readyDay.view?.businessDay??readyDay.activeBranchState?.businessDay)?.status,true,'Business day must be open before shift');
      const select=launchPage.getByRole('combobox',{name:'اختيار الوردية'});
      if(await shift.isDisabled()){
        await select.waitFor({timeout:90000});
        const value=await select.locator('option').evaluateAll((options:any[])=>options.map(o=>o.value).find(v=>v));
        assert.ok(value,'At least one real shift definition is required');
        await select.selectOption(value);
      }
      const shiftResponse=launchPage.waitForResponse((res:any)=>new URL(res.url()).pathname==='/api/shift/open'&&res.request().method()==='POST',{timeout:120000});
      await shift.click();
      assert.equal((await shiftResponse).status(),201,'Explicit shift open must succeed');
      await launchPage.getByText('اليوم وورديتك مفتوحان',{exact:true}).waitFor({timeout:120000});
      const launched=await read(ownerA,bootstrapPath);
      assert.equal(launched.operational?.shift?.status,true);
      assert.equal(launched.operational?.shift?.branchId,launched.view.branch.branchId);
      assert.equal(launched.operational?.shift?.userId,launched.user.userId);
      assert.equal(await day.count(),0);
      assert.equal(await shift.count(),0);
      await launchPage.screenshot({path:'authenticated-evidence/0-launch-ready.png',fullPage:true});
    }catch(error){
      const diagnostic=await ownerA.request.get(base+bootstrapPath,{timeout:30000}).catch(()=>null);
      if(diagnostic){
        const state=await diagnostic.json().catch(()=>({}));
        console.error('Launch diagnostic:',JSON.stringify({status:diagnostic.status(),code:state.code,stale:state.stale,dayOpen:state.view?.businessDay?.status,shiftOpen:state.operational?.shift?.status,action:state.reconciliationAction}));
      }
      console.error('Launch UI:',JSON.stringify(await launchPage.getByRole('button').allTextContents()));
      await launchPage.screenshot({path:'authenticated-evidence/0-launch-failure.png',fullPage:true}).catch(()=>{});
      throw error;
    }finally{allowLaunchWrites=false;}
    const afterA=(await read(ownerA,'/api/tenant/onboarding')).journey,afterB=(await read(ownerB,'/api/tenant/onboarding')).journey;
    assert.equal(afterA.steps.find((x:any)=>x.id==='launch').complete,true);
    assert.notEqual(afterA.firstSaleStatus,'done','Launch must not create an invoice');
    assert.equal(afterB.steps.find((x:any)=>x.id==='launch').complete,beforeB.steps.find((x:any)=>x.id==='launch').complete);
    assert.equal(afterB.firstSaleStatus,beforeB.firstSaleStatus);
    console.log('PASS real business day state and explicit shift launch, no implicit first sale, tenant isolation');
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
