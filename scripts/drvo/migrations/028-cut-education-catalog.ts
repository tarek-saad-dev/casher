import path from 'path';
import {checksumFile} from '../checksum';
import {executeSqlFile} from '../sqlBatch';
import type {DrvoMigrationDefinition} from '../types';
const SCHEMA=path.join(__dirname,'..','..','..','db','drvo-migrations','028-cut-education-catalog','schema.sql');
export const cutEducationCatalogMigration:DrvoMigrationDefinition={
 migrationId:28,migrationKey:'cut-education-catalog',name:'Tenant education catalog',dependencies:['cut-offer-campaign'],checksum:checksumFile(SCHEMA),
 control:{kind:'schema',risk:'MEDIUM',requiresBackup:true,lockProfile:'short',rollbackStrategy:'Disable catalog UI and reads; retain approved entries and existing customer profiles.'},
 async apply(ctx){await executeSqlFile(ctx.pool,SCHEMA);},
 async verify(ctx){const r=await ctx.pool.request().query("SELECT CASE WHEN OBJECT_ID(N'dbo.CutEducationCatalog',N'U') IS NOT NULL THEN 1 ELSE 0 END ok");const ok=Number(r.recordset[0]?.ok)===1;return {ok,failures:ok?[]:['Missing CutEducationCatalog']};}
};
