/*
  DRVO-018 Messaging / WhatsApp / AI receptionist multi-tenancy.

  1. New tenant-owned tables:
     - TenantMessagingChannel: authoritative channel identity per tenant (provider, bridge
       endpoint, session id, phone number, SHA-256 webhook token hash, status).
     - TenantAiConfig: tenant business details, URLs, hours, policies, persona, booking actor.
     - TenantMessagingUsage: per-tenant daily counters (no billing semantics).
  2. Every legacy messaging table gains TenantId (FK dbo.Tenant). Existing rows are
     backfilled to CASHER_BOOT, the only tenant that ever wrote them. The column stays
     NULLable (expand phase) so an application rollback keeps inserting; tenant-scoped
     code never reads or claims a row without TenantId (fail closed).
  3. Global uniqueness on externally supplied / human chosen keys becomes tenant-leading,
     so two tenants can hold the same provider message id, idempotency key, contact or
     knowledge key without colliding or resolving to each other's rows. The tenant-leading
     unique index is created before the global one is dropped.
  4. CASHER_BOOT gets a TenantAiConfig row carrying its current behavior and a `pending`
     channel row; the channel is activated by `npm run drvo-018:bind-channel` (rollout
     preflight), which stores the endpoint and the token hash.

  Statements that reference columns added in this batch run through sp_executesql.
*/

SET NOCOUNT ON;
SET XACT_ABORT ON;

