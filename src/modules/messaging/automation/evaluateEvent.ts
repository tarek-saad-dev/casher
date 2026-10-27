import { getPool,sql } from '@/lib/db';
import {parseAutomationDefinition,simulateAutomation} from './draftRules';
/** Internal durable decision journal. Intentional no-op for outbound delivery until
 * a separate approval-gated delivery dispatcher is audited and enabled.
 */
export async function evaluateAutomationEvent(input:{
 tenantId:string;branchId:number;eventKey:string;eventType:string;
 facts:Record<string,unknown>;
}){
 if(!input.tenantId||!Number.isSafeInteger(input.branchId)||input.branchId<=0||
 !/^[a-zA-Z0-9:_-]{1,160}$/.test(input.eventKey))throw new Error('Invalid event scope or key');
 if(!['attendance.check_in','visit.completed','booking.cancelled','sale.completed','employee.advance'].includes(input.eventType))throw new Error('Unsupported event');
 const pool=await getPool();const tx=new sql.Transaction(pool);await tx.begin();
 try{
 const scope=()=>new sql.Request(tx).input('tenant',sql.NVarChar(100),input.tenantId).input('branch',sql.Int,input.branchId);
 const event=await scope().input('key',sql.NVarChar(160),input.eventKey).input('type',sql.NVarChar(100),input.eventType).input('facts',sql.NVarChar(sql.MAX),JSON.stringify(input.facts)).query(`
 DECLARE @id BIGINT;
 SELECT @id=ID FROM dbo.TblCutPulseAutomationEvent WITH (UPDLOCK,HOLDLOCK)
 WHERE TenantId=@tenant AND BranchID=@branch AND EventKey=@key;
 IF @id IS NULL BEGIN
 INSERT dbo.TblCutPulseAutomationEvent(TenantId,BranchID,EventKey,EventType,FactsJson)
 VALUES(@tenant,@branch,@key,@type,@facts);
 SET @id=SCOPE_IDENTITY();
 END
 SELECT @id AS ID;`);
 const eventId=event.recordset[0].ID as number;
 const rules=await scope().input('type',sql.NVarChar(100),input.eventType)
 .query("SELECT ID,DefinitionJson FROM dbo.TblCutPulseAutomationDraft WHERE TenantId=@tenant AND BranchID=@branch AND Status=N'active'");
 let matched=0,alreadyEvaluated=0;
 for(const rule of rules.recordset){
 const def=parseAutomationDefinition(JSON.parse(rule.DefinitionJson));
 if(def.event!==input.eventType)continue;
 const verdict=simulateAutomation(def,input.facts);
 const saved=await scope().input('auto',sql.Int,rule.ID).input('event',sql.BigInt,eventId).input('matched',sql.Bit,verdict.eligible?1:0).input('decision',sql.NVarChar(sql.MAX),JSON.stringify(verdict))
 .query(`IF NOT EXISTS(SELECT 1 FROM dbo.TblCutPulseAutomationRun WITH (UPDLOCK,HOLDLOCK) WHERE AutomationID=@auto AND EventID=@event)
 BEGIN INSERT dbo.TblCutPulseAutomationRun(TenantId,BranchID,AutomationID,EventID,Matched,DecisionJson)
 VALUES(@tenant,@branch,@auto,@event,@matched,@decision);SELECT CAST(1 AS BIT) AS inserted;END
 ELSE SELECT CAST(0 AS BIT) AS inserted;`);
 if(saved.recordset[0].inserted){if(verdict.eligible)matched++;}else alreadyEvaluated++;
 }
 await tx.commit();
 return {eventId,matched,alreadyEvaluated,deliveryEnabled:false};
 }catch(e){try{await tx.rollback()}catch{}throw e;}
}
