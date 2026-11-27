import path from 'node:path';
import { checksumFile } from '../checksum';
import { executeSqlFile } from '../sqlBatch';
import type { DrvoMigrationDefinition } from '../types';
const SCHEMA=path.join(__dirname,'..','..','..','db','drvo-migrations','027-cut-club-member-moderation','schema.sql');
export const cutClubMemberModerationMigration:DrvoMigrationDefinition={
  migrationId:27,
  migrationKey:'cut-club-member-moderation',
  name:'CUT CLUB member suspension, moderation audit and unique-phone auto-link metadata',
  dependencies:['cut-club-member-wallet-auth'],
  checksum:checksumFile(SCHEMA),
  control:{
    kind:'schema',risk:'MEDIUM',requiresBackup:true,lockProfile:'short',
    rollbackStrategy:'Disable CUT_CLUB_MEMBER_WALLET_ENABLED and CUT_CLUB_AUTO_LINK_UNIQUE_PHONE_ENABLED, preserving additive access columns and immutable audit history. Do not delete wallet or customer data.',
  },
  async apply(ctx){await executeSqlFile(ctx.pool,SCHEMA);},
  async verify(ctx){
    const result=await ctx.pool.request().query(`
      SELECT CASE WHEN
        COL_LENGTH('dbo.CutClubMemberAccount','AccessStatus') IS NOT NULL
        AND COL_LENGTH('dbo.CutClubMemberAccount','AccessUpdatedAtUtc') IS NOT NULL
        AND COL_LENGTH('dbo.CutClubMemberAccount','AccessUpdatedBy') IS NOT NULL
        AND OBJECT_ID('dbo.CutClubMemberAccessAudit','U') IS NOT NULL
        AND EXISTS(SELECT 1 FROM sys.check_constraints WHERE parent_object_id=OBJECT_ID('dbo.CutClubMemberAccount')
          AND name='CK_CutClubMemberAccount_AccessStatus' AND is_disabled=0 AND is_not_trusted=0)
        AND EXISTS(SELECT 1 FROM sys.check_constraints WHERE parent_object_id=OBJECT_ID('dbo.CutClubMemberAccount')
          AND name='CK_CutClubMemberAccount_Approved' AND is_disabled=0 AND is_not_trusted=0)
      THEN 1 ELSE 0 END AS Ready`);
    const ok=result.recordset[0]?.Ready===1;
    return {ok,failures:ok?[]:['CUT CLUB moderation schema is incomplete']};
  },
};
