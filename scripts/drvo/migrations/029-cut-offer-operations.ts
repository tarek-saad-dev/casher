import path from 'path';
import {checksumFile} from '../checksum';
import {executeSqlFile} from '../sqlBatch';
import type {DrvoMigrationDefinition} from '../types';
const SCHEMA=path.join(__dirname,'..','..','..','db','drvo-migrations','029-cut-offer-operations','schema.sql');
export const cutOfferOperationsMigration:DrvoMigrationDefinition={
 migrationId:29,migrationKey:'cut-offer-operations',name:'Campaign operations audit',dependencies:['cut-offer-campaign'],checksum:checksumFile(SCHEMA),
 control:{kind:'schema',risk:'MEDIUM',requiresBackup:true,lockProfile:'short',rollbackStrategy:'Disable operations routes; retain audit entries and campaign data.'},
 async apply(ctx){await executeSqlFile(ctx.pool,SCHEMA);},
 async verify(ctx){const r=await ctx.pool.request().query("SELECT CASE WHEN OBJECT_ID(N'dbo.CutOfferOperationAudit',N'U') IS NOT NULL THEN 1 ELSE 0 END ok");const ok=Number(r.recordset[0]?.ok)===1;return {ok,failures:ok?[]:['Missing CutOfferOperationAudit']};}
};
