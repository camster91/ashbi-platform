# Data dictionary

<!-- GENERATED FILE: do not edit by hand. -->
<!-- Source: prisma/schema.prisma. Regenerate with `npm run docs:data-dictionary`; -->
<!-- CI runs `npm run check:data-dictionary` and fails when this file is stale. -->

Every Prisma model and enum in `prisma/schema.prisma`, as asked for in #412.

- **Tenant-scoped** means the model has an `organizationId` column. Whether
  request-scoped queries are filtered by it is decided by
  `src/utils/prisma-tenant-proxy.js`, not by this column alone; models without
  the column may still be tenant-owned through a parent relation.
- **Soft-deletable** means the model has a `deletedAt` column. The policy for
  which reads hide soft-deleted rows is in [soft-delete-policy.md](soft-delete-policy.md).
- **Notes** combine `///` doc comments and trailing `//` comments from the schema.

99 models, 0 enums, 45 tenant-scoped, 13 soft-deletable.

## Model index

| Model | Table | Tenant-scoped | Soft-deletable | Fields |
| --- | --- | --- | --- | --- |
| [Activity](#model-activity) | `activities` | no | no | 12 |
| [AiBridgeAction](#model-aibridgeaction) | `ai_bridge_actions` | yes | no | 26 |
| [AiContext](#model-aicontext) | `ai_context` | yes | no | 7 |
| [AiProviderConnection](#model-aiproviderconnection) | `ai_provider_connections` | yes | no | 20 |
| [AiTeamMessage](#model-aiteammessage) | `ai_team_messages` | no | no | 9 |
| [AiUsageRecord](#model-aiusagerecord) | `ai_usage_records` | yes | no | 15 |
| [ApiKey](#model-apikey) | `api_keys` | no | no | 12 |
| [Approval](#model-approval) | `approvals` | no | no | 16 |
| [AshChatMessage](#model-ashchatmessage) | `ash_chat_messages` | no | no | 6 |
| [AshConversation](#model-ashconversation) | `ash_conversations` | yes | no | 7 |
| [Asset](#model-asset) | `assets` | no | no | 15 |
| [AssignmentRule](#model-assignmentrule) | `assignment_rules` | yes | no | 11 |
| [Attachment](#model-attachment) | `attachments` | yes | no | 15 |
| [AuditEvent](#model-auditevent) | `audit_events` | yes | no | 12 |
| [BrandSettings](#model-brandsettings) | `brand_settings` | yes | no | 15 |
| [CalendarEvent](#model-calendarevent) | `calendar_events` | no | no | 22 |
| [ChatMessage](#model-chatmessage) | `chat_messages` | no | no | 20 |
| [ChatReaction](#model-chatreaction) | `chat_reactions` | no | no | 7 |
| [Client](#model-client) | `clients` | yes | yes | 53 |
| [ClientEmailMapping](#model-clientemailmapping) | `client_email_mappings` | no | no | 8 |
| [ClientEmbedding](#model-clientembedding) | `client_embeddings` | no | no | 10 |
| [ClientInvitation](#model-clientinvitation) | `client_invitations` | no | no | 8 |
| [Contact](#model-contact) | `contacts` | no | no | 9 |
| [Contract](#model-contract) | `contracts` | no | yes | 31 |
| [CreativeBrief](#model-creativebrief) | `creative_briefs` | no | no | 16 |
| [Credential](#model-credential) | `credentials` | yes | no | 16 |
| [CredentialAccessAudit](#model-credentialaccessaudit) | `credential_access_audits` | yes | no | 11 |
| [EmailTriageDraft](#model-emailtriagedraft) | `email_triage_drafts` | no | no | 10 |
| [EmailTriageItem](#model-emailtriageitem) | `email_triage_items` | yes | no | 14 |
| [Estimate](#model-estimate) | `estimates` | no | yes | 21 |
| [EventAttendee](#model-eventattendee) | `event_attendees` | no | no | 7 |
| [Expense](#model-expense) | `expenses` | no | yes | 19 |
| [FormDraft](#model-formdraft) | `form_drafts` | yes | no | 13 |
| [GoogleCalendarConnection](#model-googlecalendarconnection) | `google_calendar_connections` | yes | no | 14 |
| [ImportRun](#model-importrun) | `import_runs` | yes | no | 12 |
| [IntakeForm](#model-intakeform) | `intake_forms` | no | no | 11 |
| [IntakeFormResponse](#model-intakeformresponse) | `intake_form_responses` | no | no | 8 |
| [Integration](#model-integration) | `integrations` | yes | no | 11 |
| [InternalNote](#model-internalnote) | `internal_notes` | no | no | 7 |
| [Invoice](#model-invoice) | `invoices` | no | yes | 58 |
| [InvoiceLineItem](#model-invoicelineitem) | `invoice_line_items` | no | no | 9 |
| [InvoicePayment](#model-invoicepayment) | `invoice_payments` | no | no | 9 |
| [LineItemTemplate](#model-lineitemtemplate) | `line_item_templates` | yes | no | 11 |
| [MailgunWebhookReceipt](#model-mailgunwebhookreceipt) | `mailgun_webhook_receipts` | no | no | 3 |
| [Message](#model-message) | `messages` | no | no | 15 |
| [Milestone](#model-milestone) | `milestones` | no | yes | 13 |
| [Note](#model-note) | `notes` | no | yes | 18 |
| [Notification](#model-notification) | `notifications` | no | no | 10 |
| [NotionImportRecord](#model-notionimportrecord) | `notion_import_records` | yes | no | 14 |
| [OnboardingProgress](#model-onboardingprogress) | `onboarding_progress` | yes | no | 12 |
| [Organization](#model-organization) | `organizations` | no | no | 53 |
| [OutreachSequence](#model-outreachsequence) | `outreach_sequences` | yes | no | 10 |
| [PipelineDeal](#model-pipelinedeal) | `pipeline_deals` | no | no | 15 |
| [PipelineStage](#model-pipelinestage) | `pipeline_stages` | yes | no | 10 |
| [PlatformSetting](#model-platformsetting) | `platform_settings` | no | no | 5 |
| [Project](#model-project) | `projects` | yes | yes | 51 |
| [ProjectCommunication](#model-projectcommunication) | `project_communications` | no | no | 18 |
| [ProjectContext](#model-projectcontext) | `project_contexts` | no | no | 10 |
| [ProjectTemplate](#model-projecttemplate) | `project_templates` | yes | no | 10 |
| [PromptVersion](#model-promptversion) | `prompt_versions` | yes | no | 11 |
| [Proposal](#model-proposal) | `proposals` | no | yes | 43 |
| [ProposalLineItem](#model-proposallineitem) | `proposal_line_items` | no | no | 7 |
| [ProposalVersion](#model-proposalversion) | `proposal_versions` | no | no | 7 |
| [PublicInquiry](#model-publicinquiry) | `public_inquiries` | yes | no | 23 |
| [PushSubscription](#model-pushsubscription) | `push_subscriptions` | no | no | 7 |
| [RateCard](#model-ratecard) | `rate_cards` | no | no | 8 |
| [Report](#model-report) | `reports` | no | no | 9 |
| [Response](#model-response) | `responses` | no | no | 18 |
| [RetainerPlan](#model-retainerplan) | `retainer_plans` | no | yes | 23 |
| [RevenueSnapshot](#model-revenuesnapshot) | `revenue_snapshots` | no | no | 20 |
| [ReviewAnnotation](#model-reviewannotation) | `review_annotations` | no | no | 23 |
| [ReviewDecision](#model-reviewdecision) | `review_decisions` | no | no | 11 |
| [ReviewSession](#model-reviewsession) | `review_sessions` | yes | no | 19 |
| [ReviewShareLink](#model-reviewsharelink) | `review_share_links` | no | no | 13 |
| [RevisionRound](#model-revisionround) | `revision_rounds` | no | no | 10 |
| [SlackChannelMapping](#model-slackchannelmapping) | `slack_channel_mappings` | yes | no | 13 |
| [SlackEventReceipt](#model-slackeventreceipt) | `slack_event_receipts` | yes | no | 14 |
| [SlackImportRecord](#model-slackimportrecord) | `slack_import_records` | yes | no | 17 |
| [SlackInstallation](#model-slackinstallation) | `slack_installations` | yes | no | 15 |
| [Snippet](#model-snippet) | `snippets` | no | no | 13 |
| [SupportHourEntry](#model-supporthourentry) | `support_hours` | yes | no | 12 |
| [Task](#model-task) | `tasks` | no | yes | 38 |
| [TaskComment](#model-taskcomment) | `task_comments` | no | no | 9 |
| [TaskTemplate](#model-tasktemplate) | `task_templates` | yes | no | 8 |
| [Template](#model-template) | `templates` | yes | no | 11 |
| [Thread](#model-thread) | `threads` | no | no | 26 |
| [TimeEntry](#model-timeentry) | `time_entries` | no | yes | 23 |
| [TimeSession](#model-timesession) | `time_sessions` | no | no | 15 |
| [TrashedItem](#model-trasheditem) | `trashed_items` | yes | yes | 9 |
| [UnmatchedEmail](#model-unmatchedemail) | `unmatched_emails` | yes | no | 15 |
| [User](#model-user) | `users` | yes | no | 52 |
| [WPAlert](#model-wpalert) | `wp_alerts` | yes | no | 9 |
| [WPBackup](#model-wpbackup) | `wp_backups` | yes | no | 15 |
| [WPBridgeNonce](#model-wpbridgenonce) | `wp_bridge_nonces` | yes | no | 7 |
| [WPFleetOp](#model-wpfleetop) | `wp_fleet_ops` | yes | no | 11 |
| [WPMagicLoginLog](#model-wpmagicloginlog) | `wp_magic_login_log` | yes | no | 12 |
| [WPReport](#model-wpreport) | `wp_reports` | yes | no | 14 |
| [WPSite](#model-wpsite) | `wp_sites` | yes | no | 32 |
| [WeeklyDigest](#model-weeklydigest) | `weekly_digests` | yes | no | 14 |

## Models

### Model Activity

- Table: `activities`
- Tenant-scoped: no
- Soft-deletable: no
- Constraints and indexes:
  - `@@index([projectId, createdAt])`
  - `@@index([userId, createdAt])`
  - `@@index([entityType, entityId])`

| Field | Type | Modifiers | Default | Relation | Notes |
| --- | --- | --- | --- | --- | --- |
| `id` | String | id, required | `cuid()` |  |  |
| `type` | String | required |  |  | TASK_CREATED, TASK_COMPLETED, CHAT_MESSAGE, NOTE_CREATED, etc. |
| `action` | String | required |  |  | created, updated, deleted, completed, commented |
| `entityType` | String | required |  |  | TASK, PROJECT, THREAD, NOTE, MILESTONE, etc. |
| `entityId` | String | required |  |  |  |
| `entityName` | String | optional |  |  | Display name of the entity |
| `metadata` | String | optional |  |  | JSON: additional context |
| `projectId` | String | optional |  |  |  |
| `userId` | String | required |  |  |  |
| `createdAt` | DateTime | required | `now()` |  |  |
| `project` | Project | optional |  | → Project, via (projectId) → (id), onDelete Cascade |  |
| `user` | User | required |  | → User, via (userId) → (id) |  |

### Model AiBridgeAction

- Table: `ai_bridge_actions`
- Tenant-scoped: yes (`organizationId`)
- Soft-deletable: no
- Constraints and indexes:
  - `@@unique([userId, idempotencyKey])`
  - `@@index([organizationId, status, createdAt])`
  - `@@index([organizationId, action, createdAt])`

| Field | Type | Modifiers | Default | Relation | Notes |
| --- | --- | --- | --- | --- | --- |
| `id` | String | id, required | `cuid()` |  |  |
| `organizationId` | String | required |  |  |  |
| `userId` | String | required |  |  |  |
| `action` | String | required |  |  |  |
| `idempotencyKey` | String | required |  |  |  |
| `input` | Json | required |  |  |  |
| `inputHash` | String | required |  |  |  |
| `preview` | Json | required |  |  |  |
| `status` | String | required | `"PENDING_CONFIRMATION"` |  | PENDING_CONFIRMATION, EXECUTING, EXECUTED, FAILED, REJECTED, EXPIRED |
| `result` | Json | optional |  |  |  |
| `errorCode` | String | optional |  |  |  |
| `expiresAt` | DateTime | required |  |  |  |
| `confirmedAt` | DateTime | optional |  |  |  |
| `executedAt` | DateTime | optional |  |  |  |
| `createdAt` | DateTime | required | `now()` |  |  |
| `updatedAt` | DateTime | required, updatedAt |  |  |  |
| `source` | String | required | `"ai_bridge"` |  | ai_bridge, assistant |
| `toolClass` | String | required | `"execute"` |  | prepare, execute |
| `correlationId` | String | optional |  |  |  |
| `inputScope` | Json | optional |  |  | Record ids the scope resolver proved belong to the organization |
| `approverId` | String | optional |  |  | No foreign key: the receipt outlives the approver's account |
| `approvalEvidence` | Json | optional |  |  | { method, approverRole, requesterApproved, reauthenticated } |
| `outcome` | String | optional |  |  | succeeded, failed, unknown (set when execution ends) |
| `rejectedAt` | DateTime | optional |  |  |  |
| `organization` | Organization | required |  | → Organization, via (organizationId) → (id), onDelete Cascade |  |
| `user` | User | required |  | → User, via (userId) → (id), onDelete Cascade |  |

### Model AiContext

- Table: `ai_context`
- Tenant-scoped: yes (`organizationId`)
- Soft-deletable: no
- Constraints and indexes:
  - `@@index([organizationId])`

| Field | Type | Modifiers | Default | Relation | Notes |
| --- | --- | --- | --- | --- | --- |
| `id` | String | id, required | `cuid()` |  |  |
| `organizationId` | String | required |  |  |  |
| `organization` | Organization | required |  | → Organization, via (organizationId) → (id), onDelete Cascade |  |
| `key` | String | unique, required |  |  |  |
| `value` | String | required |  |  |  |
| `updatedAt` | DateTime | required, updatedAt |  |  |  |
| `createdAt` | DateTime | required | `now()` |  |  |

### Model AiProviderConnection

- Table: `ai_provider_connections`
- Tenant-scoped: yes (`organizationId`)
- Soft-deletable: no

| Field | Type | Modifiers | Default | Relation | Notes |
| --- | --- | --- | --- | --- | --- |
| `id` | String | id, required | `cuid()` |  |  |
| `organizationId` | String | unique, required |  |  |  |
| `organization` | Organization | required |  | → Organization, via (organizationId) → (id), onDelete Cascade |  |
| `providerKind` | String | required | `"openai_compatible"` |  | openai_compatible (CHECK constraint) |
| `baseUrl` | String | required |  |  |  |
| `encryptedApiKey` | String | optional |  |  | AES-256-GCM envelope; null once revoked |
| `keyLast4` | String | optional |  |  |  |
| `allowedModels` | String[] | list, required | `[]` |  |  |
| `defaultModel` | String | required |  |  |  |
| `monthlyBudgetCents` | Int | required |  |  |  |
| `status` | String | required | `"active"` |  | active, disabled, revoked (CHECK constraint) |
| `disabledReason` | String | optional |  |  |  |
| `lastValidatedAt` | DateTime | optional |  |  |  |
| `lastValidationError` | String | optional |  |  | AiProviderError type only, never provider text |
| `createdById` | String | optional |  |  | No FK: history must outlive the actor account |
| `rotatedAt` | DateTime | optional |  |  |  |
| `revokedAt` | DateTime | optional |  |  |  |
| `createdAt` | DateTime | required | `now()` |  |  |
| `updatedAt` | DateTime | required, updatedAt |  |  |  |
| `usageRecords` | AiUsageRecord[] | list, required |  | → AiUsageRecord |  |

### Model AiTeamMessage

- Table: `ai_team_messages`
- Tenant-scoped: no
- Soft-deletable: no
- Constraints and indexes:
  - `@@index([agentRole, createdAt])`

| Field | Type | Modifiers | Default | Relation | Notes |
| --- | --- | --- | --- | --- | --- |
| `id` | String | id, required | `cuid()` |  |  |
| `agentRole` | String | required |  |  | WEB_DESIGNER, WEB_DEVELOPER, PROJECT_MANAGER, MARKETING_MANAGER, SALES, LEGAL, BRANDING_EXPERT |
| `role` | String | required |  |  | USER or ASSISTANT |
| `content` | String | required |  |  |  |
| `clientId` | String | optional |  |  |  |
| `projectId` | String | optional |  |  |  |
| `createdAt` | DateTime | required | `now()` |  |  |
| `client` | Client | optional |  | → Client, via (clientId) → (id), onDelete SetNull |  |
| `project` | Project | optional |  | → Project, via (projectId) → (id), onDelete SetNull |  |

### Model AiUsageRecord

- Table: `ai_usage_records`
- Tenant-scoped: yes (`organizationId`)
- Soft-deletable: no
- Constraints and indexes:
  - `@@index([organizationId, createdAt])`
  - `@@index([connectionId, createdAt])`

| Field | Type | Modifiers | Default | Relation | Notes |
| --- | --- | --- | --- | --- | --- |
| `id` | String | id, required | `cuid()` |  |  |
| `organizationId` | String | required |  |  |  |
| `organization` | Organization | required |  | → Organization, via (organizationId) → (id), onDelete Cascade |  |
| `connectionId` | String | required |  |  |  |
| `connection` | AiProviderConnection | required |  | → AiProviderConnection, via (connectionId) → (id), onDelete Cascade |  |
| `model` | String | required |  |  |  |
| `promptTokens` | Int | required | `0` |  |  |
| `completionTokens` | Int | required | `0` |  |  |
| `usageEstimated` | Boolean | required | `false` |  | provider omitted usage; tokens estimated at ~4 chars each |
| `estimatedCostCents` | Float | optional |  |  | null when the model has no configured price |
| `feature` | String | optional |  |  | route pattern or job label that made the call |
| `requestId` | String | optional |  |  |  |
| `success` | Boolean | required |  |  |  |
| `errorType` | String | optional |  |  | AiProviderError type when success is false |
| `createdAt` | DateTime | required | `now()` |  |  |

### Model ApiKey

- Table: `api_keys`
- Tenant-scoped: no
- Soft-deletable: no

| Field | Type | Modifiers | Default | Relation | Notes |
| --- | --- | --- | --- | --- | --- |
| `id` | String | id, required | `cuid()` |  |  |
| `name` | String | required |  |  |  |
| `key` | String | unique, required |  |  |  |
| `userId` | String | required |  |  |  |
| `scopes` | String[] | list, required | `[]` |  |  |
| `lastUsedAt` | DateTime | optional |  |  |  |
| `expiresAt` | DateTime | optional |  |  |  |
| `revokedAt` | DateTime | optional |  |  |  |
| `isActive` | Boolean | required | `true` |  |  |
| `createdAt` | DateTime | required | `now()` |  |  |
| `updatedAt` | DateTime | required, updatedAt |  |  |  |
| `user` | User | required |  | → User, via (userId) → (id) |  |

### Model Approval

- Table: `approvals`
- Tenant-scoped: no
- Soft-deletable: no
- Constraints and indexes:
  - `@@index([status])`
  - `@@index([type])`
  - `@@index([createdAt])`

| Field | Type | Modifiers | Default | Relation | Notes |
| --- | --- | --- | --- | --- | --- |
| `id` | String | id, required | `cuid()` |  |  |
| `type` | String | required |  |  | EMAIL \| PROPOSAL \| CONTRACT \| DEPLOY \| POST \| INVOICE \| COPY \| OTHER |
| `status` | String | required | `"PENDING"` |  | PENDING \| APPROVED \| REJECTED \| EXPIRED |
| `title` | String | required |  |  |  |
| `clientName` | String | optional |  |  |  |
| `projectId` | String | optional |  |  |  |
| `content` | String | required |  |  | JSON string — full content (email body, post copy, etc.) |
| `metadata` | String | optional |  |  | JSON string — extra context (recipient, subject, channel, etc.) |
| `createdBy` | String | required |  |  | agent name e.g. "comms", "social", "finance" |
| `reviewedBy` | String | optional |  |  |  |
| `reviewedAt` | DateTime | optional |  |  |  |
| `reviewNote` | String | optional |  |  |  |
| `expiresAt` | DateTime | optional |  |  |  |
| `createdAt` | DateTime | required | `now()` |  |  |
| `updatedAt` | DateTime | required, updatedAt |  |  |  |
| `project` | Project | optional |  | → Project, via (projectId) → (id) |  |

### Model AshChatMessage

- Table: `ash_chat_messages`
- Tenant-scoped: no
- Soft-deletable: no

| Field | Type | Modifiers | Default | Relation | Notes |
| --- | --- | --- | --- | --- | --- |
| `id` | String | id, required | `cuid()` |  |  |
| `conversationId` | String | required |  |  |  |
| `conversation` | AshConversation | required |  | → AshConversation, via (conversationId) → (id), onDelete Cascade |  |
| `role` | String | required |  |  | "user" \| "assistant" |
| `content` | String | required |  |  |  |
| `createdAt` | DateTime | required | `now()` |  |  |

### Model AshConversation

- Table: `ash_conversations`
- Tenant-scoped: yes (`organizationId`)
- Soft-deletable: no
- Constraints and indexes:
  - `@@index([organizationId])`

| Field | Type | Modifiers | Default | Relation | Notes |
| --- | --- | --- | --- | --- | --- |
| `id` | String | id, required | `cuid()` |  |  |
| `organizationId` | String | required |  |  |  |
| `organization` | Organization | required |  | → Organization, via (organizationId) → (id), onDelete Cascade |  |
| `title` | String | optional |  |  |  |
| `createdAt` | DateTime | required | `now()` |  |  |
| `updatedAt` | DateTime | required, updatedAt |  |  |  |
| `messages` | AshChatMessage[] | list, required |  | → AshChatMessage |  |

### Model Asset

- Table: `assets`
- Tenant-scoped: no
- Soft-deletable: no

| Field | Type | Modifiers | Default | Relation | Notes |
| --- | --- | --- | --- | --- | --- |
| `id` | String | id, required | `cuid()` |  |  |
| `name` | String | required |  |  |  |
| `type` | String | required | `"IMAGE"` |  | IMAGE \| VIDEO \| FONT \| ICON \| DOCUMENT \| TEMPLATE |
| `url` | String | required |  |  |  |
| `thumbnailUrl` | String | optional |  |  |  |
| `size` | Int | optional |  |  | File size in bytes |
| `mimeType` | String | optional |  |  |  |
| `altText` | String | optional |  |  |  |
| `tags` | String | required | `"[]"` |  | JSON: array of tag strings |
| `clientId` | String | optional |  |  |  |
| `folderId` | String | optional |  |  | For nested folder structure |
| `isGlobal` | Boolean | required | `false` |  | Available to all clients vs client-specific |
| `createdAt` | DateTime | required | `now()` |  |  |
| `updatedAt` | DateTime | required, updatedAt |  |  |  |
| `client` | Client | optional |  | → Client, via (clientId) → (id) |  |

### Model AssignmentRule

- Table: `assignment_rules`
- Tenant-scoped: yes (`organizationId`)
- Soft-deletable: no
- Constraints and indexes:
  - `@@index([isActive])`
  - `@@index([organizationId])`

| Field | Type | Modifiers | Default | Relation | Notes |
| --- | --- | --- | --- | --- | --- |
| `id` | String | id, required | `cuid()` |  |  |
| `organizationId` | String | required |  |  |  |
| `organization` | Organization | required |  | → Organization, via (organizationId) → (id), onDelete Cascade |  |
| `name` | String | required |  |  |  |
| `type` | String | required |  |  | SKILL, CLIENT, PROJECT, LOAD_BALANCE |
| `conditions` | String | required |  |  | JSON: rule conditions |
| `assignToId` | String | optional |  |  |  |
| `priority` | Int | required | `0` |  |  |
| `isActive` | Boolean | required | `true` |  |  |
| `createdAt` | DateTime | required | `now()` |  |  |
| `updatedAt` | DateTime | required, updatedAt |  |  |  |

### Model Attachment

- Table: `attachments`
- Tenant-scoped: yes (`organizationId`)
- Soft-deletable: no
- Constraints and indexes:
  - `@@index([organizationId])`

| Field | Type | Modifiers | Default | Relation | Notes |
| --- | --- | --- | --- | --- | --- |
| `id` | String | id, required | `cuid()` |  |  |
| `organizationId` | String | required |  |  |  |
| `filename` | String | required |  |  |  |
| `originalName` | String | required |  |  |  |
| `mimeType` | String | required |  |  |  |
| `size` | Int | required |  |  | Size in bytes |
| `path` | String | required |  |  | Storage path or URL |
| `thumbnailPath` | String | optional |  |  | For images |
| `entityType` | String | required |  |  | PROJECT, TASK, CHAT, NOTE |
| `entityId` | String | required |  |  |  |
| `uploadedById` | String | required |  |  |  |
| `createdAt` | DateTime | required | `now()` |  |  |
| `uploadedBy` | User | required |  | → User, via (uploadedById) → (id) |  |
| `organization` | Organization | required |  | → Organization, via (organizationId) → (id) |  |
| `reviewSessions` | ReviewSession[] | list, required |  | → ReviewSession |  |

### Model AuditEvent

- Table: `audit_events`
- Tenant-scoped: yes (`organizationId`)
- Soft-deletable: no
- Constraints and indexes:
  - `@@index([organizationId, createdAt, id])`
  - `@@index([organizationId, entityType, entityId, createdAt])`
  - `@@index([organizationId, action, createdAt])`
  - `@@index([organizationId, actorUserId, createdAt])`

| Field | Type | Modifiers | Default | Relation | Notes |
| --- | --- | --- | --- | --- | --- |
| `id` | String | id, required | `cuid()` |  |  |
| `organizationId` | String | required |  |  |  |
| `organization` | Organization | required |  | → Organization, via (organizationId) → (id), onDelete Restrict |  |
| `actorUserId` | String | optional |  |  | No FK: history must outlive the actor account |
| `actorType` | String | required |  |  | USER, CLIENT, SYSTEM, WEBHOOK, BOT (CHECK constraint) |
| `action` | String | required |  |  | e.g. invoice.sent — see docs/audit-events.md |
| `entityType` | String | required |  |  |  |
| `entityId` | String | optional |  |  |  |
| `requestId` | String | optional |  |  | Fastify request id; correlates with request logs |
| `ip` | String | optional |  |  | Truncated network prefix only (IPv4 /24, IPv6 /48) |
| `metadata` | Json | required | `"{}"` |  |  |
| `createdAt` | DateTime | required | `now()` |  |  |

### Model BrandSettings

- Table: `brand_settings`
- Tenant-scoped: yes (`organizationId`)
- Soft-deletable: no
- Constraints and indexes:
  - `@@index([organizationId])`

| Field | Type | Modifiers | Default | Relation | Notes |
| --- | --- | --- | --- | --- | --- |
| `id` | String | id, required | `cuid()` |  |  |
| `organizationId` | String | required |  |  |  |
| `organization` | Organization | required |  | → Organization, via (organizationId) → (id), onDelete Cascade |  |
| `companyName` | String | required | `"Ashbi Design"` |  |  |
| `logoUrl` | String | optional |  |  |  |
| `primaryColor` | String | required | `"#c9a84c"` |  |  |
| `accentColor` | String | required | `"#1e293b"` |  |  |
| `address` | String | optional |  |  |  |
| `phone` | String | optional |  |  |  |
| `email` | String | optional |  |  |  |
| `website` | String | optional |  |  |  |
| `taxId` | String | optional |  |  | HST number |
| `invoiceFooter` | String | optional |  |  | Custom footer text for invoices |
| `proposalFooter` | String | optional |  |  |  |
| `contractHeader` | String | optional |  |  |  |

### Model CalendarEvent

- Table: `calendar_events`
- Tenant-scoped: no
- Soft-deletable: no
- Constraints and indexes:
  - `@@index([startTime])`
  - `@@index([projectId, startTime])`

| Field | Type | Modifiers | Default | Relation | Notes |
| --- | --- | --- | --- | --- | --- |
| `id` | String | id, required | `cuid()` |  |  |
| `title` | String | required |  |  |  |
| `description` | String | optional |  |  |  |
| `startTime` | DateTime | required |  |  |  |
| `endTime` | DateTime | required |  |  |  |
| `type` | String | required | `"MEETING"` |  | MEETING, DEADLINE, REMINDER, MILESTONE |
| `location` | String | optional |  |  | Physical location or video call link |
| `isAllDay` | Boolean | required | `false` |  |  |
| `color` | String | required | `"#3B82F6"` |  |  |
| `recurrence` | String | optional |  |  | JSON: recurrence rules |
| `googleEventId` | String | unique, optional |  |  |  |
| `googleEventUrl` | String | optional |  |  |  |
| `googleSyncStatus` | String | required | `"NOT_CONNECTED"` |  | NOT_CONNECTED, SYNCED, FAILED |
| `googleSyncError` | String | optional |  |  |  |
| `googleSyncedAt` | DateTime | optional |  |  |  |
| `projectId` | String | optional |  |  |  |
| `createdById` | String | required |  |  |  |
| `createdAt` | DateTime | required | `now()` |  |  |
| `updatedAt` | DateTime | required, updatedAt |  |  |  |
| `project` | Project | optional |  | → Project, via (projectId) → (id), onDelete Cascade |  |
| `createdBy` | User | required |  | → User, via (createdById) → (id), "EventCreator" |  |
| `attendees` | EventAttendee[] | list, required |  | → EventAttendee |  |

### Model ChatMessage

- Table: `chat_messages`
- Tenant-scoped: no
- Soft-deletable: no
- Constraints and indexes:
  - `@@index([projectId])`
  - `@@index([projectId, createdAt])`
  - `@@index([projectId, externalSource, externalMessageId])`
  - `@@index([projectId, externalSource, externalThreadId])`

| Field | Type | Modifiers | Default | Relation | Notes |
| --- | --- | --- | --- | --- | --- |
| `id` | String | id, required | `cuid()` |  |  |
| `content` | String | required |  |  |  |
| `type` | String | required | `"TEXT"` |  | TEXT, FILE, SYSTEM |
| `metadata` | String | optional |  |  | JSON: file info, mentions, etc. |
| `externalSource` | String | optional |  |  | e.g. SLACK; never treated as an Ashbi user |
| `externalAuthorName` | String | optional |  |  |  |
| `externalMessageId` | String | optional |  |  | Provider-native message identifier for durable reconciliation |
| `externalThreadId` | String | optional |  |  | Provider-native root-thread identifier |
| `isEdited` | Boolean | required | `false` |  |  |
| `editedAt` | DateTime | optional |  |  |  |
| `parentId` | String | optional |  |  | For thread replies |
| `projectId` | String | required |  |  |  |
| `authorId` | String | optional |  |  |  |
| `createdAt` | DateTime | required | `now()` |  |  |
| `updatedAt` | DateTime | required, updatedAt |  |  |  |
| `project` | Project | required |  | → Project, via (projectId) → (id), onDelete Cascade |  |
| `author` | User | optional |  | → User, via (authorId) → (id), "ChatAuthor" |  |
| `parent` | ChatMessage | optional |  | → ChatMessage, via (parentId) → (id), onDelete NoAction, "ChatReplies" |  |
| `replies` | ChatMessage[] | list, required |  | → ChatMessage, "ChatReplies" |  |
| `reactions` | ChatReaction[] | list, required |  | → ChatReaction |  |

### Model ChatReaction

- Table: `chat_reactions`
- Tenant-scoped: no
- Soft-deletable: no
- Constraints and indexes:
  - `@@unique([messageId, userId, emoji])`

| Field | Type | Modifiers | Default | Relation | Notes |
| --- | --- | --- | --- | --- | --- |
| `id` | String | id, required | `cuid()` |  |  |
| `emoji` | String | required |  |  |  |
| `messageId` | String | required |  |  |  |
| `userId` | String | required |  |  |  |
| `createdAt` | DateTime | required | `now()` |  |  |
| `message` | ChatMessage | required |  | → ChatMessage, via (messageId) → (id), onDelete Cascade |  |
| `user` | User | required |  | → User, via (userId) → (id) |  |

### Model Client

- Table: `clients`
- Tenant-scoped: yes (`organizationId`)
- Soft-deletable: yes (`deletedAt`)
- Constraints and indexes:
  - `@@index([status])`
  - `@@index([organizationId])`

| Field | Type | Modifiers | Default | Relation | Notes |
| --- | --- | --- | --- | --- | --- |
| `id` | String | id, required | `cuid()` |  |  |
| `organizationId` | String | required |  |  |  |
| `organization` | Organization | required |  | → Organization, via (organizationId) → (id) |  |
| `name` | String | required |  |  |  |
| `email` | String | optional |  |  |  |
| `domain` | String | unique, optional |  |  |  |
| `status` | String | required | `"ACTIVE"` |  | ACTIVE, PAUSED, CHURNED |
| `communicationPrefs` | String | required | `"{}"` |  | JSON: tone, frequency, etc. |
| `satisfactionSignals` | String | required | `"{}"` |  | JSON: sentiment trends |
| `slaOverrides` | String | optional |  |  | JSON: custom SLA rules |
| `knowledgeBase` | String | required | `"[]"` |  | JSON: brand guidelines, specs, etc. |
| `bonsaiClientId` | String | optional |  |  | Original Bonsai client ID |
| `tier` | String | required | `"T3"` |  | T1 \| T2 \| T3 |
| `contactPerson` | String | optional |  |  |  |
| `phone` | String | optional |  |  |  |
| `address` | String | optional |  |  |  |
| `city` | String | optional |  |  |  |
| `provinceState` | String | optional |  |  |  |
| `postalCode` | String | optional |  |  |  |
| `country` | String | required | `"US"` |  |  |
| `serviceType` | String | optional |  |  |  |
| `relationshipStatus` | String | required | `"ACTIVE"` |  | ACTIVE \| ARCHIVED \| LEAD \| CHURNED |
| `totalRevenueUsd` | Float | required | `0` |  |  |
| `totalRevenueCad` | Float | required | `0` |  |  |
| `lastInvoiceDate` | DateTime | optional |  |  |  |
| `lastInvoiceStatus` | String | optional |  |  |  |
| `paymentStatus` | String | optional |  |  |  |
| `clientNotes` | String | optional |  |  |  |
| `createdAt` | DateTime | required | `now()` |  |  |
| `updatedAt` | DateTime | required, updatedAt |  |  |  |
| `deletedAt` | DateTime | optional |  |  |  |
| `contacts` | Contact[] | list, required |  | → Contact |  |
| `projects` | Project[] | list, required |  | → Project |  |
| `threads` | Thread[] | list, required |  | → Thread |  |
| `retainerPlan` | RetainerPlan | optional |  | → RetainerPlan |  |
| `reports` | Report[] | list, required |  | → Report |  |
| `proposals` | Proposal[] | list, required |  | → Proposal |  |
| `contracts` | Contract[] | list, required |  | → Contract |  |
| `invoices` | Invoice[] | list, required |  | → Invoice |  |
| `credentials` | Credential[] | list, required |  | → Credential |  |
| `aiTeamMessages` | AiTeamMessage[] | list, required |  | → AiTeamMessage |  |
| `expenses` | Expense[] | list, required |  | → Expense |  |
| `revenueSnapshots` | RevenueSnapshot[] | list, required |  | → RevenueSnapshot |  |
| `emailMappings` | ClientEmailMapping[] | list, required |  | → ClientEmailMapping |  |
| `intakeForms` | IntakeForm[] | list, required |  | → IntakeForm |  |
| `pipelineDeals` | PipelineDeal[] | list, required |  | → PipelineDeal |  |
| `creativeBriefs` | CreativeBrief[] | list, required |  | → CreativeBrief |  |
| `assets` | Asset[] | list, required |  | → Asset |  |
| `clientEmbeddings` | ClientEmbedding[] | list, required |  | → ClientEmbedding |  |
| `invitations` | ClientInvitation[] | list, required |  | → ClientInvitation |  |
| `wpSites` | WPSite[] | list, required |  | → WPSite, "WPSiteClient" |  |
| `estimates` | Estimate[] | list, required |  | → Estimate |  |
| `rateCards` | RateCard[] | list, required |  | → RateCard |  |

### Model ClientEmailMapping

- Table: `client_email_mappings`
- Tenant-scoped: no
- Soft-deletable: no
- Constraints and indexes:
  - `@@unique([emailAddress, clientId])`

| Field | Type | Modifiers | Default | Relation | Notes |
| --- | --- | --- | --- | --- | --- |
| `id` | String | id, required | `cuid()` |  |  |
| `clientId` | String | required |  |  |  |
| `emailAddress` | String | required |  |  |  |
| `emailDomain` | String | optional |  |  |  |
| `contactName` | String | optional |  |  |  |
| `isPrimary` | Boolean | required | `false` |  |  |
| `createdAt` | DateTime | required | `now()` |  |  |
| `client` | Client | required |  | → Client, via (clientId) → (id), onDelete Cascade |  |

### Model ClientEmbedding

- Table: `client_embeddings`
- Tenant-scoped: no
- Soft-deletable: no
- Constraints and indexes:
  - `@@index([clientId])`
  - `@@index([source])`

| Field | Type | Modifiers | Default | Relation | Notes |
| --- | --- | --- | --- | --- | --- |
| `id` | String | id, required | `cuid()` |  |  |
| `clientId` | String | required |  |  |  |
| `source` | String | required |  |  | EMAIL \| NOTE \| CALL \| INVOICE \| PROPOSAL \| PROJECT \| MANUAL |
| `sourceId` | String | optional |  |  | ID of the source record |
| `content` | String | required |  |  | The text content that was embedded |
| `embedding` | Unsupported("vector(768)") | optional |  |  | pgvector embedding |
| `metadata` | String | required | `"{}"` |  | JSON: additional context |
| `createdAt` | DateTime | required | `now()` |  |  |
| `updatedAt` | DateTime | required, updatedAt |  |  |  |
| `client` | Client | required |  | → Client, via (clientId) → (id), onDelete Cascade |  |

### Model ClientInvitation

- Table: `client_invitations`
- Tenant-scoped: no
- Soft-deletable: no

| Field | Type | Modifiers | Default | Relation | Notes |
| --- | --- | --- | --- | --- | --- |
| `id` | String | id, required | `cuid()` |  |  |
| `token` | String | unique, required |  |  |  |
| `email` | String | required |  |  |  |
| `clientId` | String | required |  |  |  |
| `expiresAt` | DateTime | required |  |  |  |
| `usedAt` | DateTime | optional |  |  |  |
| `createdAt` | DateTime | required | `now()` |  |  |
| `client` | Client | required |  | → Client, via (clientId) → (id) |  |

### Model Contact

- Table: `contacts`
- Tenant-scoped: no
- Soft-deletable: no
- Constraints and indexes:
  - `@@unique([email, clientId])`

| Field | Type | Modifiers | Default | Relation | Notes |
| --- | --- | --- | --- | --- | --- |
| `id` | String | id, required | `cuid()` |  |  |
| `email` | String | required |  |  |  |
| `name` | String | required |  |  |  |
| `role` | String | optional |  |  |  |
| `isPrimary` | Boolean | required | `false` |  |  |
| `clientId` | String | required |  |  |  |
| `createdAt` | DateTime | required | `now()` |  |  |
| `updatedAt` | DateTime | required, updatedAt |  |  |  |
| `client` | Client | required |  | → Client, via (clientId) → (id), onDelete Cascade |  |

### Model Contract

- Table: `contracts`
- Tenant-scoped: no
- Soft-deletable: yes (`deletedAt`)
- Constraints and indexes:
  - `@@index([status])`
  - `@@index([clientId, status])`

| Field | Type | Modifiers | Default | Relation | Notes |
| --- | --- | --- | --- | --- | --- |
| `id` | String | id, required | `cuid()` |  |  |
| `title` | String | required |  |  |  |
| `status` | String | required | `"DRAFT"` |  | DRAFT \| SENT \| SIGNED \| VOID |
| `content` | String | required |  |  | Rich text / HTML contract body |
| `templateType` | String | required | `"RETAINER"` |  | RETAINER \| PROJECT \| NDA |
| `signToken` | String | unique, required | `cuid()` |  |  |
| `publicAccessExpiresAt` | DateTime | optional |  |  |  |
| `publicAccessRevokedAt` | DateTime | optional |  |  |  |
| `clientSigHash` | String | optional |  |  |  |
| `clientSigName` | String | optional |  |  |  |
| `clientSigDate` | DateTime | optional |  |  |  |
| `signedAt` | DateTime | optional |  |  |  |
| `signedContentHash` | String | optional |  |  |  |
| `signatureType` | String | optional |  |  |  |
| `signatureDataHash` | String | optional |  |  |  |
| `signerIp` | String | optional |  |  |  |
| `signerUserAgent` | String | optional |  |  |  |
| `deliveryMessageId` | String | optional |  |  |  |
| `deliveryStatus` | String | optional |  |  | ACCEPTED \| DELIVERED \| FAILED \| BOUNCED \| COMPLAINED |
| `deliveryStatusAt` | DateTime | optional |  |  |  |
| `deliveryError` | String | optional |  |  |  |
| `proposalId` | String | unique, optional |  |  |  |
| `clientId` | String | required |  |  |  |
| `createdById` | String | required |  |  |  |
| `createdAt` | DateTime | required | `now()` |  |  |
| `updatedAt` | DateTime | required, updatedAt |  |  |  |
| `proposal` | Proposal | optional |  | → Proposal, via (proposalId) → (id) |  |
| `client` | Client | required |  | → Client, via (clientId) → (id), onDelete Cascade |  |
| `createdBy` | User | required |  | → User, via (createdById) → (id), "ContractCreator" |  |
| `deletedAt` | DateTime | optional |  |  |  |
| `draftData` | String | optional |  |  | JSON of unsaved form data |

### Model CreativeBrief

- Table: `creative_briefs`
- Tenant-scoped: no
- Soft-deletable: no
- Constraints and indexes:
  - `@@index([clientId])`

| Field | Type | Modifiers | Default | Relation | Notes |
| --- | --- | --- | --- | --- | --- |
| `id` | String | id, required | `cuid()` |  |  |
| `title` | String | required |  |  |  |
| `clientId` | String | required |  |  |  |
| `projectId` | String | optional |  |  |  |
| `objective` | String | optional |  |  | Brief objective/goal |
| `targetAudience` | String | optional |  |  | JSON: audience demographics |
| `tone` | String | optional |  |  | Brand tone/personality |
| `deliverables` | String | required | `"[]"` |  | JSON: list of expected deliverables |
| `references` | String | required | `"[]"` |  | JSON: reference URLs/descriptions |
| `constraints` | String | optional |  |  | Budget, timeline, brand constraints |
| `status` | String | required | `"DRAFT"` |  | DRAFT \| APPROVED \| IN_PROGRESS \| COMPLETED |
| `aiGenerated` | Boolean | required | `false` |  |  |
| `createdAt` | DateTime | required | `now()` |  |  |
| `updatedAt` | DateTime | required, updatedAt |  |  |  |
| `client` | Client | optional |  | → Client, via (clientId) → (id), onDelete Cascade |  |
| `project` | Project | optional |  | → Project, via (projectId) → (id) |  |

### Model Credential

- Table: `credentials`
- Tenant-scoped: yes (`organizationId`)
- Soft-deletable: no
- Constraints and indexes:
  - `@@index([clientId])`
  - `@@index([projectId])`
  - `@@index([organizationId])`

| Field | Type | Modifiers | Default | Relation | Notes |
| --- | --- | --- | --- | --- | --- |
| `id` | String | id, required | `cuid()` |  |  |
| `organizationId` | String | required |  |  |  |
| `organization` | Organization | required |  | → Organization, via (organizationId) → (id), onDelete Restrict |  |
| `label` | String | required |  |  |  |
| `username` | String | optional |  |  |  |
| `password` | String | required |  |  | Versioned AES-256-GCM envelope |
| `encryptionVersion` | String | required | `"legacy"` |  |  |
| `url` | String | optional |  |  |  |
| `notes` | String | optional |  |  |  |
| `category` | String | required | `"OTHER"` |  | WP_ADMIN, HOSTING, DNS, FTP, STRIPE, OTHER |
| `clientId` | String | optional |  |  |  |
| `projectId` | String | optional |  |  |  |
| `createdAt` | DateTime | required | `now()` |  |  |
| `updatedAt` | DateTime | required, updatedAt |  |  |  |
| `client` | Client | optional |  | → Client, via (clientId) → (id), onDelete Cascade |  |
| `project` | Project | optional |  | → Project, via (projectId) → (id), onDelete Cascade |  |

### Model CredentialAccessAudit

- Table: `credential_access_audits`
- Tenant-scoped: yes (`organizationId`)
- Soft-deletable: no
- Constraints and indexes:
  - `@@index([organizationId, createdAt])`
  - `@@index([credentialId, createdAt])`
  - `@@index([actorUserId, createdAt])`

| Field | Type | Modifiers | Default | Relation | Notes |
| --- | --- | --- | --- | --- | --- |
| `id` | String | id, required | `cuid()` |  |  |
| `organizationId` | String | required |  |  |  |
| `organization` | Organization | required |  | → Organization, via (organizationId) → (id), onDelete Restrict |  |
| `credentialId` | String | required |  |  |  |
| `actorUserId` | String | required |  |  |  |
| `purpose` | String | required |  |  |  |
| `outcome` | String | required |  |  |  |
| `route` | String | required |  |  |  |
| `traceId` | String | optional |  |  |  |
| `keyVersion` | String | optional |  |  |  |
| `createdAt` | DateTime | required | `now()` |  |  |

### Model EmailTriageDraft

- Table: `email_triage_drafts`
- Tenant-scoped: no
- Soft-deletable: no

| Field | Type | Modifiers | Default | Relation | Notes |
| --- | --- | --- | --- | --- | --- |
| `id` | String | id, required | `cuid()` |  |  |
| `option` | Int | required | `1` |  | 1 or 2 |
| `subject` | String | required |  |  |  |
| `body` | String | required |  |  |  |
| `tone` | String | optional |  |  |  |
| `status` | String | required | `"DRAFT"` |  | DRAFT \| APPROVED \| SENT |
| `itemId` | String | required |  |  |  |
| `createdAt` | DateTime | required | `now()` |  |  |
| `updatedAt` | DateTime | required, updatedAt |  |  |  |
| `item` | EmailTriageItem | required |  | → EmailTriageItem, via (itemId) → (id), onDelete Cascade |  |

### Model EmailTriageItem

- Table: `email_triage_items`
- Tenant-scoped: yes (`organizationId`)
- Soft-deletable: no
- Constraints and indexes:
  - `@@index([status])`
  - `@@index([createdAt])`
  - `@@index([organizationId])`

| Field | Type | Modifiers | Default | Relation | Notes |
| --- | --- | --- | --- | --- | --- |
| `id` | String | id, required | `cuid()` |  |  |
| `organizationId` | String | required |  |  |  |
| `organization` | Organization | required |  | → Organization, via (organizationId) → (id), onDelete Cascade |  |
| `subject` | String | required |  |  |  |
| `senderEmail` | String | required |  |  |  |
| `senderName` | String | optional |  |  |  |
| `bodyText` | String | required |  |  |  |
| `tags` | String | required | `"[]"` |  | JSON: ['needs-reply', 'info-only', 'urgent', 'client', 'lead', 'spam'] |
| `status` | String | required | `"PENDING"` |  | PENDING \| REVIEWED \| ARCHIVED |
| `aiSummary` | String | optional |  |  |  |
| `threadId` | String | optional |  |  | Link to existing Thread if matched |
| `createdAt` | DateTime | required | `now()` |  |  |
| `updatedAt` | DateTime | required, updatedAt |  |  |  |
| `drafts` | EmailTriageDraft[] | list, required |  | → EmailTriageDraft |  |

### Model Estimate

- Table: `estimates`
- Tenant-scoped: no
- Soft-deletable: yes (`deletedAt`)
- Constraints and indexes:
  - `@@index([clientId])`
  - `@@index([status])`

| Field | Type | Modifiers | Default | Relation | Notes |
| --- | --- | --- | --- | --- | --- |
| `id` | String | id, required | `cuid()` |  |  |
| `clientId` | String | required |  |  |  |
| `client` | Client | required |  | → Client, via (clientId) → (id), onDelete Cascade |  |
| `title` | String | required |  |  |  |
| `description` | String | optional |  |  |  |
| `status` | String | required | `"DRAFT"` |  | DRAFT, SENT, APPROVED, DECLINED, CONVERTED |
| `lineItems` | Json | required | `"[]"` |  | [{description, quantity, rate, amount}] |
| `subtotal` | Float | required | `0` |  |  |
| `tax` | Float | required | `0` |  |  |
| `total` | Float | required | `0` |  |  |
| `validUntil` | DateTime | optional |  |  |  |
| `viewToken` | String | unique, required | `cuid()` |  |  |
| `sentAt` | DateTime | optional |  |  |  |
| `deliveryMessageId` | String | optional |  |  |  |
| `deliveryStatus` | String | optional |  |  | ACCEPTED \| DELIVERED \| FAILED \| BOUNCED \| COMPLAINED |
| `deliveryStatusAt` | DateTime | optional |  |  |  |
| `deliveryError` | String | optional |  |  |  |
| `createdAt` | DateTime | required | `now()` |  |  |
| `updatedAt` | DateTime | required, updatedAt |  |  |  |
| `deletedAt` | DateTime | optional |  |  |  |
| `draftData` | String | optional |  |  | JSON of unsaved form data |

### Model EventAttendee

- Table: `event_attendees`
- Tenant-scoped: no
- Soft-deletable: no
- Constraints and indexes:
  - `@@unique([eventId, userId])`

| Field | Type | Modifiers | Default | Relation | Notes |
| --- | --- | --- | --- | --- | --- |
| `id` | String | id, required | `cuid()` |  |  |
| `status` | String | required | `"PENDING"` |  | PENDING, ACCEPTED, DECLINED, TENTATIVE |
| `eventId` | String | required |  |  |  |
| `userId` | String | required |  |  |  |
| `createdAt` | DateTime | required | `now()` |  |  |
| `event` | CalendarEvent | required |  | → CalendarEvent, via (eventId) → (id), onDelete Cascade |  |
| `user` | User | required |  | → User, via (userId) → (id) |  |

### Model Expense

- Table: `expenses`
- Tenant-scoped: no
- Soft-deletable: yes (`deletedAt`)
- Constraints and indexes:
  - `@@index([clientId])`
  - `@@index([projectId])`
  - `@@index([invoiceId])`

| Field | Type | Modifiers | Default | Relation | Notes |
| --- | --- | --- | --- | --- | --- |
| `id` | String | id, required | `cuid()` |  |  |
| `description` | String | required |  |  |  |
| `amount` | Float | required |  |  |  |
| `currency` | String | required | `"USD"` |  | USD \| CAD |
| `category` | String | required | `"OTHER"` |  | SOFTWARE \| SUBCONTRACTOR \| HOSTING \| MARKETING \| TRAVEL \| SUPPLIES \| OTHER |
| `date` | DateTime | required | `now()` |  |  |
| `billable` | Boolean | required | `false` |  |  |
| `invoiced` | Boolean | required | `false` |  |  |
| `receiptUrl` | String | optional |  |  |  |
| `notes` | String | optional |  |  |  |
| `clientId` | String | optional |  |  |  |
| `projectId` | String | optional |  |  |  |
| `invoiceId` | String | optional |  |  |  |
| `createdAt` | DateTime | required | `now()` |  |  |
| `updatedAt` | DateTime | required, updatedAt |  |  |  |
| `client` | Client | optional |  | → Client, via (clientId) → (id) |  |
| `project` | Project | optional |  | → Project, via (projectId) → (id) |  |
| `invoice` | Invoice | optional |  | → Invoice, via (invoiceId) → (id) |  |
| `deletedAt` | DateTime | optional |  |  |  |

### Model FormDraft

- Table: `form_drafts`
- Tenant-scoped: yes (`organizationId`)
- Soft-deletable: no
- Constraints and indexes:
  - `@@unique([userId, entity, entityId])`
  - `@@index([organizationId, userId])`
  - `@@index([expiresAt])`

| Field | Type | Modifiers | Default | Relation | Notes |
| --- | --- | --- | --- | --- | --- |
| `id` | String | id, required | `cuid()` |  |  |
| `organizationId` | String | required |  |  |  |
| `organization` | Organization | required |  | → Organization, via (organizationId) → (id), onDelete Cascade |  |
| `userId` | String | required |  |  |  |
| `user` | User | required |  | → User, via (userId) → (id), onDelete Cascade |  |
| `entity` | String | required |  |  |  |
| `entityId` | String | required |  |  |  |
| `data` | Json | required |  |  |  |
| `revision` | Int | required | `1` |  |  |
| `baseUpdatedAt` | DateTime | optional |  |  |  |
| `expiresAt` | DateTime | required |  |  |  |
| `createdAt` | DateTime | required | `now()` |  |  |
| `updatedAt` | DateTime | required, updatedAt |  |  |  |

### Model GoogleCalendarConnection

- Table: `google_calendar_connections`
- Tenant-scoped: yes (`organizationId`)
- Soft-deletable: no
- Constraints and indexes:
  - `@@index([organizationId, status])`

| Field | Type | Modifiers | Default | Relation | Notes |
| --- | --- | --- | --- | --- | --- |
| `id` | String | id, required | `cuid()` |  |  |
| `organizationId` | String | required |  |  |  |
| `userId` | String | unique, required |  |  |  |
| `calendarId` | String | required | `"primary"` |  |  |
| `refreshTokenEncrypted` | String | required |  |  |  |
| `scopes` | String | required | `"[]"` |  |  |
| `status` | String | required | `"ACTIVE"` |  | ACTIVE, DISCONNECTED, ERROR |
| `lastError` | String | optional |  |  |  |
| `lastSyncedAt` | DateTime | optional |  |  |  |
| `disconnectedAt` | DateTime | optional |  |  |  |
| `createdAt` | DateTime | required | `now()` |  |  |
| `updatedAt` | DateTime | required, updatedAt |  |  |  |
| `organization` | Organization | required |  | → Organization, via (organizationId) → (id), onDelete Cascade |  |
| `user` | User | required |  | → User, via (userId) → (id), onDelete Cascade |  |

### Model ImportRun

- Table: `import_runs`
- Tenant-scoped: yes (`organizationId`)
- Soft-deletable: no
- Constraints and indexes:
  - `@@index([organizationId, source, createdAt])`

| Field | Type | Modifiers | Default | Relation | Notes |
| --- | --- | --- | --- | --- | --- |
| `id` | String | id, required | `cuid()` |  |  |
| `organizationId` | String | required |  |  |  |
| `source` | String | required |  |  | SLACK_EXPORT |
| `status` | String | required | `"APPLIED"` |  | APPLIED, ROLLED_BACK |
| `sourceLabel` | String | optional |  |  | Export directory basename; never an absolute path |
| `summary` | Json | optional |  |  | Counts only; no message content |
| `createdCount` | Int | required | `0` |  |  |
| `rolledBackAt` | DateTime | optional |  |  |  |
| `createdAt` | DateTime | required | `now()` |  |  |
| `updatedAt` | DateTime | required, updatedAt |  |  |  |
| `organization` | Organization | required |  | → Organization, via (organizationId) → (id), onDelete Cascade |  |
| `slackImportRecords` | SlackImportRecord[] | list, required |  | → SlackImportRecord |  |

### Model IntakeForm

- Table: `intake_forms`
- Tenant-scoped: no
- Soft-deletable: no

| Field | Type | Modifiers | Default | Relation | Notes |
| --- | --- | --- | --- | --- | --- |
| `id` | String | id, required | `cuid()` |  |  |
| `name` | String | required |  |  |  |
| `description` | String | optional |  |  |  |
| `fields` | String | required | `"[]"` |  | JSON: [{label, type, required, options?}] |
| `isActive` | Boolean | required | `true` |  |  |
| `viewToken` | String | unique, required | `cuid()` |  |  |
| `clientId` | String | optional |  |  |  |
| `createdAt` | DateTime | required | `now()` |  |  |
| `updatedAt` | DateTime | required, updatedAt |  |  |  |
| `client` | Client | optional |  | → Client, via (clientId) → (id) |  |
| `responses` | IntakeFormResponse[] | list, required |  | → IntakeFormResponse |  |

### Model IntakeFormResponse

- Table: `intake_form_responses`
- Tenant-scoped: no
- Soft-deletable: no

| Field | Type | Modifiers | Default | Relation | Notes |
| --- | --- | --- | --- | --- | --- |
| `id` | String | id, required | `cuid()` |  |  |
| `formId` | String | required |  |  |  |
| `answers` | String | required | `"{}"` |  | JSON: {fieldLabel: value} |
| `respondentName` | String | optional |  |  |  |
| `respondentEmail` | String | optional |  |  |  |
| `clientId` | String | optional |  |  |  |
| `createdAt` | DateTime | required | `now()` |  |  |
| `form` | IntakeForm | required |  | → IntakeForm, via (formId) → (id), onDelete Cascade |  |

### Model Integration

- Table: `integrations`
- Tenant-scoped: yes (`organizationId`)
- Soft-deletable: no
- Constraints and indexes:
  - `@@index([organizationId])`

| Field | Type | Modifiers | Default | Relation | Notes |
| --- | --- | --- | --- | --- | --- |
| `id` | String | id, required | `cuid()` |  |  |
| `type` | String | required |  |  | QUICKBOOKS, XERO |
| `organizationId` | String | required |  |  |  |
| `accessToken` | String | optional |  |  |  |
| `refreshToken` | String | optional |  |  |  |
| `orgId` | String | optional |  |  |  |
| `status` | String | required | `"DISCONNECTED"` |  | CONNECTED, DISCONNECTED, ERROR |
| `lastSyncAt` | DateTime | optional |  |  |  |
| `createdAt` | DateTime | required | `now()` |  |  |
| `updatedAt` | DateTime | required, updatedAt |  |  |  |
| `organization` | Organization | required |  | → Organization, via (organizationId) → (id), onDelete Cascade |  |

### Model InternalNote

- Table: `internal_notes`
- Tenant-scoped: no
- Soft-deletable: no

| Field | Type | Modifiers | Default | Relation | Notes |
| --- | --- | --- | --- | --- | --- |
| `id` | String | id, required | `cuid()` |  |  |
| `content` | String | required |  |  |  |
| `threadId` | String | required |  |  |  |
| `authorId` | String | required |  |  |  |
| `createdAt` | DateTime | required | `now()` |  |  |
| `thread` | Thread | required |  | → Thread, via (threadId) → (id), onDelete Cascade |  |
| `author` | User | required |  | → User, via (authorId) → (id) |  |

### Model Invoice

- Table: `invoices`
- Tenant-scoped: no
- Soft-deletable: yes (`deletedAt`)
- Constraints and indexes:
  - `@@index([status, dueDate])`
  - `@@index([clientId, status])`

| Field | Type | Modifiers | Default | Relation | Notes |
| --- | --- | --- | --- | --- | --- |
| `id` | String | id, required | `cuid()` |  |  |
| `invoiceNumber` | String | unique, required |  |  |  |
| `status` | String | required | `"DRAFT"` |  | DRAFT \| SENT \| PAID \| OVERDUE \| VOID |
| `title` | String | optional |  |  |  |
| `dueDate` | DateTime | optional |  |  |  |
| `issueDate` | DateTime | required | `now()` |  |  |
| `bonsaiInvoiceId` | String | optional |  |  | Original Bonsai invoice ID |
| `currency` | String | required | `"USD"` |  | USD \| CAD |
| `amountUsd` | Float | optional |  |  | For multi-currency tracking |
| `amountCad` | Float | optional |  |  |  |
| `daysToPayActual` | Int | optional |  |  | Historical: actual days client took to pay |
| `subtotal` | Float | required | `0` |  |  |
| `discountAmount` | Float | required | `0` |  |  |
| `taxRate` | Float | required | `13` |  | HST 13% default for Ontario |
| `taxType` | String | required | `"HST"` |  | HST \| GST \| PST \| NONE |
| `tax` | Float | required | `0` |  |  |
| `total` | Float | required | `0` |  |  |
| `notes` | String | optional |  |  |  |
| `internalNotes` | String | optional |  |  |  |
| `stripePaymentLink` | String | optional |  |  |  |
| `stripeCheckoutSessionId` | String | optional |  |  |  |
| `stripePaymentIntentId` | String | optional |  |  |  |
| `stripeCheckoutAmountMinor` | Int | optional |  |  |  |
| `stripeCheckoutCurrency` | String | optional |  |  |  |
| `stripeCheckoutExpiresAt` | DateTime | optional |  |  |  |
| `stripeCheckoutAttempt` | Int | required | `0` |  |  |
| `paymentMethod` | String | optional |  |  | STRIPE \| BANK \| TRANSFER \| CHEQUE \| CASH \| OTHER (legacy rows may hold CHECK) |
| `paymentNotes` | String | optional |  |  |  |
| `transactionId` | String | optional |  |  |  |
| `paidAt` | DateTime | optional |  |  |  |
| `sentAt` | DateTime | optional |  |  |  |
| `deliveryMessageId` | String | optional |  |  |  |
| `deliveryStatus` | String | optional |  |  | ACCEPTED \| DELIVERED \| FAILED \| BOUNCED \| COMPLAINED |
| `deliveryStatusAt` | DateTime | optional |  |  |  |
| `deliveryError` | String | optional |  |  |  |
| `voidedAt` | DateTime | optional |  |  |  |
| `voidedFromStatus` | String | optional |  |  |  |
| `isRecurring` | Boolean | required | `false` |  |  |
| `recurringInterval` | String | optional |  |  | MONTHLY \| QUARTERLY \| ANNUALLY |
| `recurringNextDate` | DateTime | optional |  |  |  |
| `reminderSentAt` | DateTime | optional |  |  |  |
| `viewToken` | String | unique, optional | `cuid()` |  |  |
| `publicAccessExpiresAt` | DateTime | optional |  |  |  |
| `publicAccessRevokedAt` | DateTime | optional |  |  |  |
| `clientId` | String | required |  |  |  |
| `projectId` | String | optional |  |  |  |
| `proposalId` | String | unique, optional |  |  |  |
| `createdById` | String | required |  |  |  |
| `createdAt` | DateTime | required | `now()` |  |  |
| `updatedAt` | DateTime | required, updatedAt |  |  |  |
| `client` | Client | required |  | → Client, via (clientId) → (id), onDelete Cascade |  |
| `createdBy` | User | required |  | → User, via (createdById) → (id), "InvoiceCreator" |  |
| `lineItems` | InvoiceLineItem[] | list, required |  | → InvoiceLineItem |  |
| `payments` | InvoicePayment[] | list, required |  | → InvoicePayment |  |
| `timeEntries` | TimeEntry[] | list, required |  | → TimeEntry |  |
| `expenses` | Expense[] | list, required |  | → Expense |  |
| `deletedAt` | DateTime | optional |  |  |  |
| `draftData` | String | optional |  |  | JSON of unsaved form data |

### Model InvoiceLineItem

- Table: `invoice_line_items`
- Tenant-scoped: no
- Soft-deletable: no

| Field | Type | Modifiers | Default | Relation | Notes |
| --- | --- | --- | --- | --- | --- |
| `id` | String | id, required | `cuid()` |  |  |
| `description` | String | required |  |  |  |
| `itemType` | String | required | `"LABOR"` |  | LABOR \| MATERIALS \| EXPENSE \| DISCOUNT \| CUSTOM |
| `quantity` | Float | required | `1` |  |  |
| `unitPrice` | Float | required |  |  |  |
| `total` | Float | required |  |  |  |
| `position` | Int | required | `0` |  |  |
| `invoiceId` | String | required |  |  |  |
| `invoice` | Invoice | required |  | → Invoice, via (invoiceId) → (id), onDelete Cascade |  |

### Model InvoicePayment

- Table: `invoice_payments`
- Tenant-scoped: no
- Soft-deletable: no

| Field | Type | Modifiers | Default | Relation | Notes |
| --- | --- | --- | --- | --- | --- |
| `id` | String | id, required | `cuid()` |  |  |
| `amount` | Float | required |  |  |  |
| `method` | String | required | `"BANK"` |  | STRIPE \| BANK \| TRANSFER \| CHEQUE \| CASH \| OTHER (legacy rows may hold CHECK) |
| `notes` | String | optional |  |  |  |
| `transactionId` | String | unique, optional |  |  |  |
| `paidAt` | DateTime | required | `now()` |  |  |
| `invoiceId` | String | required |  |  |  |
| `createdAt` | DateTime | required | `now()` |  |  |
| `invoice` | Invoice | required |  | → Invoice, via (invoiceId) → (id), onDelete Cascade |  |

### Model LineItemTemplate

- Table: `line_item_templates`
- Tenant-scoped: yes (`organizationId`)
- Soft-deletable: no
- Constraints and indexes:
  - `@@index([organizationId])`

| Field | Type | Modifiers | Default | Relation | Notes |
| --- | --- | --- | --- | --- | --- |
| `id` | String | id, required | `cuid()` |  |  |
| `organizationId` | String | required |  |  |  |
| `organization` | Organization | required |  | → Organization, via (organizationId) → (id), onDelete Cascade |  |
| `name` | String | required |  |  |  |
| `description` | String | required |  |  |  |
| `itemType` | String | required | `"LABOR"` |  | LABOR \| MATERIALS \| EXPENSE \| CUSTOM |
| `unitPrice` | Float | required |  |  |  |
| `unit` | String | required | `"hr"` |  | hr \| flat \| unit |
| `isActive` | Boolean | required | `true` |  |  |
| `createdAt` | DateTime | required | `now()` |  |  |
| `updatedAt` | DateTime | required, updatedAt |  |  |  |

### Model MailgunWebhookReceipt

- Table: `mailgun_webhook_receipts`
- Tenant-scoped: no
- Soft-deletable: no
- Constraints and indexes:
  - `@@index([receivedAt])`

| Field | Type | Modifiers | Default | Relation | Notes |
| --- | --- | --- | --- | --- | --- |
| `id` | String | id, required | `cuid()` |  |  |
| `token` | String | unique, required |  |  |  |
| `receivedAt` | DateTime | required | `now()` |  |  |

### Model Message

- Table: `messages`
- Tenant-scoped: no
- Soft-deletable: no
- Constraints and indexes:
  - `@@index([threadId])`
  - `@@index([receivedAt])`

| Field | Type | Modifiers | Default | Relation | Notes |
| --- | --- | --- | --- | --- | --- |
| `id` | String | id, required | `cuid()` |  |  |
| `direction` | String | required |  |  | INBOUND or OUTBOUND |
| `senderEmail` | String | required |  |  |  |
| `senderName` | String | optional |  |  |  |
| `subject` | String | optional |  |  |  |
| `bodyText` | String | required |  |  |  |
| `bodyHtml` | String | optional |  |  |  |
| `rawEmail` | String | optional |  |  | Original email content preserved |
| `headers` | String | optional |  |  | JSON: email headers |
| `receivedAt` | DateTime | required | `now()` |  |  |
| `processedAt` | DateTime | optional |  |  |  |
| `aiExtracted` | String | optional |  |  | JSON: AI-extracted data |
| `threadId` | String | required |  |  |  |
| `createdAt` | DateTime | required | `now()` |  |  |
| `thread` | Thread | required |  | → Thread, via (threadId) → (id), onDelete Cascade |  |

### Model Milestone

- Table: `milestones`
- Tenant-scoped: no
- Soft-deletable: yes (`deletedAt`)
- Constraints and indexes:
  - `@@index([deletedAt])`

| Field | Type | Modifiers | Default | Relation | Notes |
| --- | --- | --- | --- | --- | --- |
| `id` | String | id, required | `cuid()` |  |  |
| `name` | String | required |  |  |  |
| `description` | String | optional |  |  |  |
| `dueDate` | DateTime | required |  |  |  |
| `status` | String | required | `"PENDING"` |  | PENDING, IN_PROGRESS, COMPLETED, OVERDUE |
| `completedAt` | DateTime | optional |  |  |  |
| `color` | String | required | `"#3B82F6"` |  | For visual distinction |
| `projectId` | String | required |  |  |  |
| `createdAt` | DateTime | required | `now()` |  |  |
| `updatedAt` | DateTime | required, updatedAt |  |  |  |
| `deletedAt` | DateTime | optional |  |  |  |
| `project` | Project | required |  | → Project, via (projectId) → (id), onDelete Cascade |  |
| `tasks` | Task[] | list, required |  | → Task, "MilestoneTasks" |  |

### Model Note

- Table: `notes`
- Tenant-scoped: no
- Soft-deletable: yes (`deletedAt`)
- Constraints and indexes:
  - `@@index([projectId, parentId])`
  - `@@index([projectId, isTemplate])`

| Field | Type | Modifiers | Default | Relation | Notes |
| --- | --- | --- | --- | --- | --- |
| `id` | String | id, required | `cuid()` |  |  |
| `title` | String | required |  |  |  |
| `content` | String | required |  |  | Plain-text Markdown; clients must never render it as trusted HTML |
| `type` | String | required | `"NOTE"` |  | NOTE, MEETING_NOTES, WIKI, DOC |
| `isPinned` | Boolean | required | `false` |  |  |
| `tags` | String | required | `"[]"` |  | JSON array of tags |
| `mentions` | String | required | `"[]"` |  | JSON array of authorized mentioned user IDs |
| `isTemplate` | Boolean | required | `false` |  |  |
| `projectId` | String | required |  |  |  |
| `authorId` | String | required |  |  |  |
| `parentId` | String | optional |  |  |  |
| `createdAt` | DateTime | required | `now()` |  |  |
| `updatedAt` | DateTime | required, updatedAt |  |  |  |
| `deletedAt` | DateTime | optional |  |  |  |
| `project` | Project | required |  | → Project, via (projectId) → (id), onDelete Cascade |  |
| `author` | User | required |  | → User, via (authorId) → (id), "NoteAuthor" |  |
| `parent` | Note | optional |  | → Note, via (parentId) → (id), onDelete SetNull, "NoteHierarchy" |  |
| `children` | Note[] | list, required |  | → Note, "NoteHierarchy" |  |

### Model Notification

- Table: `notifications`
- Tenant-scoped: no
- Soft-deletable: no
- Constraints and indexes:
  - `@@index([userId, read])`
  - `@@index([userId, createdAt])`

| Field | Type | Modifiers | Default | Relation | Notes |
| --- | --- | --- | --- | --- | --- |
| `id` | String | id, required | `cuid()` |  |  |
| `userId` | String | required |  |  |  |
| `user` | User | required |  | → User, via (userId) → (id), onDelete Cascade |  |
| `type` | String | required |  |  | project.update, invoice.created, invoice.overdue, invoice.paid, proposal.sent, proposal.approved, proposal.declined, contract.signed, message.new, task.assigned, task.completed |
| `title` | String | required |  |  |  |
| `message` | String | required |  |  |  |
| `data` | Json | optional |  |  |  |
| `read` | Boolean | required | `false` |  |  |
| `readAt` | DateTime | optional |  |  |  |
| `createdAt` | DateTime | required | `now()` |  |  |

### Model NotionImportRecord

- Table: `notion_import_records`
- Tenant-scoped: yes (`organizationId`)
- Soft-deletable: no
- Constraints and indexes:
  - `@@unique([projectId, sourceKey])`
  - `@@index([organizationId, projectId])`
  - `@@index([noteId])`

| Field | Type | Modifiers | Default | Relation | Notes |
| --- | --- | --- | --- | --- | --- |
| `id` | String | id, required | `cuid()` |  |  |
| `organizationId` | String | required |  |  |  |
| `projectId` | String | required |  |  |  |
| `noteId` | String | optional |  |  |  |
| `sourceKey` | String | required |  |  |  |
| `sourcePath` | String | required |  |  |  |
| `contentSha256` | String | required |  |  |  |
| `outcome` | String | required | `"IMPORTED"` |  | IMPORTED, UNCHANGED, CONFLICT, SKIPPED |
| `lastError` | String | optional |  |  |  |
| `importedAt` | DateTime | required | `now()` |  |  |
| `createdAt` | DateTime | required | `now()` |  |  |
| `updatedAt` | DateTime | required, updatedAt |  |  |  |
| `organization` | Organization | required |  | → Organization, via (organizationId) → (id), onDelete Cascade |  |
| `project` | Project | required |  | → Project, via (projectId) → (id), onDelete Cascade |  |

### Model OnboardingProgress

- Table: `onboarding_progress`
- Tenant-scoped: yes (`organizationId`)
- Soft-deletable: no
- Constraints and indexes:
  - `@@index([organizationId, userId])`

| Field | Type | Modifiers | Default | Relation | Notes |
| --- | --- | --- | --- | --- | --- |
| `id` | String | id, required | `cuid()` |  |  |
| `organizationId` | String | required |  |  |  |
| `organization` | Organization | required |  | → Organization, via (organizationId) → (id), onDelete Cascade |  |
| `userId` | String | unique, required |  |  |  |
| `user` | User | required |  | → User, via (userId) → (id), onDelete Cascade |  |
| `roleSnapshot` | String | required |  |  |  |
| `skippedTaskIds` | Json | required | `"[]"` |  |  |
| `startedAt` | DateTime | optional |  |  |  |
| `dismissedAt` | DateTime | optional |  |  |  |
| `completedAt` | DateTime | optional |  |  |  |
| `createdAt` | DateTime | required | `now()` |  |  |
| `updatedAt` | DateTime | required, updatedAt |  |  |  |

### Model Organization

- Table: `organizations`
- Tenant-scoped: no
- Soft-deletable: no

| Field | Type | Modifiers | Default | Relation | Notes |
| --- | --- | --- | --- | --- | --- |
| `id` | String | id, required | `cuid()` |  |  |
| `name` | String | required |  |  |  |
| `slug` | String | unique, required |  |  |  |
| `logo` | String | optional |  |  |  |
| `plan` | String | required | `"FREE"` |  | FREE, PRO, ENTERPRISE |
| `aiDisabled` | Boolean | required | `false` |  |  |
| `createdAt` | DateTime | required | `now()` |  |  |
| `updatedAt` | DateTime | required, updatedAt |  |  |  |
| `users` | User[] | list, required |  | → User |  |
| `clients` | Client[] | list, required |  | → Client |  |
| `projects` | Project[] | list, required |  | → Project |  |
| `formDrafts` | FormDraft[] | list, required |  | → FormDraft |  |
| `attachments` | Attachment[] | list, required |  | → Attachment |  |
| `wpSites` | WPSite[] | list, required |  | → WPSite |  |
| `wpBackups` | WPBackup[] | list, required |  | → WPBackup |  |
| `wpReports` | WPReport[] | list, required |  | → WPReport |  |
| `wpAlerts` | WPAlert[] | list, required |  | → WPAlert |  |
| `wpFleetOps` | WPFleetOp[] | list, required |  | → WPFleetOp |  |
| `wpMagicLoginLogs` | WPMagicLoginLog[] | list, required |  | → WPMagicLoginLog |  |
| `wpBridgeNonces` | WPBridgeNonce[] | list, required |  | → WPBridgeNonce |  |
| `supportHourEntries` | SupportHourEntry[] | list, required |  | → SupportHourEntry |  |
| `integrations` | Integration[] | list, required |  | → Integration |  |
| `trashedItems` | TrashedItem[] | list, required |  | → TrashedItem |  |
| `assignmentRules` | AssignmentRule[] | list, required |  | → AssignmentRule |  |
| `templates` | Template[] | list, required |  | → Template |  |
| `unmatchedEmails` | UnmatchedEmail[] | list, required |  | → UnmatchedEmail |  |
| `lineItemTemplates` | LineItemTemplate[] | list, required |  | → LineItemTemplate |  |
| `weeklyDigests` | WeeklyDigest[] | list, required |  | → WeeklyDigest |  |
| `taskTemplates` | TaskTemplate[] | list, required |  | → TaskTemplate |  |
| `outreachSequences` | OutreachSequence[] | list, required |  | → OutreachSequence |  |
| `emailTriageItems` | EmailTriageItem[] | list, required |  | → EmailTriageItem |  |
| `aiContexts` | AiContext[] | list, required |  | → AiContext |  |
| `ashConversations` | AshConversation[] | list, required |  | → AshConversation |  |
| `projectTemplates` | ProjectTemplate[] | list, required |  | → ProjectTemplate |  |
| `brandSettings` | BrandSettings[] | list, required |  | → BrandSettings |  |
| `pipelineStages` | PipelineStage[] | list, required |  | → PipelineStage |  |
| `promptVersions` | PromptVersion[] | list, required |  | → PromptVersion |  |
| `credentials` | Credential[] | list, required |  | → Credential |  |
| `credentialAudits` | CredentialAccessAudit[] | list, required |  | → CredentialAccessAudit |  |
| `onboardingProgress` | OnboardingProgress[] | list, required |  | → OnboardingProgress |  |
| `slackInstallations` | SlackInstallation[] | list, required |  | → SlackInstallation |  |
| `slackChannelMappings` | SlackChannelMapping[] | list, required |  | → SlackChannelMapping |  |
| `slackEventReceipts` | SlackEventReceipt[] | list, required |  | → SlackEventReceipt |  |
| `googleCalendarConnections` | GoogleCalendarConnection[] | list, required |  | → GoogleCalendarConnection |  |
| `notionImportRecords` | NotionImportRecord[] | list, required |  | → NotionImportRecord |  |
| `importRuns` | ImportRun[] | list, required |  | → ImportRun |  |
| `slackImportRecords` | SlackImportRecord[] | list, required |  | → SlackImportRecord |  |
| `aiBridgeActions` | AiBridgeAction[] | list, required |  | → AiBridgeAction |  |
| `publicInquiries` | PublicInquiry[] | list, required |  | → PublicInquiry |  |
| `auditEvents` | AuditEvent[] | list, required |  | → AuditEvent |  |
| `aiProviderConnection` | AiProviderConnection | optional |  | → AiProviderConnection |  |
| `aiUsageRecords` | AiUsageRecord[] | list, required |  | → AiUsageRecord |  |
| `reviewSessions` | ReviewSession[] | list, required |  | → ReviewSession |  |

### Model OutreachSequence

- Table: `outreach_sequences`
- Tenant-scoped: yes (`organizationId`)
- Soft-deletable: no
- Constraints and indexes:
  - `@@index([status])`
  - `@@index([organizationId])`

| Field | Type | Modifiers | Default | Relation | Notes |
| --- | --- | --- | --- | --- | --- |
| `id` | String | id, required | `cuid()` |  |  |
| `organizationId` | String | required |  |  |  |
| `organization` | Organization | required |  | → Organization, via (organizationId) → (id), onDelete Cascade |  |
| `name` | String | required |  |  |  |
| `steps` | String | required | `"[]"` |  | JSON array of {subject, body, delayDays} |
| `status` | String | required | `"ACTIVE"` |  | ACTIVE \| PAUSED |
| `targetIndustry` | String | optional |  |  |  |
| `filters` | String | required | `"{}"` |  | JSON |
| `createdAt` | DateTime | required | `now()` |  |  |
| `updatedAt` | DateTime | required, updatedAt |  |  |  |

### Model PipelineDeal

- Table: `pipeline_deals`
- Tenant-scoped: no
- Soft-deletable: no
- Constraints and indexes:
  - `@@index([stageId])`
  - `@@index([clientId])`

| Field | Type | Modifiers | Default | Relation | Notes |
| --- | --- | --- | --- | --- | --- |
| `id` | String | id, required | `cuid()` |  |  |
| `title` | String | required |  |  |  |
| `value` | Float | required | `0` |  |  |
| `clientId` | String | required |  |  |  |
| `stageId` | String | required |  |  |  |
| `probability` | Int | required | `0` |  | Win probability percentage |
| `expectedCloseDate` | DateTime | optional |  |  |  |
| `notes` | String | optional |  |  |  |
| `contactPerson` | String | optional |  |  |  |
| `source` | String | optional |  |  | UPWORK \| REFERRAL \| WEBSITE \| COLD_OUTREACH \| OTHER |
| `lostReason` | String | optional |  |  |  |
| `createdAt` | DateTime | required | `now()` |  |  |
| `updatedAt` | DateTime | required, updatedAt |  |  |  |
| `stage` | PipelineStage | required |  | → PipelineStage, via (stageId) → (id) |  |
| `client` | Client | required |  | → Client, via (clientId) → (id) |  |

### Model PipelineStage

- Table: `pipeline_stages`
- Tenant-scoped: yes (`organizationId`)
- Soft-deletable: no
- Constraints and indexes:
  - `@@index([organizationId])`

| Field | Type | Modifiers | Default | Relation | Notes |
| --- | --- | --- | --- | --- | --- |
| `id` | String | id, required | `cuid()` |  |  |
| `organizationId` | String | required |  |  |  |
| `organization` | Organization | required |  | → Organization, via (organizationId) → (id), onDelete Cascade |  |
| `name` | String | required |  |  |  |
| `order` | Int | required | `0` |  |  |
| `color` | String | required | `"#3B82F6"` |  |  |
| `probability` | Int | required | `0` |  | Win probability percentage |
| `createdAt` | DateTime | required | `now()` |  |  |
| `updatedAt` | DateTime | required, updatedAt |  |  |  |
| `deals` | PipelineDeal[] | list, required |  | → PipelineDeal |  |

### Model PlatformSetting

- Table: `platform_settings`
- Tenant-scoped: no
- Soft-deletable: no

| Field | Type | Modifiers | Default | Relation | Notes |
| --- | --- | --- | --- | --- | --- |
| `id` | String | id, required | `"platform"` |  |  |
| `aiDisabled` | Boolean | required | `false` |  |  |
| `aiDisabledAt` | DateTime | optional |  |  |  |
| `aiDisabledById` | String | optional |  |  | No FK: history must outlive the actor account |
| `updatedAt` | DateTime | required, updatedAt |  |  |  |

### Model Project

- Table: `projects`
- Tenant-scoped: yes (`organizationId`)
- Soft-deletable: yes (`deletedAt`)
- Constraints and indexes:
  - `@@index([clientId])`
  - `@@index([status])`
  - `@@index([organizationId])`

| Field | Type | Modifiers | Default | Relation | Notes |
| --- | --- | --- | --- | --- | --- |
| `id` | String | id, required | `cuid()` |  |  |
| `organizationId` | String | required |  |  |  |
| `organization` | Organization | required |  | → Organization, via (organizationId) → (id) |  |
| `name` | String | required |  |  |  |
| `description` | String | optional |  |  |  |
| `status` | String | required | `"STARTING_UP"` |  | STARTING_UP, DESIGN_DEV, ADDING_CONTENT, FINALIZING, LAUNCHED, ON_HOLD, CANCELLED |
| `health` | String | required | `"ON_TRACK"` |  | ON_TRACK, NEEDS_ATTENTION, AT_RISK |
| `healthScore` | Int | required | `100` |  |  |
| `healthHistory` | Json | optional |  |  | Array of {health, score, timestamp} for historical tracking |
| `aiSummary` | String | optional |  |  | AI-generated current status summary |
| `aiPlan` | String | optional |  |  | JSON: AI-generated task plan |
| `risks` | String | required | `"[]"` |  | JSON: identified risks |
| `defaultOwnerId` | String | optional |  |  |  |
| `clientId` | String | required |  |  |  |
| `viewToken` | String | unique, optional | `cuid()` |  |  |
| `bonsaiProjectId` | String | optional |  |  |  |
| `serviceType` | String | optional |  |  | branding \| web_design \| ecommerce \| seo \| maintenance |
| `budget` | Float | optional |  |  | Fixed-price contract value |
| `hourlyBudget` | Float | optional |  |  | Max billable hours budget |
| `startDate` | DateTime | optional |  |  |  |
| `endDate` | DateTime | optional |  |  |  |
| `completedAt` | DateTime | optional |  |  |  |
| `isRetainer` | Boolean | required | `false` |  |  |
| `createdAt` | DateTime | required | `now()` |  |  |
| `updatedAt` | DateTime | required, updatedAt |  |  |  |
| `deletedAt` | DateTime | optional |  |  |  |
| `draftData` | String | optional |  |  | JSON of unsaved form data |
| `client` | Client | required |  | → Client, via (clientId) → (id), onDelete Cascade |  |
| `threads` | Thread[] | list, required |  | → Thread |  |
| `tasks` | Task[] | list, required |  | → Task |  |
| `chatMessages` | ChatMessage[] | list, required |  | → ChatMessage |  |
| `notes` | Note[] | list, required |  | → Note |  |
| `milestones` | Milestone[] | list, required |  | → Milestone |  |
| `timeEntries` | TimeEntry[] | list, required |  | → TimeEntry |  |
| `activities` | Activity[] | list, required |  | → Activity |  |
| `calendarEvents` | CalendarEvent[] | list, required |  | → CalendarEvent |  |
| `revisionRounds` | RevisionRound[] | list, required |  | → RevisionRound |  |
| `proposals` | Proposal[] | list, required |  | → Proposal |  |
| `credentials` | Credential[] | list, required |  | → Credential |  |
| `aiTeamMessages` | AiTeamMessage[] | list, required |  | → AiTeamMessage |  |
| `expenses` | Expense[] | list, required |  | → Expense |  |
| `approvals` | Approval[] | list, required |  | → Approval |  |
| `communications` | ProjectCommunication[] | list, required |  | → ProjectCommunication |  |
| `context` | ProjectContext | optional |  | → ProjectContext |  |
| `creativeBriefs` | CreativeBrief[] | list, required |  | → CreativeBrief |  |
| `timeSessions` | TimeSession[] | list, required |  | → TimeSession |  |
| `wpSite` | WPSite | optional |  | → WPSite |  |
| `slackChannelMappings` | SlackChannelMapping[] | list, required |  | → SlackChannelMapping |  |
| `notionImportRecords` | NotionImportRecord[] | list, required |  | → NotionImportRecord |  |
| `slackImportRecords` | SlackImportRecord[] | list, required |  | → SlackImportRecord |  |
| `reviewSessions` | ReviewSession[] | list, required |  | → ReviewSession |  |

### Model ProjectCommunication

- Table: `project_communications`
- Tenant-scoped: no
- Soft-deletable: no
- Constraints and indexes:
  - `@@index([projectId, receivedAt])`
  - `@@index([gmailMessageId])`

| Field | Type | Modifiers | Default | Relation | Notes |
| --- | --- | --- | --- | --- | --- |
| `id` | String | id, required | `cuid()` |  |  |
| `projectId` | String | required |  |  |  |
| `gmailThreadId` | String | required |  |  |  |
| `gmailMessageId` | String | unique, required |  |  |  |
| `from` | String | required |  |  |  |
| `to` | String | required |  |  |  |
| `subject` | String | required |  |  |  |
| `bodySnippet` | String | required |  |  | First 500 chars |
| `fullBody` | String | required |  |  | Complete email body |
| `direction` | String | required |  |  | INBOUND \| OUTBOUND |
| `sentiment` | String | optional |  |  | AI classified |
| `summary` | String | optional |  |  | AI one-liner |
| `actionItems` | String | optional |  |  | JSON array extracted by AI |
| `account` | String | required |  |  | Which inbox: cameron@ashbi.ca or bianca@ashbi.ca |
| `receivedAt` | DateTime | required |  |  |  |
| `createdAt` | DateTime | required | `now()` |  |  |
| `updatedAt` | DateTime | required, updatedAt |  |  |  |
| `project` | Project | required |  | → Project, via (projectId) → (id), onDelete Cascade |  |

### Model ProjectContext

- Table: `project_contexts`
- Tenant-scoped: no
- Soft-deletable: no

| Field | Type | Modifiers | Default | Relation | Notes |
| --- | --- | --- | --- | --- | --- |
| `id` | String | id, required | `cuid()` |  |  |
| `projectId` | String | unique, required |  |  |  |
| `aiSummary` | String | required |  |  | Compacted running context |
| `humanNotes` | String | optional |  |  | Free-form notes by Cameron/Bianca |
| `lastCompactedAt` | DateTime | optional |  |  |  |
| `compactionVersion` | Int | required | `0` |  |  |
| `emailCount` | Int | required | `0` |  | Total emails tracked |
| `createdAt` | DateTime | required | `now()` |  |  |
| `updatedAt` | DateTime | required, updatedAt |  |  |  |
| `project` | Project | required |  | → Project, via (projectId) → (id), onDelete Cascade |  |

### Model ProjectTemplate

- Table: `project_templates`
- Tenant-scoped: yes (`organizationId`)
- Soft-deletable: no
- Constraints and indexes:
  - `@@index([organizationId])`

| Field | Type | Modifiers | Default | Relation | Notes |
| --- | --- | --- | --- | --- | --- |
| `id` | String | id, required | `cuid()` |  |  |
| `organizationId` | String | required |  |  |  |
| `organization` | Organization | required |  | → Organization, via (organizationId) → (id), onDelete Cascade |  |
| `name` | String | required |  |  |  |
| `description` | String | optional |  |  |  |
| `projectType` | String | optional |  |  | WEBSITE \| BRANDING \| MARKETING \| CUSTOM |
| `tasks` | String | required | `"[]"` |  | JSON array of task definitions |
| `milestones` | String | required | `"[]"` |  | JSON array of milestone definitions |
| `createdAt` | DateTime | required | `now()` |  |  |
| `updatedAt` | DateTime | required, updatedAt |  |  |  |

### Model PromptVersion

- Table: `prompt_versions`
- Tenant-scoped: yes (`organizationId`)
- Soft-deletable: no
- Constraints and indexes:
  - `@@unique([name, version])`
  - `@@index([organizationId])`

| Field | Type | Modifiers | Default | Relation | Notes |
| --- | --- | --- | --- | --- | --- |
| `id` | String | id, required | `cuid()` |  |  |
| `organizationId` | String | required |  |  |  |
| `organization` | Organization | required |  | → Organization, via (organizationId) → (id), onDelete Cascade |  |
| `name` | String | required |  |  | e.g., "analyzeMessage", "draftResponse" |
| `version` | Int | required | `1` |  |  |
| `system` | String | required |  |  | System prompt |
| `template` | String | required |  |  | Prompt template with {{variables}} |
| `temperature` | Float | required | `0.7` |  |  |
| `isActive` | Boolean | required | `true` |  |  |
| `createdAt` | DateTime | required | `now()` |  |  |
| `updatedAt` | DateTime | required, updatedAt |  |  |  |

### Model Proposal

- Table: `proposals`
- Tenant-scoped: no
- Soft-deletable: yes (`deletedAt`)
- Constraints and indexes:
  - `@@index([status])`
  - `@@index([clientId, status])`
  - `@@index([validUntil])`

| Field | Type | Modifiers | Default | Relation | Notes |
| --- | --- | --- | --- | --- | --- |
| `id` | String | id, required | `cuid()` |  |  |
| `title` | String | required |  |  |  |
| `status` | String | required | `"DRAFT"` |  | DRAFT \| SENT \| VIEWED \| APPROVED \| DECLINED |
| `validUntil` | DateTime | optional |  |  |  |
| `subtotal` | Float | required | `0` |  |  |
| `discount` | Float | required | `0` |  |  |
| `total` | Float | required | `0` |  |  |
| `notes` | String | optional |  |  |  |
| `internalNotes` | String | optional |  |  |  |
| `viewToken` | String | unique, optional | `cuid()` |  |  |
| `publicAccessExpiresAt` | DateTime | optional |  |  |  |
| `publicAccessRevokedAt` | DateTime | optional |  |  |  |
| `approvedAt` | DateTime | optional |  |  |  |
| `declinedAt` | DateTime | optional |  |  |  |
| `sentAt` | DateTime | optional |  |  |  |
| `deliveryMessageId` | String | optional |  |  |  |
| `deliveryStatus` | String | optional |  |  | ACCEPTED \| DELIVERED \| FAILED \| BOUNCED \| COMPLAINED |
| `deliveryStatusAt` | DateTime | optional |  |  |  |
| `deliveryError` | String | optional |  |  |  |
| `clientId` | String | required |  |  |  |
| `projectId` | String | optional |  |  |  |
| `createdById` | String | required |  |  |  |
| `createdAt` | DateTime | required | `now()` |  |  |
| `updatedAt` | DateTime | required, updatedAt |  |  |  |
| `pdfPath` | String | optional |  |  | Path/URL to stored PDF file |
| `pdfGeneratedAt` | DateTime | optional |  |  | When the PDF was generated |
| `sentToEmail` | String | optional |  |  | Recipient email address |
| `gmailMessageId` | String | optional |  |  | Gmail message ID for sent email |
| `gmailThreadId` | String | optional |  |  | Gmail thread ID |
| `emailSentAt` | DateTime | optional |  |  | When the email was sent |
| `emailContent` | String | optional |  |  | JSON: { subject, body, cc, bcc } |
| `aiGenerated` | Boolean | required | `false` |  |  |
| `aiPrompt` | String | optional |  |  | The prompt used for AI generation |
| `aiModel` | String | optional |  |  | AI model that generated the content |
| `metadata` | String | optional |  |  | JSON: flexible metadata for extensions |
| `client` | Client | required |  | → Client, via (clientId) → (id), onDelete Cascade |  |
| `project` | Project | optional |  | → Project, via (projectId) → (id) |  |
| `createdBy` | User | required |  | → User, via (createdById) → (id), "ProposalCreator" |  |
| `lineItems` | ProposalLineItem[] | list, required |  | → ProposalLineItem |  |
| `versions` | ProposalVersion[] | list, required |  | → ProposalVersion |  |
| `contract` | Contract | optional |  | → Contract |  |
| `deletedAt` | DateTime | optional |  |  |  |
| `draftData` | String | optional |  |  | JSON of unsaved form data |

### Model ProposalLineItem

- Table: `proposal_line_items`
- Tenant-scoped: no
- Soft-deletable: no

| Field | Type | Modifiers | Default | Relation | Notes |
| --- | --- | --- | --- | --- | --- |
| `id` | String | id, required | `cuid()` |  |  |
| `description` | String | required |  |  |  |
| `quantity` | Float | required | `1` |  |  |
| `unitPrice` | Float | required |  |  |  |
| `total` | Float | required |  |  |  |
| `proposalId` | String | required |  |  |  |
| `proposal` | Proposal | required |  | → Proposal, via (proposalId) → (id), onDelete Cascade |  |

### Model ProposalVersion

- Table: `proposal_versions`
- Tenant-scoped: no
- Soft-deletable: no
- Constraints and indexes:
  - `@@index([proposalId])`
  - `@@index([createdAt])`

| Field | Type | Modifiers | Default | Relation | Notes |
| --- | --- | --- | --- | --- | --- |
| `id` | String | id, required | `cuid()` |  |  |
| `proposalId` | String | required |  |  |  |
| `data` | Json | required |  |  |  |
| `createdById` | String | required |  |  |  |
| `createdAt` | DateTime | required | `now()` |  |  |
| `proposal` | Proposal | required |  | → Proposal, via (proposalId) → (id), onDelete Cascade |  |
| `createdBy` | User | required |  | → User, via (createdById) → (id) |  |

### Model PublicInquiry

- Table: `public_inquiries`
- Tenant-scoped: yes (`organizationId`)
- Soft-deletable: no
- Constraints and indexes:
  - `@@unique([organizationId, idempotencyKey])`
  - `@@index([organizationId, createdAt])`
  - `@@index([ownerId])`

| Field | Type | Modifiers | Default | Relation | Notes |
| --- | --- | --- | --- | --- | --- |
| `id` | String | id, required | `cuid()` |  |  |
| `organizationId` | String | required |  |  |  |
| `ownerId` | String | optional |  |  |  |
| `idempotencyKey` | String | required |  |  |  |
| `payloadHash` | String | required |  |  |  |
| `name` | String | required |  |  |  |
| `email` | String | required |  |  |  |
| `company` | String | optional |  |  |  |
| `phone` | String | optional |  |  |  |
| `serviceLine` | String | required |  |  |  |
| `businessContext` | String | required |  |  |  |
| `requestedOutcome` | String | required |  |  |  |
| `timing` | String | optional |  |  |  |
| `budgetBand` | String | optional |  |  |  |
| `budgetCurrency` | String | optional |  |  |  |
| `privacyVersion` | String | required |  |  |  |
| `consentedAt` | DateTime | required |  |  |  |
| `attribution` | Json | optional |  |  |  |
| `status` | String | required | `"NEW"` |  | NEW, REVIEWED, ARCHIVED |
| `createdAt` | DateTime | required | `now()` |  |  |
| `updatedAt` | DateTime | required, updatedAt |  |  |  |
| `organization` | Organization | required |  | → Organization, via (organizationId) → (id), onDelete Cascade |  |
| `owner` | User | optional |  | → User, via (ownerId) → (id), onDelete SetNull, "PublicInquiryOwner" |  |

### Model PushSubscription

- Table: `push_subscriptions`
- Tenant-scoped: no
- Soft-deletable: no

| Field | Type | Modifiers | Default | Relation | Notes |
| --- | --- | --- | --- | --- | --- |
| `id` | String | id, required | `cuid()` |  |  |
| `endpoint` | String | unique, required |  |  |  |
| `keys` | String | required |  |  | JSON: { p256dh, auth } |
| `userId` | String | required |  |  |  |
| `createdAt` | DateTime | required | `now()` |  |  |
| `updatedAt` | DateTime | required, updatedAt |  |  |  |
| `user` | User | required |  | → User, via (userId) → (id), onDelete Cascade |  |

### Model RateCard

- Table: `rate_cards`
- Tenant-scoped: no
- Soft-deletable: no

| Field | Type | Modifiers | Default | Relation | Notes |
| --- | --- | --- | --- | --- | --- |
| `id` | String | id, required | `cuid()` |  |  |
| `name` | String | required |  |  |  |
| `clientId` | String | optional |  |  |  |
| `client` | Client | optional |  | → Client, via (clientId) → (id), onDelete Cascade |  |
| `rates` | Json | required | `"[]"` |  | [{serviceName, unit, rate, description}] |
| `isDefault` | Boolean | required | `false` |  |  |
| `createdAt` | DateTime | required | `now()` |  |  |
| `updatedAt` | DateTime | required, updatedAt |  |  |  |

### Model Report

- Table: `reports`
- Tenant-scoped: no
- Soft-deletable: no

| Field | Type | Modifiers | Default | Relation | Notes |
| --- | --- | --- | --- | --- | --- |
| `id` | String | id, required | `cuid()` |  |  |
| `type` | String | required | `"WEEKLY"` |  |  |
| `subject` | String | required |  |  |  |
| `body` | String | required |  |  |  |
| `clientId` | String | required |  |  |  |
| `generatedAt` | DateTime | required | `now()` |  |  |
| `sentAt` | DateTime | optional |  |  |  |
| `createdAt` | DateTime | required | `now()` |  |  |
| `client` | Client | required |  | → Client, via (clientId) → (id), onDelete Cascade |  |

### Model Response

- Table: `responses`
- Tenant-scoped: no
- Soft-deletable: no
- Constraints and indexes:
  - `@@index([status])`
  - `@@index([createdAt])`

| Field | Type | Modifiers | Default | Relation | Notes |
| --- | --- | --- | --- | --- | --- |
| `id` | String | id, required | `cuid()` |  |  |
| `status` | String | required | `"DRAFT"` |  | DRAFT, PENDING_APPROVAL, APPROVED, REJECTED, SENT |
| `subject` | String | required |  |  |  |
| `body` | String | required |  |  |  |
| `tone` | String | optional |  |  |  |
| `aiGenerated` | Boolean | required | `false` |  |  |
| `aiOptions` | String | optional |  |  | JSON: alternative AI drafts |
| `rejectionReason` | String | optional |  |  |  |
| `approvedAt` | DateTime | optional |  |  |  |
| `sentAt` | DateTime | optional |  |  |  |
| `threadId` | String | required |  |  |  |
| `draftedById` | String | required |  |  |  |
| `approvedById` | String | optional |  |  |  |
| `createdAt` | DateTime | required | `now()` |  |  |
| `updatedAt` | DateTime | required, updatedAt |  |  |  |
| `thread` | Thread | required |  | → Thread, via (threadId) → (id), onDelete Cascade |  |
| `draftedBy` | User | required |  | → User, via (draftedById) → (id), "DraftedBy" |  |
| `approvedBy` | User | optional |  | → User, via (approvedById) → (id), "ApprovedBy" |  |

### Model RetainerPlan

- Table: `retainer_plans`
- Tenant-scoped: no
- Soft-deletable: yes (`deletedAt`)
- Constraints and indexes:
  - `@@index([retainerStatus])`
  - `@@index([clientId, retainerStatus])`

| Field | Type | Modifiers | Default | Relation | Notes |
| --- | --- | --- | --- | --- | --- |
| `id` | String | id, required | `cuid()` |  |  |
| `clientId` | String | unique, required |  |  |  |
| `tier` | String | required |  |  | 999 \| 1999 \| 3999 |
| `hoursPerMonth` | Int | required |  |  | 20 \| 40 \| 80 |
| `hoursUsed` | Float | required | `0` |  |  |
| `billingCycleStart` | DateTime | required | `now()` |  |  |
| `monthlyAmountUsd` | Float | optional |  |  |  |
| `monthlyAmountCad` | Float | optional |  |  |  |
| `currency` | String | required | `"USD"` |  |  |
| `billingDay` | Int | required | `1` |  | Day of month 1-28 |
| `autoBillingEnabled` | Boolean | required | `true` |  |  |
| `startDate` | DateTime | optional |  |  |  |
| `nextBillingDate` | DateTime | optional |  |  |  |
| `renewalDate` | DateTime | optional |  |  |  |
| `serviceDescription` | String | optional |  |  |  |
| `retainerStatus` | String | required | `"ACTIVE"` |  | ACTIVE \| AT_RISK \| PAUSED \| CANCELLED |
| `annualValue` | Float | optional |  |  |  |
| `bonsaiRetainerId` | String | optional |  |  |  |
| `createdAt` | DateTime | required | `now()` |  |  |
| `updatedAt` | DateTime | required, updatedAt |  |  |  |
| `deletedAt` | DateTime | optional |  |  |  |
| `draftData` | String | optional |  |  | JSON of unsaved form data |
| `client` | Client | required |  | → Client, via (clientId) → (id), onDelete Cascade |  |

### Model RevenueSnapshot

- Table: `revenue_snapshots`
- Tenant-scoped: no
- Soft-deletable: no
- Constraints and indexes:
  - `@@unique([month, clientId])`

| Field | Type | Modifiers | Default | Relation | Notes |
| --- | --- | --- | --- | --- | --- |
| `id` | String | id, required | `cuid()` |  |  |
| `month` | String | required |  |  | YYYY-MM e.g. "2026-03" |
| `revenueUsd` | Float | required | `0` |  |  |
| `revenueCad` | Float | required | `0` |  |  |
| `revenueUsdEquiv` | Float | required | `0` |  |  |
| `mrr` | Float | required | `0` |  |  |
| `arr` | Float | required | `0` |  |  |
| `retainerRevenue` | Float | required | `0` |  |  |
| `projectRevenue` | Float | required | `0` |  |  |
| `maintenanceRevenue` | Float | required | `0` |  |  |
| `newClients` | Int | required | `0` |  |  |
| `churnedClients` | Int | required | `0` |  |  |
| `outstandingUsd` | Float | required | `0` |  |  |
| `overdueUsd` | Float | required | `0` |  |  |
| `exchangeRateUsedCadUsd` | Float | required | `0.80` |  |  |
| `notes` | String | optional |  |  |  |
| `clientId` | String | optional |  |  |  |
| `createdAt` | DateTime | required | `now()` |  |  |
| `updatedAt` | DateTime | required, updatedAt |  |  |  |
| `client` | Client | optional |  | → Client, via (clientId) → (id) |  |

### Model ReviewAnnotation

- Table: `review_annotations`
- Tenant-scoped: no
- Soft-deletable: no
- Constraints and indexes:
  - `@@index([sessionId, createdAt])`
  - `@@index([parentId])`
  - `@@index([shareLinkId])`

| Field | Type | Modifiers | Default | Relation | Notes |
| --- | --- | --- | --- | --- | --- |
| `id` | String | id, required | `cuid()` |  |  |
| `sessionId` | String | required |  |  |  |
| `session` | ReviewSession | required |  | → ReviewSession, via (sessionId) → (id), onDelete Cascade |  |
| `parentId` | String | optional |  |  |  |
| `parent` | ReviewAnnotation | optional |  | → ReviewAnnotation, via (parentId) → (id), onDelete Cascade, "ReviewAnnotationThread" |  |
| `replies` | ReviewAnnotation[] | list, required |  | → ReviewAnnotation, "ReviewAnnotationThread" |  |
| `authorType` | String | required |  |  | staff or guest (CHECK constraint) |
| `authorUserId` | String | optional |  |  | staff author; no FK: history must outlive the actor account |
| `authorName` | String | required |  |  |  |
| `authorEmail` | String | optional |  |  | guest only, optional |
| `shareLinkId` | String | optional |  |  | guest only: the link the comment came through |
| `shareLink` | ReviewShareLink | optional |  | → ReviewShareLink, via (shareLinkId) → (id), onDelete SetNull |  |
| `body` | String | required |  |  | plain text, at most 5,000 characters (CHECK constraint) |
| `timecodeMs` | Int | optional |  |  |  |
| `regionX` | Float | optional |  |  | region fields are all set or all null, each within 0..1 |
| `regionY` | Float | optional |  |  |  |
| `regionW` | Float | optional |  |  |  |
| `regionH` | Float | optional |  |  |  |
| `pageNumber` | Int | optional |  |  |  |
| `resolvedAt` | DateTime | optional |  |  |  |
| `resolvedById` | String | optional |  |  | No FK: history must outlive the actor account |
| `createdAt` | DateTime | required | `now()` |  |  |
| `updatedAt` | DateTime | required, updatedAt |  |  |  |

### Model ReviewDecision

- Table: `review_decisions`
- Tenant-scoped: no
- Soft-deletable: no
- Constraints and indexes:
  - `@@index([sessionId, createdAt])`

| Field | Type | Modifiers | Default | Relation | Notes |
| --- | --- | --- | --- | --- | --- |
| `id` | String | id, required | `cuid()` |  |  |
| `sessionId` | String | required |  |  |  |
| `session` | ReviewSession | required |  | → ReviewSession, via (sessionId) → (id), onDelete Cascade |  |
| `decision` | String | required |  |  | approved or changes_requested (CHECK constraint) |
| `actorType` | String | required |  |  | staff or guest (CHECK constraint) |
| `actorUserId` | String | optional |  |  | No FK: history must outlive the actor account |
| `actorName` | String | required |  |  |  |
| `actorEmail` | String | optional |  |  |  |
| `shareLinkId` | String | unique, optional |  |  | No FK: the evidence keeps the link id after the link is gone. Unique: one decision per share link |
| `note` | String | optional |  |  | plain text, at most 2,000 characters (CHECK constraint) |
| `createdAt` | DateTime | required | `now()` |  |  |

### Model ReviewSession

- Table: `review_sessions`
- Tenant-scoped: yes (`organizationId`)
- Soft-deletable: no
- Constraints and indexes:
  - `@@index([organizationId, projectId, createdAt])`
  - `@@index([attachmentId])`

| Field | Type | Modifiers | Default | Relation | Notes |
| --- | --- | --- | --- | --- | --- |
| `id` | String | id, required | `cuid()` |  |  |
| `organizationId` | String | required |  |  |  |
| `organization` | Organization | required |  | → Organization, via (organizationId) → (id), onDelete Cascade |  |
| `projectId` | String | required |  |  |  |
| `project` | Project | required |  | → Project, via (projectId) → (id), onDelete Cascade |  |
| `attachmentId` | String | required |  |  |  |
| `attachment` | Attachment | required |  | → Attachment, via (attachmentId) → (id), onDelete Restrict | a reviewed file cannot be deleted (evidence) |
| `title` | String | required |  |  |  |
| `status` | String | required | `"open"` |  | open, approved, changes_requested, closed (CHECK constraint) |
| `version` | Int | required | `1` |  |  |
| `previousSessionId` | String | unique, optional |  |  | the session this version replaces |
| `previousSession` | ReviewSession | optional |  | → ReviewSession, via (previousSessionId) → (id), onDelete SetNull, "ReviewSessionVersions" |  |
| `nextSession` | ReviewSession | optional |  | → ReviewSession, "ReviewSessionVersions" |  |
| `createdById` | String | required |  |  | No FK: history must outlive the actor account |
| `createdAt` | DateTime | required | `now()` |  |  |
| `updatedAt` | DateTime | required, updatedAt |  |  |  |
| `annotations` | ReviewAnnotation[] | list, required |  | → ReviewAnnotation |  |
| `decisions` | ReviewDecision[] | list, required |  | → ReviewDecision |  |
| `shareLinks` | ReviewShareLink[] | list, required |  | → ReviewShareLink |  |

### Model ReviewShareLink

- Table: `review_share_links`
- Tenant-scoped: no
- Soft-deletable: no
- Constraints and indexes:
  - `@@index([sessionId, createdAt])`

| Field | Type | Modifiers | Default | Relation | Notes |
| --- | --- | --- | --- | --- | --- |
| `id` | String | id, required | `cuid()` |  |  |
| `sessionId` | String | required |  |  |  |
| `session` | ReviewSession | required |  | → ReviewSession, via (sessionId) → (id), onDelete Cascade |  |
| `tokenHash` | String | unique, required |  |  |  |
| `label` | String | optional |  |  |  |
| `expiresAt` | DateTime | required |  |  | default 14 days, at most 90 days after creation (CHECK constraint) |
| `revokedAt` | DateTime | optional |  |  |  |
| `revokedById` | String | optional |  |  | No FK: history must outlive the actor account |
| `allowDecision` | Boolean | required | `false` |  |  |
| `createdById` | String | required |  |  | No FK: history must outlive the actor account |
| `lastUsedAt` | DateTime | optional |  |  |  |
| `createdAt` | DateTime | required | `now()` |  |  |
| `annotations` | ReviewAnnotation[] | list, required |  | → ReviewAnnotation |  |

### Model RevisionRound

- Table: `revision_rounds`
- Tenant-scoped: no
- Soft-deletable: no
- Constraints and indexes:
  - `@@unique([projectId, roundNumber])`

| Field | Type | Modifiers | Default | Relation | Notes |
| --- | --- | --- | --- | --- | --- |
| `id` | String | id, required | `cuid()` |  |  |
| `roundNumber` | Int | required |  |  |  |
| `status` | String | required | `"OPEN"` |  | OPEN, IN_REVIEW, APPROVED |
| `notes` | String | optional |  |  |  |
| `requestedAt` | DateTime | required | `now()` |  |  |
| `approvedAt` | DateTime | optional |  |  |  |
| `projectId` | String | required |  |  |  |
| `createdAt` | DateTime | required | `now()` |  |  |
| `updatedAt` | DateTime | required, updatedAt |  |  |  |
| `project` | Project | required |  | → Project, via (projectId) → (id), onDelete Cascade |  |

### Model SlackChannelMapping

- Table: `slack_channel_mappings`
- Tenant-scoped: yes (`organizationId`)
- Soft-deletable: no
- Constraints and indexes:
  - `@@unique([installationId, channelId])`
  - `@@index([organizationId, projectId])`

| Field | Type | Modifiers | Default | Relation | Notes |
| --- | --- | --- | --- | --- | --- |
| `id` | String | id, required | `cuid()` |  |  |
| `organizationId` | String | required |  |  |  |
| `installationId` | String | required |  |  |  |
| `projectId` | String | required |  |  |  |
| `channelId` | String | required |  |  |  |
| `channelName` | String | optional |  |  |  |
| `inboundEnabled` | Boolean | required | `true` |  |  |
| `outboundEnabled` | Boolean | required | `false` |  |  |
| `createdAt` | DateTime | required | `now()` |  |  |
| `updatedAt` | DateTime | required, updatedAt |  |  |  |
| `organization` | Organization | required |  | → Organization, via (organizationId) → (id), onDelete Cascade |  |
| `installation` | SlackInstallation | required |  | → SlackInstallation, via (installationId) → (id), onDelete Cascade |  |
| `project` | Project | required |  | → Project, via (projectId) → (id), onDelete Cascade |  |

### Model SlackEventReceipt

- Table: `slack_event_receipts`
- Tenant-scoped: yes (`organizationId`)
- Soft-deletable: no
- Constraints and indexes:
  - `@@index([organizationId, receivedAt])`
  - `@@index([installationId, channelId])`

| Field | Type | Modifiers | Default | Relation | Notes |
| --- | --- | --- | --- | --- | --- |
| `id` | String | id, required | `cuid()` |  |  |
| `organizationId` | String | required |  |  |  |
| `installationId` | String | required |  |  |  |
| `eventId` | String | unique, required |  |  |  |
| `eventType` | String | required |  |  |  |
| `channelId` | String | optional |  |  |  |
| `status` | String | required | `"RECEIVED"` |  | RECEIVED, IGNORED, PROCESSED, FAILED |
| `errorCode` | String | optional |  |  |  |
| `receivedAt` | DateTime | required | `now()` |  |  |
| `processedAt` | DateTime | optional |  |  |  |
| `createdAt` | DateTime | required | `now()` |  |  |
| `updatedAt` | DateTime | required, updatedAt |  |  |  |
| `organization` | Organization | required |  | → Organization, via (organizationId) → (id), onDelete Cascade |  |
| `installation` | SlackInstallation | required |  | → SlackInstallation, via (installationId) → (id), onDelete Cascade |  |

### Model SlackImportRecord

- Table: `slack_import_records`
- Tenant-scoped: yes (`organizationId`)
- Soft-deletable: no
- Constraints and indexes:
  - `@@unique([organizationId, sourceKey])`
  - `@@index([organizationId, projectId])`
  - `@@index([runId])`
  - `@@index([chatMessageId])`

| Field | Type | Modifiers | Default | Relation | Notes |
| --- | --- | --- | --- | --- | --- |
| `id` | String | id, required | `cuid()` |  |  |
| `organizationId` | String | required |  |  |  |
| `projectId` | String | required |  |  |  |
| `runId` | String | required |  |  |  |
| `chatMessageId` | String | optional |  |  |  |
| `sourceKey` | String | required |  |  | slack-export:<channelId>:<ts> |
| `channelId` | String | required |  |  |  |
| `messageTs` | String | required |  |  |  |
| `threadTs` | String | optional |  |  |  |
| `contentSha256` | String | required |  |  |  |
| `outcome` | String | required | `"IMPORTED"` |  | IMPORTED |
| `importedAt` | DateTime | required | `now()` |  |  |
| `createdAt` | DateTime | required | `now()` |  |  |
| `updatedAt` | DateTime | required, updatedAt |  |  |  |
| `organization` | Organization | required |  | → Organization, via (organizationId) → (id), onDelete Cascade |  |
| `project` | Project | required |  | → Project, via (projectId) → (id), onDelete Cascade |  |
| `run` | ImportRun | required |  | → ImportRun, via (runId) → (id), onDelete Cascade |  |

### Model SlackInstallation

- Table: `slack_installations`
- Tenant-scoped: yes (`organizationId`)
- Soft-deletable: no
- Constraints and indexes:
  - `@@index([organizationId, status])`

| Field | Type | Modifiers | Default | Relation | Notes |
| --- | --- | --- | --- | --- | --- |
| `id` | String | id, required | `cuid()` |  |  |
| `organizationId` | String | required |  |  |  |
| `teamId` | String | unique, required |  |  |  |
| `teamName` | String | optional |  |  |  |
| `botUserId` | String | optional |  |  |  |
| `botTokenEncrypted` | String | optional |  |  |  |
| `scopes` | String | required | `"[]"` |  |  |
| `status` | String | required | `"ACTIVE"` |  | ACTIVE, DISCONNECTED, ERROR |
| `installedAt` | DateTime | required | `now()` |  |  |
| `disconnectedAt` | DateTime | optional |  |  |  |
| `createdAt` | DateTime | required | `now()` |  |  |
| `updatedAt` | DateTime | required, updatedAt |  |  |  |
| `organization` | Organization | required |  | → Organization, via (organizationId) → (id), onDelete Cascade |  |
| `channelMappings` | SlackChannelMapping[] | list, required |  | → SlackChannelMapping |  |
| `eventReceipts` | SlackEventReceipt[] | list, required |  | → SlackEventReceipt |  |

### Model Snippet

- Table: `snippets`
- Tenant-scoped: no
- Soft-deletable: no

| Field | Type | Modifiers | Default | Relation | Notes |
| --- | --- | --- | --- | --- | --- |
| `id` | String | id, required | `cuid()` |  |  |
| `title` | String | required |  |  |  |
| `description` | String | optional |  |  |  |
| `code` | String | required |  |  |  |
| `language` | String | required | `"javascript"` |  |  |
| `category` | String | required | `"general"` |  | general \| react \| css \| sql \| api \| utility |
| `tags` | String | required | `"[]"` |  | JSON: array of tag strings |
| `isFavorite` | Boolean | required | `false` |  |  |
| `useCount` | Int | required | `0` |  |  |
| `createdById` | String | optional |  |  |  |
| `createdAt` | DateTime | required | `now()` |  |  |
| `updatedAt` | DateTime | required, updatedAt |  |  |  |
| `createdBy` | User | optional |  | → User, via (createdById) → (id) |  |

### Model SupportHourEntry

- Table: `support_hours`
- Tenant-scoped: yes (`organizationId`)
- Soft-deletable: no
- Constraints and indexes:
  - `@@index([siteUrl])`
  - `@@index([month])`
  - `@@index([clientId])`
  - `@@index([organizationId])`

| Field | Type | Modifiers | Default | Relation | Notes |
| --- | --- | --- | --- | --- | --- |
| `id` | String | id, required | `cuid()` |  |  |
| `organizationId` | String | required |  |  |  |
| `siteUrl` | String | required |  |  |  |
| `clientId` | String | optional |  |  |  |
| `projectId` | String | optional |  |  |  |
| `month` | String | required |  |  |  |
| `hours` | Float | required |  |  |  |
| `description` | String | optional |  |  |  |
| `source` | String | required | `"plugin"` |  |  |
| `createdAt` | DateTime | required | `now()` |  |  |
| `updatedAt` | DateTime | required, updatedAt |  |  |  |
| `organization` | Organization | required |  | → Organization, via (organizationId) → (id) |  |

### Model Task

- Table: `tasks`
- Tenant-scoped: no
- Soft-deletable: yes (`deletedAt`)
- Constraints and indexes:
  - `@@index([parentId])`
  - `@@index([projectId, parentId])`
  - `@@index([status])`
  - `@@index([priority])`
  - `@@index([dueDate])`
  - `@@index([dependsOnId])`
  - `@@index([assigneeId])`
  - `@@index([projectId, status])`

| Field | Type | Modifiers | Default | Relation | Notes |
| --- | --- | --- | --- | --- | --- |
| `id` | String | id, required | `cuid()` |  |  |
| `title` | String | required |  |  |  |
| `description` | String | optional |  |  | Brief description/summary |
| `content` | String | optional | `"[]"` |  | JSON: Block-based rich content (Notion-like) |
| `status` | String | required | `"PENDING"` |  | PENDING, IN_PROGRESS, COMPLETED, BLOCKED |
| `priority` | String | required | `"NORMAL"` |  | CRITICAL, HIGH, NORMAL, LOW |
| `category` | String | required | `"UPCOMING"` |  | IMMEDIATE, THIS_WEEK, UPCOMING, WAITING_CLIENT, WAITING_US |
| `tags` | String | required | `"[]"` |  | JSON array of tags |
| `isPage` | Boolean | required | `false` |  | Treat as a page with subpages |
| `icon` | String | optional |  |  | Emoji or icon URL |
| `coverImage` | String | optional |  |  | Cover image URL |
| `properties` | String | required | `"{}"` |  | JSON: Custom properties/fields |
| `parentId` | String | optional |  |  | For subpages/subtasks |
| `estimatedTime` | String | optional |  |  |  |
| `startDate` | DateTime | optional |  |  |  |
| `dueDate` | DateTime | optional |  |  |  |
| `completedAt` | DateTime | optional |  |  |  |
| `sourceThreadId` | String | optional |  |  |  |
| `blockedBy` | String | optional |  |  |  |
| `aiGenerated` | Boolean | required | `false` |  |  |
| `position` | Int | required | `0` |  | For Kanban board ordering |
| `projectId` | String | required |  |  |  |
| `assigneeId` | String | optional |  |  |  |
| `milestoneId` | String | optional |  |  |  |
| `dependsOnId` | String | optional |  |  | Task dependency — this task depends on another |
| `createdAt` | DateTime | required | `now()` |  |  |
| `updatedAt` | DateTime | required, updatedAt |  |  |  |
| `deletedAt` | DateTime | optional |  |  |  |
| `project` | Project | required |  | → Project, via (projectId) → (id), onDelete Cascade |  |
| `assignee` | User | optional |  | → User, via (assigneeId) → (id), "TaskAssignee" |  |
| `milestone` | Milestone | optional |  | → Milestone, via (milestoneId) → (id), "MilestoneTasks" |  |
| `comments` | TaskComment[] | list, required |  | → TaskComment |  |
| `timeEntries` | TimeEntry[] | list, required |  | → TimeEntry |  |
| `timeSessions` | TimeSession[] | list, required |  | → TimeSession |  |
| `parent` | Task | optional |  | → Task, via (parentId) → (id), onDelete Cascade, "TaskSubpages" |  |
| `subpages` | Task[] | list, required |  | → Task, "TaskSubpages" |  |
| `dependsOn` | Task | optional |  | → Task, via (dependsOnId) → (id), "TaskDependency" |  |
| `blockedTasks` | Task[] | list, required |  | → Task, "TaskDependency" |  |

### Model TaskComment

- Table: `task_comments`
- Tenant-scoped: no
- Soft-deletable: no

| Field | Type | Modifiers | Default | Relation | Notes |
| --- | --- | --- | --- | --- | --- |
| `id` | String | id, required | `cuid()` |  |  |
| `content` | String | required |  |  |  |
| `mentions` | String | required | `"[]"` |  | JSON: array of mentioned user IDs |
| `taskId` | String | required |  |  |  |
| `authorId` | String | required |  |  |  |
| `createdAt` | DateTime | required | `now()` |  |  |
| `updatedAt` | DateTime | required, updatedAt |  |  |  |
| `task` | Task | required |  | → Task, via (taskId) → (id), onDelete Cascade |  |
| `author` | User | required |  | → User, via (authorId) → (id), "CommentAuthor" |  |

### Model TaskTemplate

- Table: `task_templates`
- Tenant-scoped: yes (`organizationId`)
- Soft-deletable: no
- Constraints and indexes:
  - `@@index([organizationId])`

| Field | Type | Modifiers | Default | Relation | Notes |
| --- | --- | --- | --- | --- | --- |
| `id` | String | id, required | `cuid()` |  |  |
| `organizationId` | String | required |  |  |  |
| `organization` | Organization | required |  | → Organization, via (organizationId) → (id), onDelete Cascade |  |
| `name` | String | required |  |  |  |
| `phase` | String | required |  |  | STARTING_UP, DESIGN_DEV, ADDING_CONTENT, FINALIZING, LAUNCHED |
| `tasks` | String | required | `"[]"` |  | JSON array of {title, description, assignee_role} |
| `createdAt` | DateTime | required | `now()` |  |  |
| `updatedAt` | DateTime | required, updatedAt |  |  |  |

### Model Template

- Table: `templates`
- Tenant-scoped: yes (`organizationId`)
- Soft-deletable: no
- Constraints and indexes:
  - `@@index([organizationId])`

| Field | Type | Modifiers | Default | Relation | Notes |
| --- | --- | --- | --- | --- | --- |
| `id` | String | id, required | `cuid()` |  |  |
| `organizationId` | String | required |  |  |  |
| `organization` | Organization | required |  | → Organization, via (organizationId) → (id), onDelete Cascade |  |
| `name` | String | required |  |  |  |
| `category` | String | required |  |  | GREETING, ACKNOWLEDGMENT, FOLLOW_UP, etc. |
| `subject` | String | optional |  |  |  |
| `body` | String | required |  |  |  |
| `variables` | String | required | `"[]"` |  | JSON: available variables |
| `isActive` | Boolean | required | `true` |  |  |
| `createdAt` | DateTime | required | `now()` |  |  |
| `updatedAt` | DateTime | required, updatedAt |  |  |  |

### Model Thread

- Table: `threads`
- Tenant-scoped: no
- Soft-deletable: no
- Constraints and indexes:
  - `@@index([clientId])`
  - `@@index([projectId])`
  - `@@index([status])`
  - `@@index([assignedToId])`
  - `@@index([status, assignedToId])`
  - `@@index([createdAt])`

| Field | Type | Modifiers | Default | Relation | Notes |
| --- | --- | --- | --- | --- | --- |
| `id` | String | id, required | `cuid()` |  |  |
| `subject` | String | required |  |  |  |
| `status` | String | required | `"OPEN"` |  | OPEN, AWAITING_RESPONSE, RESOLVED, SNOOZED |
| `priority` | String | required | `"NORMAL"` |  | CRITICAL, HIGH, NORMAL, LOW |
| `intent` | String | optional |  |  | AI-classified intent |
| `sentiment` | String | optional |  |  | AI-detected sentiment |
| `urgencyReason` | String | optional |  |  |  |
| `lastActivityAt` | DateTime | required | `now()` |  |  |
| `snoozedUntil` | DateTime | optional |  |  |  |
| `slaDeadline` | DateTime | optional |  |  |  |
| `slaBreached` | Boolean | required | `false` |  |  |
| `aiAnalysis` | String | optional |  |  | JSON: full AI analysis result |
| `matchConfidence` | Float | required | `0` |  |  |
| `matchReason` | String | optional |  |  |  |
| `needsTriage` | Boolean | required | `false` |  |  |
| `clientId` | String | optional |  |  |  |
| `projectId` | String | optional |  |  |  |
| `assignedToId` | String | optional |  |  |  |
| `createdAt` | DateTime | required | `now()` |  |  |
| `updatedAt` | DateTime | required, updatedAt |  |  |  |
| `client` | Client | optional |  | → Client, via (clientId) → (id) |  |
| `project` | Project | optional |  | → Project, via (projectId) → (id) |  |
| `assignedTo` | User | optional |  | → User, via (assignedToId) → (id), "AssignedTo" |  |
| `messages` | Message[] | list, required |  | → Message |  |
| `responses` | Response[] | list, required |  | → Response |  |
| `internalNotes` | InternalNote[] | list, required |  | → InternalNote |  |

### Model TimeEntry

- Table: `time_entries`
- Tenant-scoped: no
- Soft-deletable: yes (`deletedAt`)
- Constraints and indexes:
  - `@@index([projectId])`
  - `@@index([userId])`
  - `@@index([invoiceId])`
  - `@@index([reviewStatus])`
  - `@@index([userId, date])`

| Field | Type | Modifiers | Default | Relation | Notes |
| --- | --- | --- | --- | --- | --- |
| `id` | String | id, required | `cuid()` |  |  |
| `description` | String | optional |  |  |  |
| `duration` | Int | required |  |  | Duration in minutes |
| `date` | DateTime | required | `now()` |  |  |
| `billable` | Boolean | required | `true` |  |  |
| `hourlyRate` | Float | optional |  |  | Override rate for this entry |
| `source` | String | required | `"MANUAL"` |  |  |
| `invoiced` | Boolean | required | `false` |  | Has this been included in an invoice? |
| `invoiceId` | String | optional |  |  | Link to invoice if billed |
| `reviewStatus` | String | required | `"PENDING"` |  | PENDING, APPROVED, REJECTED |
| `reviewedAt` | DateTime | optional |  |  |  |
| `reviewedById` | String | optional |  |  |  |
| `rejectionReason` | String | optional |  |  |  |
| `taskId` | String | optional |  |  |  |
| `projectId` | String | required |  |  |  |
| `userId` | String | required |  |  |  |
| `createdAt` | DateTime | required | `now()` |  |  |
| `updatedAt` | DateTime | required, updatedAt |  |  |  |
| `deletedAt` | DateTime | optional |  |  |  |
| `task` | Task | optional |  | → Task, via (taskId) → (id), onDelete SetNull |  |
| `project` | Project | required |  | → Project, via (projectId) → (id), onDelete Cascade |  |
| `user` | User | required |  | → User, via (userId) → (id) |  |
| `invoice` | Invoice | optional |  | → Invoice, via (invoiceId) → (id), onDelete SetNull |  |

### Model TimeSession

- Table: `time_sessions`
- Tenant-scoped: no
- Soft-deletable: no
- Constraints and indexes:
  - `@@index([userId])`
  - `@@index([projectId])`
  - `@@index([isRunning])`

| Field | Type | Modifiers | Default | Relation | Notes |
| --- | --- | --- | --- | --- | --- |
| `id` | String | id, required | `cuid()` |  |  |
| `userId` | String | required |  |  |  |
| `projectId` | String | required |  |  |  |
| `taskId` | String | optional |  |  |  |
| `startTime` | DateTime | required |  |  |  |
| `endTime` | DateTime | optional |  |  |  |
| `duration` | Int | required | `0` |  | Duration in minutes (calculated on stop) |
| `description` | String | optional |  |  |  |
| `billable` | Boolean | required | `true` |  |  |
| `isRunning` | Boolean | required | `false` |  | True if timer is currently running |
| `createdAt` | DateTime | required | `now()` |  |  |
| `updatedAt` | DateTime | required, updatedAt |  |  |  |
| `user` | User | required |  | → User, via (userId) → (id) |  |
| `project` | Project | required |  | → Project, via (projectId) → (id), onDelete Cascade |  |
| `task` | Task | optional |  | → Task, via (taskId) → (id), onDelete SetNull |  |

### Model TrashedItem

- Table: `trashed_items`
- Tenant-scoped: yes (`organizationId`)
- Soft-deletable: yes (`deletedAt`)
- Constraints and indexes:
  - `@@index([entity])`
  - `@@index([expiresAt])`
  - `@@index([organizationId])`

| Field | Type | Modifiers | Default | Relation | Notes |
| --- | --- | --- | --- | --- | --- |
| `id` | String | id, required | `cuid()` |  |  |
| `entity` | String | required |  |  | CLIENT \| PROJECT \| INVOICE \| PROPOSAL \| CONTRACT \| EXPENSE \| TASK \| ESTIMATE \| NOTE \| RETAINER_PLAN |
| `recordId` | String | required |  |  |  |
| `organizationId` | String | required |  |  |  |
| `data` | Json | required |  |  |  |
| `deletedAt` | DateTime | required | `now()` |  |  |
| `expiresAt` | DateTime | required |  |  | 30 days from deletedAt |
| `restoredAt` | DateTime | optional |  |  |  |
| `organization` | Organization | required |  | → Organization, via (organizationId) → (id), onDelete Cascade |  |

### Model UnmatchedEmail

- Table: `unmatched_emails`
- Tenant-scoped: yes (`organizationId`)
- Soft-deletable: no
- Constraints and indexes:
  - `@@index([createdAt])`
  - `@@index([senderEmail])`
  - `@@index([organizationId])`

| Field | Type | Modifiers | Default | Relation | Notes |
| --- | --- | --- | --- | --- | --- |
| `id` | String | id, required | `cuid()` |  |  |
| `organizationId` | String | required |  |  |  |
| `organization` | Organization | required |  | → Organization, via (organizationId) → (id), onDelete Cascade |  |
| `senderEmail` | String | required |  |  |  |
| `senderName` | String | optional |  |  |  |
| `subject` | String | required |  |  |  |
| `bodyText` | String | required |  |  |  |
| `bodyHtml` | String | optional |  |  |  |
| `rawEmail` | String | optional |  |  |  |
| `source` | String | optional |  |  | Source: upwork, email, form, etc. |
| `suggestedClients` | String | optional |  |  | JSON: AI suggestions |
| `suggestedProjects` | String | optional |  |  | JSON: AI suggestions |
| `status` | String | required | `"PENDING"` |  | PENDING, RESOLVED, IGNORED |
| `resolvedAt` | DateTime | optional |  |  |  |
| `createdAt` | DateTime | required | `now()` |  |  |

### Model User

- Table: `users`
- Tenant-scoped: yes (`organizationId`)
- Soft-deletable: no
- Constraints and indexes:
  - `@@index([organizationId])`

| Field | Type | Modifiers | Default | Relation | Notes |
| --- | --- | --- | --- | --- | --- |
| `id` | String | id, required | `cuid()` |  |  |
| `organizationId` | String | required |  |  | Set for all users to support multi-tenancy |
| `organization` | Organization | required |  | → Organization, via (organizationId) → (id) |  |
| `email` | String | unique, required |  |  |  |
| `name` | String | required |  |  |  |
| `password` | String | required |  |  |  |
| `role` | String | required | `"TEAM"` |  | ADMIN, TEAM, CLIENT, or BOT |
| `clientId` | String | optional |  |  | Set for CLIENT role users |
| `skills` | String | required | `"[]"` |  | JSON array of skills |
| `capacity` | Int | required | `100` |  | Percentage available |
| `isActive` | Boolean | required | `true` |  |  |
| `sessionVersion` | Int | required | `0` |  | Increment to revoke every previously issued user session |
| `hourlyRate` | Float | optional | `50` |  |  |
| `resetToken` | String | optional |  |  |  |
| `resetTokenExpiresAt` | DateTime | optional |  |  |  |
| `mfaEnabled` | Boolean | required | `false` |  |  |
| `mfaSecret` | String | optional |  |  |  |
| `mfaEnabledAt` | DateTime | optional |  |  |  |
| `mfaLastUsedStep` | Int | optional |  |  | Highest accepted TOTP step, so a code cannot be replayed |
| `mfaRecoveryCodes` | String[] | list, required | `[]` |  |  |
| `mfaFailedAttempts` | Int | required | `0` |  |  |
| `mfaLockedUntil` | DateTime | optional |  |  |  |
| `createdAt` | DateTime | required | `now()` |  |  |
| `updatedAt` | DateTime | required, updatedAt |  |  |  |
| `assignedThreads` | Thread[] | list, required |  | → Thread, "AssignedTo" |  |
| `assignedTasks` | Task[] | list, required |  | → Task, "TaskAssignee" |  |
| `draftedResponses` | Response[] | list, required |  | → Response, "DraftedBy" |  |
| `approvedResponses` | Response[] | list, required |  | → Response, "ApprovedBy" |  |
| `notifications` | Notification[] | list, required |  | → Notification |  |
| `internalNotes` | InternalNote[] | list, required |  | → InternalNote |  |
| `chatMessages` | ChatMessage[] | list, required |  | → ChatMessage, "ChatAuthor" |  |
| `chatReactions` | ChatReaction[] | list, required |  | → ChatReaction |  |
| `notes` | Note[] | list, required |  | → Note, "NoteAuthor" |  |
| `timeEntries` | TimeEntry[] | list, required |  | → TimeEntry |  |
| `attachments` | Attachment[] | list, required |  | → Attachment |  |
| `activities` | Activity[] | list, required |  | → Activity |  |
| `taskComments` | TaskComment[] | list, required |  | → TaskComment, "CommentAuthor" |  |
| `createdEvents` | CalendarEvent[] | list, required |  | → CalendarEvent, "EventCreator" |  |
| `eventAttendees` | EventAttendee[] | list, required |  | → EventAttendee |  |
| `proposals` | Proposal[] | list, required |  | → Proposal, "ProposalCreator" |  |
| `contracts` | Contract[] | list, required |  | → Contract, "ContractCreator" |  |
| `invoices` | Invoice[] | list, required |  | → Invoice, "InvoiceCreator" |  |
| `pushSubscriptions` | PushSubscription[] | list, required |  | → PushSubscription |  |
| `snippets` | Snippet[] | list, required |  | → Snippet |  |
| `proposalVersions` | ProposalVersion[] | list, required |  | → ProposalVersion |  |
| `timeSessions` | TimeSession[] | list, required |  | → TimeSession |  |
| `apiKeys` | ApiKey[] | list, required |  | → ApiKey |  |
| `formDrafts` | FormDraft[] | list, required |  | → FormDraft |  |
| `onboardingProgress` | OnboardingProgress | optional |  | → OnboardingProgress |  |
| `googleCalendarConnection` | GoogleCalendarConnection | optional |  | → GoogleCalendarConnection |  |
| `aiBridgeActions` | AiBridgeAction[] | list, required |  | → AiBridgeAction |  |
| `ownedPublicInquiries` | PublicInquiry[] | list, required |  | → PublicInquiry, "PublicInquiryOwner" |  |

### Model WPAlert

- Table: `wp_alerts`
- Tenant-scoped: yes (`organizationId`)
- Soft-deletable: no
- Constraints and indexes:
  - `@@index([organizationId])`
  - `@@index([siteUrl])`
  - `@@index([alertType])`
  - `@@index([createdAt])`

| Field | Type | Modifiers | Default | Relation | Notes |
| --- | --- | --- | --- | --- | --- |
| `id` | String | id, required | `cuid()` |  |  |
| `organizationId` | String | required |  |  |  |
| `siteId` | String | optional |  |  |  |
| `siteUrl` | String | required |  |  |  |
| `alertType` | String | required |  |  |  |
| `details` | String | required | `"{}"` |  |  |
| `createdAt` | DateTime | required | `now()` |  |  |
| `site` | WPSite | optional |  | → WPSite, via (siteId) → (id), onDelete SetNull |  |
| `organization` | Organization | required |  | → Organization, via (organizationId) → (id) |  |

### Model WPBackup

- Table: `wp_backups`
- Tenant-scoped: yes (`organizationId`)
- Soft-deletable: no
- Constraints and indexes:
  - `@@index([organizationId])`
  - `@@index([siteId])`
  - `@@index([siteUrl])`
  - `@@index([timestamp])`

| Field | Type | Modifiers | Default | Relation | Notes |
| --- | --- | --- | --- | --- | --- |
| `id` | String | id, required | `cuid()` |  |  |
| `organizationId` | String | required |  |  |  |
| `siteId` | String | required |  |  |  |
| `siteUrl` | String | required |  |  |  |
| `timestamp` | DateTime | required |  |  |  |
| `dbSuccess` | Boolean | required |  |  |  |
| `filesSuccess` | Boolean | required |  |  |  |
| `dbFile` | String | optional |  |  |  |
| `filesFile` | String | optional |  |  |  |
| `manifest` | String | optional |  |  |  |
| `dbSize` | BigInt | optional |  |  |  |
| `filesSize` | BigInt | optional |  |  |  |
| `createdAt` | DateTime | required | `now()` |  |  |
| `site` | WPSite | required |  | → WPSite, via (siteId) → (id), onDelete Cascade |  |
| `organization` | Organization | required |  | → Organization, via (organizationId) → (id) |  |

### Model WPBridgeNonce

- Table: `wp_bridge_nonces`
- Tenant-scoped: yes (`organizationId`)
- Soft-deletable: no
- Constraints and indexes:
  - `@@unique([siteId, nonceHash])`
  - `@@index([organizationId, createdAt])`
  - `@@index([createdAt])`

| Field | Type | Modifiers | Default | Relation | Notes |
| --- | --- | --- | --- | --- | --- |
| `id` | String | id, required | `cuid()` |  |  |
| `organizationId` | String | required |  |  |  |
| `siteId` | String | required |  |  |  |
| `nonceHash` | String | required |  |  |  |
| `createdAt` | DateTime | required | `now()` |  |  |
| `organization` | Organization | required |  | → Organization, via (organizationId) → (id), onDelete Cascade |  |
| `site` | WPSite | required |  | → WPSite, via (siteId) → (id), onDelete Cascade |  |

### Model WPFleetOp

- Table: `wp_fleet_ops`
- Tenant-scoped: yes (`organizationId`)
- Soft-deletable: no
- Constraints and indexes:
  - `@@index([organizationId])`
  - `@@index([createdAt(sort: Desc)])`
  - `@@index([opType])`
  - `@@index([createdBy])`

| Field | Type | Modifiers | Default | Relation | Notes |
| --- | --- | --- | --- | --- | --- |
| `id` | String | id, required | `cuid()` |  |  |
| `organizationId` | String | required |  |  |  |
| `opType` | String | required |  |  | 'file_patch' \| 'command' \| 'option_set' \| 'magic_login' \| 'magic_login_revoke' |
| `payload` | Json | required |  |  | original request body |
| `targetCount` | Int | required |  |  |  |
| `successCount` | Int | required | `0` |  |  |
| `failureCount` | Int | required | `0` |  |  |
| `createdBy` | String | required |  |  | user id from JWT |
| `createdAt` | DateTime | required | `now()` |  |  |
| `completedAt` | DateTime | optional |  |  |  |
| `organization` | Organization | required |  | → Organization, via (organizationId) → (id) |  |

### Model WPMagicLoginLog

- Table: `wp_magic_login_log`
- Tenant-scoped: yes (`organizationId`)
- Soft-deletable: no
- Constraints and indexes:
  - `@@index([organizationId])`
  - `@@index([siteId])`
  - `@@index([siteUrl])`
  - `@@index([ts(sort: Desc)])`
  - `@@index([status])`

| Field | Type | Modifiers | Default | Relation | Notes |
| --- | --- | --- | --- | --- | --- |
| `id` | String | id, required | `cuid()` |  |  |
| `organizationId` | String | required |  |  |  |
| `siteId` | String | optional |  |  | nullable: pre-registration/wildcard logins may not have a row yet |
| `siteUrl` | String | required |  |  | canonical site URL — survives WPSite deletes |
| `userId` | Int | optional |  |  | WP user id (admin being issued for / logged in as) |
| `hubUserId` | String | optional |  |  | hub user id (operator that triggered the issuance / revoke) |
| `ip` | String | required | `"0.0.0.0"` |  |  |
| `status` | String | required |  |  | 'issued' \| 'consumed' \| 'revoked' \| 'rejected' |
| `reason` | String | optional |  |  | 'expired_or_invalid' \| 'replayed' \| 'expired' \| 'rate_limited' \| 'ip_not_allowed' \| 'manual_revoke' |
| `tokenHash` | String | optional |  |  | sha256 of the raw magic-login token (NEVER the token itself) |
| `ts` | DateTime | required | `now()` |  |  |
| `organization` | Organization | required |  | → Organization, via (organizationId) → (id) |  |

### Model WPReport

- Table: `wp_reports`
- Tenant-scoped: yes (`organizationId`)
- Soft-deletable: no
- Constraints and indexes:
  - `@@unique([siteId, month])`
  - `@@index([organizationId])`
  - `@@index([siteUrl])`
  - `@@index([createdAt])`

| Field | Type | Modifiers | Default | Relation | Notes |
| --- | --- | --- | --- | --- | --- |
| `id` | String | id, required | `cuid()` |  |  |
| `organizationId` | String | required |  |  |  |
| `siteId` | String | required |  |  |  |
| `siteUrl` | String | required |  |  |  |
| `month` | String | required |  |  |  |
| `uptime` | String | optional |  |  | JSON: { total, ok, failed, pct } |
| `updates` | String | optional |  |  | JSON: { plugins, themes, core } |
| `cleanup` | String | optional |  |  | JSON: { revisions, spam_comments, trash_posts, expired_tokens } |
| `hours` | String | optional |  |  | JSON: { available, used, remaining, banked, log } |
| `ssl` | String | optional |  |  | JSON: { status, days } |
| `payload` | String | optional |  |  | Full raw payload |
| `createdAt` | DateTime | required | `now()` |  |  |
| `site` | WPSite | required |  | → WPSite, via (siteId) → (id), onDelete Cascade |  |
| `organization` | Organization | required |  | → Organization, via (organizationId) → (id) |  |

### Model WPSite

- Table: `wp_sites`
- Tenant-scoped: yes (`organizationId`)
- Soft-deletable: no
- Constraints and indexes:
  - `@@index([organizationId])`
  - `@@index([status])`

| Field | Type | Modifiers | Default | Relation | Notes |
| --- | --- | --- | --- | --- | --- |
| `id` | String | id, required | `cuid()` |  |  |
| `organizationId` | String | required |  |  |  |
| `bridgeSecretEncrypted` | String | optional |  |  |  |
| `name` | String | required |  |  |  |
| `url` | String | required |  |  |  |
| `adminUrl` | String | optional |  |  |  |
| `clientId` | String | optional |  |  |  |
| `projectId` | String | unique, optional |  |  |  |
| `status` | String | required | `"ACTIVE"` |  | ACTIVE \| MAINTENANCE \| OFFLINE \| ERROR |
| `wpVersion` | String | optional |  |  |  |
| `phpVersion` | String | optional |  |  |  |
| `pluginCount` | Int | required | `0` |  |  |
| `theme` | String | optional |  |  |  |
| `lastCheckedAt` | DateTime | optional |  |  |  |
| `healthScore` | Int | required | `100` |  | 0-100 |
| `alerts` | String | required | `"[]"` |  | JSON: array of alert objects |
| `magicLoginUrl` | String | optional |  |  |  |
| `bridgeVersion` | String | optional |  |  |  |
| `ttfb` | Int | optional |  |  |  |
| `dbSize` | BigInt | optional |  |  |  |
| `diskBytes` | BigInt | optional |  |  |  |
| `diskUsagePct` | Float | optional |  |  |  |
| `pluginUpdates` | Int | required | `0` |  |  |
| `createdAt` | DateTime | required | `now()` |  |  |
| `updatedAt` | DateTime | required, updatedAt |  |  |  |
| `client` | Client | optional |  | → Client, via (clientId) → (id), "WPSiteClient" |  |
| `project` | Project | optional |  | → Project, via (projectId) → (id) |  |
| `backups` | WPBackup[] | list, required |  | → WPBackup |  |
| `reports` | WPReport[] | list, required |  | → WPReport |  |
| `alertsLog` | WPAlert[] | list, required |  | → WPAlert |  |
| `nonces` | WPBridgeNonce[] | list, required |  | → WPBridgeNonce |  |
| `organization` | Organization | required |  | → Organization, via (organizationId) → (id) |  |

### Model WeeklyDigest

- Table: `weekly_digests`
- Tenant-scoped: yes (`organizationId`)
- Soft-deletable: no
- Constraints and indexes:
  - `@@index([organizationId])`

| Field | Type | Modifiers | Default | Relation | Notes |
| --- | --- | --- | --- | --- | --- |
| `id` | String | id, required | `cuid()` |  |  |
| `organizationId` | String | required |  |  |  |
| `organization` | Organization | required |  | → Organization, via (organizationId) → (id), onDelete Cascade |  |
| `weekStart` | DateTime | required |  |  |  |
| `weekEnd` | DateTime | required |  |  |  |
| `newLeads` | Int | required | `0` |  |  |
| `proposalsSent` | Int | required | `0` |  |  |
| `proposalsViewed` | Int | required | `0` |  |  |
| `proposalsHired` | Int | required | `0` |  |  |
| `tasksOverdue` | Int | required | `0` |  |  |
| `retainerTotal` | Float | required | `0` |  |  |
| `clientHealthSummary` | String | required | `"{}"` |  | JSON: per-client health scores |
| `fullDigest` | String | required |  |  | Full AI-generated digest text |
| `createdAt` | DateTime | required | `now()` |  |  |

## Enums

The schema declares no Prisma enums. Status-like columns are `String`
fields whose allowed values are listed in the field notes above.