BEGIN TRY
  BEGIN TRAN;

  DECLARE @boot UNIQUEIDENTIFIER = (SELECT TenantId FROM dbo.Tenant WHERE Code = N'CASHER_BOOT');

  IF OBJECT_ID(N'dbo.TenantMessagingChannel', N'U') IS NULL
  BEGIN
    CREATE TABLE dbo.TenantMessagingChannel (
      ChannelId UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_TenantMessagingChannel_Id DEFAULT NEWSEQUENTIALID(),
      TenantId UNIQUEIDENTIFIER NOT NULL,
      Channel NVARCHAR(30) NOT NULL CONSTRAINT DF_TenantMessagingChannel_Channel DEFAULT N'whatsapp',
      Provider NVARCHAR(50) NOT NULL,
      EndpointUrl NVARCHAR(500) NULL,
      SessionId NVARCHAR(128) NULL,
      PhoneNumber NVARCHAR(50) NULL,
      WebhookTokenHash CHAR(64) NULL,
      Status NVARCHAR(20) NOT NULL CONSTRAINT DF_TenantMessagingChannel_Status DEFAULT N'pending',
      CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_TenantMessagingChannel_CreatedAt DEFAULT SYSUTCDATETIME(),
      UpdatedAt DATETIME2 NOT NULL CONSTRAINT DF_TenantMessagingChannel_UpdatedAt DEFAULT SYSUTCDATETIME(),
      CONSTRAINT PK_TenantMessagingChannel PRIMARY KEY (ChannelId),
      CONSTRAINT FK_TenantMessagingChannel_Tenant FOREIGN KEY (TenantId) REFERENCES dbo.Tenant (TenantId),
      CONSTRAINT CK_TenantMessagingChannel_Status CHECK (Status IN (N'pending', N'active', N'disabled')),
      CONSTRAINT CK_TenantMessagingChannel_Channel CHECK (Channel IN (N'whatsapp')),
      CONSTRAINT CK_TenantMessagingChannel_Active CHECK (
        Status <> N'active' OR (EndpointUrl IS NOT NULL AND WebhookTokenHash IS NOT NULL)
      ),
      CONSTRAINT CK_TenantMessagingChannel_TokenHash CHECK (
        WebhookTokenHash IS NULL OR (LEN(WebhookTokenHash) = 64 AND WebhookTokenHash NOT LIKE N'%[^0-9a-f]%')
      )
    );
    CREATE UNIQUE INDEX UX_TenantMessagingChannel_TokenHash
      ON dbo.TenantMessagingChannel (WebhookTokenHash) WHERE WebhookTokenHash IS NOT NULL;
    CREATE UNIQUE INDEX UX_TenantMessagingChannel_Session
      ON dbo.TenantMessagingChannel (Provider, SessionId) WHERE SessionId IS NOT NULL;
    CREATE UNIQUE INDEX UX_TenantMessagingChannel_ActivePerTenant
      ON dbo.TenantMessagingChannel (TenantId, Channel) WHERE Status = N'active';
  END;

  IF OBJECT_ID(N'dbo.TenantAiConfig', N'U') IS NULL
  BEGIN
    CREATE TABLE dbo.TenantAiConfig (
      TenantId UNIQUEIDENTIFIER NOT NULL,
      Enabled BIT NOT NULL CONSTRAINT DF_TenantAiConfig_Enabled DEFAULT 0,
      IndustryCode NVARCHAR(64) NOT NULL,
      BusinessName NVARCHAR(200) NOT NULL,
      AssistantPersona NVARCHAR(400) NOT NULL,
      Locale NVARCHAR(16) NOT NULL CONSTRAINT DF_TenantAiConfig_Locale DEFAULT N'ar-EG',
      WebsiteUrl NVARCHAR(500) NULL,
      BookingUrl NVARCHAR(500) NULL,
      PricesUrl NVARCHAR(500) NULL,
      BusinessHoursJson NVARCHAR(MAX) NULL,
      PoliciesJson NVARCHAR(MAX) NULL,
      BookingActorUserId INT NULL,
      ConversationPack NVARCHAR(64) NULL,
      Revision INT NOT NULL CONSTRAINT DF_TenantAiConfig_Revision DEFAULT 1,
      CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_TenantAiConfig_CreatedAt DEFAULT SYSUTCDATETIME(),
      UpdatedAt DATETIME2 NOT NULL CONSTRAINT DF_TenantAiConfig_UpdatedAt DEFAULT SYSUTCDATETIME(),
      CONSTRAINT PK_TenantAiConfig PRIMARY KEY (TenantId),
      CONSTRAINT FK_TenantAiConfig_Tenant FOREIGN KEY (TenantId) REFERENCES dbo.Tenant (TenantId),
      CONSTRAINT CK_TenantAiConfig_HoursJson CHECK (BusinessHoursJson IS NULL OR ISJSON(BusinessHoursJson) = 1),
      CONSTRAINT CK_TenantAiConfig_PoliciesJson CHECK (PoliciesJson IS NULL OR ISJSON(PoliciesJson) = 1)
    );
  END;

  IF OBJECT_ID(N'dbo.TenantMessagingUsage', N'U') IS NULL
  BEGIN
    CREATE TABLE dbo.TenantMessagingUsage (
      TenantId UNIQUEIDENTIFIER NOT NULL,
      UsageDate DATE NOT NULL,
      Channel NVARCHAR(30) NOT NULL,
      Metric NVARCHAR(40) NOT NULL,
      [Count] BIGINT NOT NULL CONSTRAINT DF_TenantMessagingUsage_Count DEFAULT 0,
      UpdatedAt DATETIME2 NOT NULL CONSTRAINT DF_TenantMessagingUsage_UpdatedAt DEFAULT SYSUTCDATETIME(),
      CONSTRAINT PK_TenantMessagingUsage PRIMARY KEY (TenantId, UsageDate, Channel, Metric),
      CONSTRAINT FK_TenantMessagingUsage_Tenant FOREIGN KEY (TenantId) REFERENCES dbo.Tenant (TenantId),
      CONSTRAINT CK_TenantMessagingUsage_Count CHECK ([Count] >= 0)
    );
  END;

  /* TenantId on every legacy messaging table that exists in this database. */
  DECLARE @tables TABLE (Name SYSNAME NOT NULL PRIMARY KEY);
  INSERT INTO @tables (Name) VALUES
    (N'TblMessageInbox'), (N'TblMessageOutbox'), (N'TblMessageTemplate'),
    (N'TblBotConversation'), (N'TblBotMessage'), (N'TblBotAiTurn'),
    (N'TblBotBookingPlan'), (N'TblBotBookingManagementPlan'),
    (N'TblBotConversationControlEvent'), (N'TblBotConversationResumeClaim'),
    (N'TblWhatsAppOutboundCorrelation'), (N'TblWhatsAppCampaign'),
    (N'TblWhatsAppCampaignRecipient'), (N'TblWhatsAppGroup'),
    (N'TblAiLearningSubmission'), (N'TblAiLearningArtifact'),
    (N'TblAiLearningConflict'), (N'TblAiLearningAuditEvent'),
    (N'TblSalonKnowledge'), (N'TblSalonCapability'), (N'TblSalonExternalLink'),
    (N'TblSalonOffer'), (N'TblSalonBrandVoice'), (N'TblSalonKnowledgeGap'),
    (N'TblSalonBrandVoiceExample'), (N'TblSalonKnowledgeSource');

  DECLARE @name SYSNAME;
  DECLARE @stmt NVARCHAR(MAX);
  DECLARE @hasRows BIT;
  DECLARE table_cursor CURSOR LOCAL FAST_FORWARD FOR SELECT Name FROM @tables;
  OPEN table_cursor;
  FETCH NEXT FROM table_cursor INTO @name;
  WHILE @@FETCH_STATUS = 0
  BEGIN
    IF OBJECT_ID(N'dbo.' + @name, N'U') IS NOT NULL
    BEGIN
      IF COL_LENGTH(N'dbo.' + @name, N'TenantId') IS NULL
      BEGIN
        SET @stmt = N'ALTER TABLE dbo.' + QUOTENAME(@name) + N' ADD TenantId UNIQUEIDENTIFIER NULL;';
        EXEC sp_executesql @stmt;
      END;

      IF NOT EXISTS (
        SELECT 1 FROM sys.foreign_keys
        WHERE name = N'FK_' + @name + N'_Tenant' AND parent_object_id = OBJECT_ID(N'dbo.' + @name)
      )
      BEGIN
        SET @stmt = N'ALTER TABLE dbo.' + QUOTENAME(@name) + N' WITH CHECK ADD CONSTRAINT '
          + QUOTENAME(N'FK_' + @name + N'_Tenant')
          + N' FOREIGN KEY (TenantId) REFERENCES dbo.Tenant (TenantId);';
        EXEC sp_executesql @stmt;
      END;

      SET @stmt = N'SELECT @has = CASE WHEN EXISTS (SELECT 1 FROM dbo.' + QUOTENAME(@name)
        + N' WHERE TenantId IS NULL) THEN 1 ELSE 0 END;';
      EXEC sp_executesql @stmt, N'@has BIT OUTPUT', @has = @hasRows OUTPUT;
      IF @hasRows = 1
      BEGIN
        IF @boot IS NULL
          THROW 51018, N'Legacy messaging rows exist but tenant CASHER_BOOT is missing', 1;
        SET @stmt = N'UPDATE dbo.' + QUOTENAME(@name) + N' SET TenantId = @boot WHERE TenantId IS NULL;';
        EXEC sp_executesql @stmt, N'@boot UNIQUEIDENTIFIER', @boot = @boot;
      END;

      IF NOT EXISTS (
        SELECT 1 FROM sys.indexes
        WHERE name = N'IX_' + @name + N'_Tenant' AND object_id = OBJECT_ID(N'dbo.' + @name)
      )
      BEGIN
        SET @stmt = N'CREATE INDEX ' + QUOTENAME(N'IX_' + @name + N'_Tenant')
          + N' ON dbo.' + QUOTENAME(@name) + N' (TenantId);';
        EXEC sp_executesql @stmt;
      END;
    END;
    FETCH NEXT FROM table_cursor INTO @name;
  END;
  CLOSE table_cursor;
  DEALLOCATE table_cursor;

  /*
    Tenant-leading uniqueness. Each row: table, legacy object, legacy kind
    (C = UNIQUE constraint, I = unique index), new index, key columns, filter.
  */
  DECLARE @uniques TABLE (
    TableName SYSNAME NOT NULL,
    LegacyName SYSNAME NOT NULL,
    LegacyKind CHAR(1) NOT NULL,
    NewName SYSNAME NOT NULL,
    Columns NVARCHAR(400) NOT NULL,
    FilterSql NVARCHAR(400) NULL
  );
  INSERT INTO @uniques (TableName, LegacyName, LegacyKind, NewName, Columns, FilterSql) VALUES
    (N'TblMessageInbox', N'UQ_TblMessageInbox_ProviderMessage', 'C',
      N'UX_TblMessageInbox_TenantProviderMessage', N'TenantId, Provider, ProviderMessageID', NULL),
    (N'TblMessageOutbox', N'UQ_TblMessageOutbox_IdempotencyKey', 'C',
      N'UX_TblMessageOutbox_TenantIdempotencyKey', N'TenantId, IdempotencyKey', NULL),
    (N'TblBotConversation', N'UQ_TblBotConversation_Identity', 'C',
      N'UX_TblBotConversation_TenantIdentity', N'TenantId, Channel, Provider, ExternalContactKey', NULL),
    (N'TblBotMessage', N'UX_TblBotMessage_Provider_ProviderMessageID', 'I',
      N'UX_TblBotMessage_TenantProviderMessage', N'TenantId, Provider, ProviderMessageID', NULL),
    (N'TblMessageTemplate', N'UX_TblMessageTemplate_ActiveGlobal', 'I',
      N'UX_TblMessageTemplate_TenantActiveGlobal', N'TenantId, Channel, TemplateKey, Language',
      N'IsActive = 1 AND BranchID IS NULL'),
    (N'TblWhatsAppOutboundCorrelation', N'IX_TblWhatsAppOutboundCorrelation_ProviderMessageID', 'I',
      N'UX_TblWhatsAppOutboundCorrelation_TenantProviderMessage', N'TenantId, ProviderMessageID',
      N'ProviderMessageID IS NOT NULL'),
    (N'TblSalonKnowledge', N'UQ_TblSalonKnowledge_ItemKey', 'C',
      N'UX_TblSalonKnowledge_TenantItemKey', N'TenantId, ItemKey', NULL),
    (N'TblSalonCapability', N'UQ_TblSalonCapability_Key', 'C',
      N'UX_TblSalonCapability_TenantKey', N'TenantId, CapabilityKey', NULL),
    (N'TblSalonExternalLink', N'UQ_TblSalonExternalLink_Key', 'C',
      N'UX_TblSalonExternalLink_TenantKey', N'TenantId, LinkKey', NULL),
    (N'TblSalonOffer', N'UQ_TblSalonOffer_Key', 'C',
      N'UX_TblSalonOffer_TenantKey', N'TenantId, OfferKey', NULL),
    (N'TblSalonBrandVoice', N'UQ_TblSalonBrandVoice_Key', 'C',
      N'UX_TblSalonBrandVoice_TenantKey', N'TenantId, ProfileKey', NULL),
    (N'TblSalonKnowledgeGap', N'UQ_TblSalonKnowledgeGap_Subject', 'C',
      N'UX_TblSalonKnowledgeGap_TenantSubject', N'TenantId, NormalizedSubject', NULL),
    (N'TblSalonBrandVoiceExample', N'UQ_TblSalonBrandVoiceExample_ScenarioKey', 'I',
      N'UX_TblSalonBrandVoiceExample_TenantScenarioKey', N'TenantId, ScenarioKey', NULL),
    (N'TblSalonKnowledgeSource', N'UQ_TblSalonKnowledgeSource_Name', 'I',
      N'UX_TblSalonKnowledgeSource_TenantName', N'TenantId, SourceName', NULL);

  DECLARE @t SYSNAME, @legacy SYSNAME, @kind CHAR(1), @new SYSNAME, @cols NVARCHAR(400), @filter NVARCHAR(400);
  DECLARE unique_cursor CURSOR LOCAL FAST_FORWARD FOR
    SELECT TableName, LegacyName, LegacyKind, NewName, Columns, FilterSql FROM @uniques;
  OPEN unique_cursor;
  FETCH NEXT FROM unique_cursor INTO @t, @legacy, @kind, @new, @cols, @filter;
  WHILE @@FETCH_STATUS = 0
  BEGIN
    IF OBJECT_ID(N'dbo.' + @t, N'U') IS NOT NULL
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = @new AND object_id = OBJECT_ID(N'dbo.' + @t))
      BEGIN
        SET @stmt = N'CREATE UNIQUE INDEX ' + QUOTENAME(@new) + N' ON dbo.' + QUOTENAME(@t)
          + N' (' + @cols + N')' + CASE WHEN @filter IS NULL THEN N'' ELSE N' WHERE ' + @filter END + N';';
        EXEC sp_executesql @stmt;
      END;

      IF @kind = 'C' AND EXISTS (
        SELECT 1 FROM sys.key_constraints WHERE name = @legacy AND parent_object_id = OBJECT_ID(N'dbo.' + @t)
      )
      BEGIN
        SET @stmt = N'ALTER TABLE dbo.' + QUOTENAME(@t) + N' DROP CONSTRAINT ' + QUOTENAME(@legacy) + N';';
        EXEC sp_executesql @stmt;
      END;

      IF @kind = 'I' AND EXISTS (
        SELECT 1 FROM sys.indexes WHERE name = @legacy AND object_id = OBJECT_ID(N'dbo.' + @t)
      )
      BEGIN
        SET @stmt = N'DROP INDEX ' + QUOTENAME(@legacy) + N' ON dbo.' + QUOTENAME(@t) + N';';
        EXEC sp_executesql @stmt;
      END;
    END;
    FETCH NEXT FROM unique_cursor INTO @t, @legacy, @kind, @new, @cols, @filter;
  END;
  CLOSE unique_cursor;
  DEALLOCATE unique_cursor;

  /* Tenant-first list paths used by tenant-scoped reads. */
  IF OBJECT_ID(N'dbo.TblMessageOutbox', N'U') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_TblMessageOutbox_TenantHistory' AND object_id = OBJECT_ID(N'dbo.TblMessageOutbox'))
    EXEC sp_executesql N'CREATE INDEX IX_TblMessageOutbox_TenantHistory ON dbo.TblMessageOutbox (TenantId, CreatedAt DESC, ID DESC) INCLUDE (BranchID, Status, Channel);';
  IF OBJECT_ID(N'dbo.TblMessageInbox', N'U') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_TblMessageInbox_TenantReceived' AND object_id = OBJECT_ID(N'dbo.TblMessageInbox'))
    EXEC sp_executesql N'CREATE INDEX IX_TblMessageInbox_TenantReceived ON dbo.TblMessageInbox (TenantId, ReceivedAt DESC, ID DESC);';
  IF OBJECT_ID(N'dbo.TblBotConversation', N'U') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_TblBotConversation_TenantLastMessage' AND object_id = OBJECT_ID(N'dbo.TblBotConversation'))
    EXEC sp_executesql N'CREATE INDEX IX_TblBotConversation_TenantLastMessage ON dbo.TblBotConversation (TenantId, LastMessageAt DESC, ConversationID DESC);';

  /* CASHER_BOOT keeps its current behavior through explicit tenant configuration. */
  IF @boot IS NOT NULL
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM dbo.TenantAiConfig WHERE TenantId = @boot)
      INSERT INTO dbo.TenantAiConfig (
        TenantId, Enabled, IndustryCode, BusinessName, AssistantPersona, Locale,
        WebsiteUrl, BookingUrl, PricesUrl, BusinessHoursJson, PoliciesJson,
        BookingActorUserId, ConversationPack
      )
      SELECT
        @boot, 1, N'salon', N'Cut Salon', N'صالون حلاقة مصري', N'ar-EG',
        N'https://cutsaloon.com', N'https://cutsaloon.com/book', N'https://cutsaloon.com/prices',
        N'[{"branchCode":"GLEEM","displayName":"فرع جليم","shortName":"جليم","openMinutes":660,"closeMinutes":120,"closeDayOffset":1,"scheduleLabel":"من 11 صباحًا لحد 2 بعد منتصف الليل","closeLabel":"2 بعد منتصف الليل","openLabel":"11 صباحًا"},{"branchCode":"CAMP_CAESAR","displayName":"فرع كامب شيزار","shortName":"كامب شيزار","openMinutes":720,"closeMinutes":60,"closeDayOffset":1,"scheduleLabel":"من 12 ظهرًا لحد 1 بعد منتصف الليل","closeLabel":"1 بعد منتصف الليل","openLabel":"12 ظهرًا"}]',
        NULL,
        (
          SELECT m.LegacyUserId FROM dbo.TenantMembership m
          WHERE m.TenantId = @boot AND m.LegacyUserId = 1
        ),
        N'salon-concierge-v1';

    IF NOT EXISTS (SELECT 1 FROM dbo.TenantMessagingChannel WHERE TenantId = @boot AND Channel = N'whatsapp')
      INSERT INTO dbo.TenantMessagingChannel (TenantId, Channel, Provider, Status)
      VALUES (@boot, N'whatsapp', N'whatsapp-bridge', N'pending');
  END;

  COMMIT TRAN;
  SELECT N'DRVO-018 messaging tenancy schema ready' AS Result;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRAN;
  THROW;
END CATCH;
