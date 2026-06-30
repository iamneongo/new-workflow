import { Pool } from 'pg';

let pool: Pool | null = null;

function resolveConnectionString(): string {
  const candidates = [
    process.env.DATABASE_URL,
    process.env.POSTGRES_URL_NON_POOLING,
    process.env.POSTGRES_URL,
    process.env.SUPABASE_DATABASE_URL,
    process.env.NEON_DATABASE_URL,
    process.env.PG_CONNECTION_STRING,
  ].filter((value): value is string => !!value && value.trim().length > 0);

  const connectionString = candidates[0];
  if (!connectionString) {
    throw new Error(
      'Missing database connection string. Set DATABASE_URL or a supported Postgres env var.'
    );
  }

  let hostname = '';
  try {
    hostname = new URL(connectionString).hostname.toLowerCase();
  } catch {
    throw new Error(
      'DATABASE_URL must be a full Postgres connection string like postgres://user:pass@host:5432/db'
    );
  }

  if (!hostname) {
    throw new Error('DATABASE_URL is missing a hostname.');
  }

  if (hostname === 'base') {
    throw new Error(
      'DATABASE_URL points to host "base". Replace it with your real Postgres host in Vercel env vars.'
    );
  }

  return connectionString;
}

function shouldUseSsl(connectionString: string): boolean {
  try {
    const host = new URL(connectionString).hostname.toLowerCase();
    return host !== 'localhost' && host !== '127.0.0.1' && host !== '::1';
  } catch {
    return true;
  }
}

export function getPool(): Pool {
  if (!pool) {
    const connectionString = resolveConnectionString();
    const config: ConstructorParameters<typeof Pool>[0] = {
      connectionString,
    };

    if (shouldUseSsl(connectionString)) {
      config.ssl = {
        rejectUnauthorized: false,
      };
    }

    pool = new Pool(config);
  }
  return pool;
}

export function normalizeThreadId(value: unknown): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 1) {
    return null;
  }

  return parsed;
}

export type ApprovalMessageMode = 'forward' | 'copy';

export type SupplierRouteMode = 'forward' | 'copy';

export type FinalMessageMode = 'forward' | 'copy';

export type SupplyChangeMessageMode = 'forward' | 'copy';

export interface SourceMessageRecognitionConfig {
  enabled: boolean;
  requiredKeywords: string[];
}

export interface ApprovalActionConfig {
  agreeButtonLabel: string;
  disagreeButtonLabel: string;
  agreeResultMessage: string;
  disagreeResultMessage: string;
  hideAfterAction: boolean;
  refreshOnSourceReply: boolean;
  deleteSourceMessageOnReply: boolean;
}

export interface ApprovalTopicConfig {
  sourceThreadId: number;
  approvalMessageMode: ApprovalMessageMode;
  approvalCustomMessage: string;
  approvalActionConfig: ApprovalActionConfig;
}

export interface RejectTopicConfig {
  sourceThreadId: number;
  rejectCustomMessage: string;
}

export interface SupplierRoute {
  id: string;
  name: string;
  groupId: string;
  threadId: number | null;
  messageMode: SupplierRouteMode;
}

export const DEFAULT_SOURCE_MESSAGE_RECOGNITION_CONFIG: SourceMessageRecognitionConfig = {
  enabled: true,
  requiredKeywords: ['CT', 'Buổi', 'HM'],
};

export function normalizeApprovalMessageMode(value: unknown): ApprovalMessageMode {
  return value === 'copy' ? 'copy' : 'forward';
}

export function normalizeApprovalActionConfig(value: unknown): ApprovalActionConfig {
  const fallback: ApprovalActionConfig = {
    hideAfterAction: false,
    refreshOnSourceReply: false,
    deleteSourceMessageOnReply: false,
    agreeButtonLabel: '👍 Đồng ý',
    disagreeButtonLabel: '👎 Không đồng ý',
    agreeResultMessage: '✅ *ĐÃ PHÊ DUYỆT SƠ BỘ* bởi {{userFullName}}',
    disagreeResultMessage: '❌ *BỊ TỪ CHỐI PHÊ DUYỆT* bởi {{userFullName}}',
  };

  if (!value || typeof value !== 'object') {
    return fallback;
  }

  const cfg = value as Partial<ApprovalActionConfig>;
  return {
    hideAfterAction: cfg.hideAfterAction === true,
    refreshOnSourceReply: cfg.refreshOnSourceReply === true,
    deleteSourceMessageOnReply: cfg.deleteSourceMessageOnReply === true,
    agreeButtonLabel: typeof cfg.agreeButtonLabel === 'string' && cfg.agreeButtonLabel.trim()
      ? cfg.agreeButtonLabel.trim()
      : fallback.agreeButtonLabel,
    disagreeButtonLabel: typeof cfg.disagreeButtonLabel === 'string' && cfg.disagreeButtonLabel.trim()
      ? cfg.disagreeButtonLabel.trim()
      : fallback.disagreeButtonLabel,
    agreeResultMessage: typeof cfg.agreeResultMessage === 'string' && cfg.agreeResultMessage.trim()
      ? cfg.agreeResultMessage.trim()
      : fallback.agreeResultMessage,
    disagreeResultMessage: typeof cfg.disagreeResultMessage === 'string' && cfg.disagreeResultMessage.trim()
      ? cfg.disagreeResultMessage.trim()
      : fallback.disagreeResultMessage,
  };
}

export function normalizeApprovalTopicConfigs(value: unknown): ApprovalTopicConfig[] {
  if (value === null || value === undefined || value === '') return [];

  let rawValues: unknown[] = [];
  if (Array.isArray(value)) {
    rawValues = value;
  } else if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      rawValues = Array.isArray(parsed) ? parsed : [];
    } catch {
      rawValues = [];
    }
  } else {
    rawValues = [value];
  }

  const fallbackAction = DEFAULT_APPROVAL_ACTION_CONFIG;
  return rawValues
    .map((item: any) => {
      const sourceThreadId = normalizeThreadId(item?.sourceThreadId);
      if (sourceThreadId === null) return null;
      const actionConfig = normalizeApprovalActionConfig(item?.approvalActionConfig);
      return {
        sourceThreadId,
        approvalMessageMode: item?.approvalMessageMode === 'copy' ? 'copy' : 'forward',
        approvalCustomMessage: typeof item?.approvalCustomMessage === 'string' && item.approvalCustomMessage.trim()
          ? item.approvalCustomMessage.trim()
          : DEFAULT_APPROVAL_CUSTOM_MESSAGE,
        approvalActionConfig: actionConfig || fallbackAction,
      } satisfies ApprovalTopicConfig;
    })
    .filter((item): item is ApprovalTopicConfig => item !== null);
}

export function normalizeSupplierRouteMode(value: unknown): SupplierRouteMode {
  return value === 'copy' ? 'copy' : 'forward';
}

export const DEFAULT_APPROVAL_CUSTOM_MESSAGE =
  '📡 YÊU CẦU PHÊ DUYỆT\n\nVui lòng xem nội dung gốc được gửi bên dưới rồi bấm nút xử lý.';

export const DEFAULT_REJECT_CUSTOM_MESSAGE =
  '❌ THÔNG BÁO TỪ CHỐI PHÊ DUYỆT\n\nNgười duyệt: {{userFullName}}\nNgười gửi yêu cầu: {{senderName}}\nNội dung gốc:\n{{originalText}}';

export const DEFAULT_APPROVAL_ACTION_CONFIG: ApprovalActionConfig = {
  hideAfterAction: false,
  refreshOnSourceReply: false,
  deleteSourceMessageOnReply: false,
  agreeButtonLabel: '👍 Đồng ý',
  disagreeButtonLabel: '👎 Không đồng ý',
  agreeResultMessage: '✅ *ĐÃ PHÊ DUYỆT SƠ BỘ* bởi {{userFullName}}',
  disagreeResultMessage: '❌ *BỊ TỪ CHỐI PHÊ DUYỆT* bởi {{userFullName}}',
};

export function normalizeThreadIds(value: unknown): number[] {
  if (value === null || value === undefined || value === '') {
    return [];
  }

  const rawValues = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? (() => {
          const trimmed = value.trim();
          if (!trimmed) return [];
          if (trimmed.startsWith('[')) {
            try {
              const parsed = JSON.parse(trimmed);
              if (Array.isArray(parsed)) return parsed;
            } catch {
              // Fall through to treat the string as a single value.
            }
          }
          return trimmed.split(',').map((item) => item.trim()).filter(Boolean);
        })()
      : [value];

  const normalized = rawValues
    .map((item) => normalizeThreadId(item))
    .filter((item): item is number => item !== null);

  return Array.from(new Set(normalized));
}

export function normalizeRejectTopicConfigs(value: unknown): RejectTopicConfig[] {
  if (value === null || value === undefined || value === '') return [];

  let rawValues: unknown[] = [];
  if (Array.isArray(value)) {
    rawValues = value;
  } else if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      rawValues = Array.isArray(parsed) ? parsed : [];
    } catch {
      rawValues = [];
    }
  } else {
    rawValues = [value];
  }

  return rawValues
    .map((item: any) => {
      const sourceThreadId = normalizeThreadId(item?.sourceThreadId);
      if (sourceThreadId === null) return null;
      return {
        sourceThreadId,
        rejectCustomMessage: typeof item?.rejectCustomMessage === 'string' && item.rejectCustomMessage.trim()
          ? item.rejectCustomMessage.trim()
          : DEFAULT_REJECT_CUSTOM_MESSAGE,
      } satisfies RejectTopicConfig;
    })
    .filter((item): item is RejectTopicConfig => item !== null);
}

export function normalizeSourceMessageRecognitionConfig(value: unknown): SourceMessageRecognitionConfig {
  const fallback = DEFAULT_SOURCE_MESSAGE_RECOGNITION_CONFIG;
  if (!value || typeof value !== 'object') {
    return fallback;
  }

  const cfg = value as Partial<SourceMessageRecognitionConfig>;
  const requiredKeywords = Array.isArray(cfg.requiredKeywords)
    ? cfg.requiredKeywords
      .map((item) => (typeof item === 'string' ? item.trim() : ''))
      .filter(Boolean)
    : fallback.requiredKeywords;

  return {
    enabled: cfg.enabled !== false,
    requiredKeywords: requiredKeywords.length > 0 ? Array.from(new Set(requiredKeywords)) : fallback.requiredKeywords,
  };
}

function readStoredThreadIds(threadIdsValue: unknown, legacyThreadId: unknown): number[] {
  if (threadIdsValue !== null && threadIdsValue !== undefined) {
    return normalizeThreadIds(threadIdsValue);
  }

  const legacy = normalizeThreadId(legacyThreadId);
  return legacy !== null ? [legacy] : [];
}

export function normalizeSupplierRoutes(value: unknown): SupplierRoute[] {
  if (value === null || value === undefined || value === '') {
    return [];
  }

  let rawValues: unknown[] = [];
  if (Array.isArray(value)) {
    rawValues = value;
  } else if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      rawValues = Array.isArray(parsed) ? parsed : [];
    } catch {
      rawValues = [];
    }
  } else {
    rawValues = [value];
  }

  return rawValues
    .map((item: any, index) => {
      if (!item || typeof item !== 'object') return null;
      const groupId = typeof item.groupId === 'string' ? item.groupId.trim() : '';
      if (!groupId) return null;
      return {
        id: typeof item.id === 'string' && item.id.trim() ? item.id.trim() : `supplier_${index + 1}`,
        name: typeof item.name === 'string' && item.name.trim() ? item.name.trim() : `Nhà cung ứng ${index + 1}`,
        groupId,
        threadId: normalizeThreadId(item.threadId),
        messageMode: normalizeSupplierRouteMode(item.messageMode),
      } satisfies SupplierRoute;
    })
    .filter((item): item is SupplierRoute => item !== null);
}

export interface TopicEntry {
  threadId: number;
  topicName: string;
  topicIcon: string;
  lastUpdated: number;
}

export interface ChatEntry {
  chatId: string;
  chatTitle: string;
  chatType: 'group' | 'channel' | 'supergroup';
  username: string | null;
  photoPath: string | null;
  photoData: string | null;
  photoMime: string | null;
  lastUpdated: number;
  topics: Record<string, TopicEntry>;
}

export interface AutomationSetup {
  id: string;
  name: string;
  sortOrder: number;
  botToken: string;
  sourceGroupId: string;
  sourceThreadIds: number[];
  sourceThreadId: number | null;
  sourceMessageRecognitionConfig: SourceMessageRecognitionConfig;
  approvalGroupId: string;
  approvalThreadId: number | null;
  approvalMessageMode: ApprovalMessageMode;
  approvalCustomMessage: string;
  approvalActionConfig: ApprovalActionConfig;
  approvalTopicConfigs: ApprovalTopicConfig[];
  supplyGroupId: string;
  supplyThreadId: number | null;
  supplierSelectionHideAfterAction: boolean;
  supplyPromptHideAfterAction: boolean;
  supplyListenGroupId: string;
  supplyListenThreadIds: number[];
  supplyListenThreadId: number | null;
  supplyChangeGroupId: string;
  supplyChangeThreadId: number | null;
  supplyChangeMessageMode: SupplyChangeMessageMode;
  supplierRoutes: SupplierRoute[];
  deliveryGroupId: string;
  deliveryThreadId: number | null;
  finalMessageMode: FinalMessageMode;
  finalGroupId: string;
  finalThreadId: number | null;
  rejectGroupId: string;
  rejectThreadId: number | null;
  rejectCustomMessage: string;
  rejectTopicConfigs: RejectTopicConfig[];
  isListening: boolean;
  forwardCount: number;
  lastForwardTime: number | null;
  destGroupId: string; // compatibility
}

export interface Database {
  chats: Record<string, ChatEntry>;
}

export function getChatPhotoUrl(chatId: string, lastUpdated: number): string {
  return `/api/chats/${encodeURIComponent(chatId)}/photo?v=${encodeURIComponent(String(lastUpdated))}`;
}

/**
 * Ensures the database tables exist in PostgreSQL.
 */
export async function ensureDatabase(): Promise<void> {
  const p = getPool();
  const client = await p.connect();
  try {
    // Create chats table
    await client.query(`
      CREATE TABLE IF NOT EXISTS chats (
        chat_id VARCHAR(100) PRIMARY KEY,
        chat_title VARCHAR(255) NOT NULL,
        chat_type VARCHAR(50) NOT NULL,
        username VARCHAR(255),
        photo_path VARCHAR(255),
        photo_data TEXT,
        photo_mime VARCHAR(100),
        last_updated BIGINT NOT NULL
      );
    `);

    // Create topics table
    await client.query(`
      CREATE TABLE IF NOT EXISTS topics (
        chat_id VARCHAR(100) REFERENCES chats(chat_id) ON DELETE CASCADE,
        thread_id INTEGER NOT NULL,
        topic_name VARCHAR(255) NOT NULL,
        topic_icon VARCHAR(50) NOT NULL,
        last_updated BIGINT NOT NULL,
        PRIMARY KEY (chat_id, thread_id)
      );
    `);

    // Create automation_setups table
    await client.query(`
      CREATE TABLE IF NOT EXISTS automation_setups (
        id VARCHAR(100) PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        sort_order INTEGER DEFAULT 0 NOT NULL,
        bot_token VARCHAR(255),
        source_group_id VARCHAR(100),
        source_thread_ids INTEGER[],
        source_thread_id INTEGER,
        source_message_recognition_config JSONB,
        approval_group_id VARCHAR(100),
        approval_thread_id INTEGER,
        approval_message_mode VARCHAR(20),
        approval_custom_message TEXT,
        approval_action_config JSONB,
        approval_topic_configs JSONB,
        supply_group_id VARCHAR(100),
        supply_thread_id INTEGER,
        supplier_selection_hide_after_action BOOLEAN DEFAULT FALSE NOT NULL,
        supply_prompt_hide_after_action BOOLEAN DEFAULT FALSE NOT NULL,
        supply_listen_group_id VARCHAR(100),
        supply_listen_thread_ids INTEGER[],
        supply_listen_thread_id INTEGER,
        supply_change_group_id VARCHAR(100),
        supply_change_thread_id INTEGER,
        supply_change_message_mode VARCHAR(20),
        supplier_routes JSONB,
        delivery_group_id VARCHAR(100),
        delivery_thread_id INTEGER,
        final_message_mode VARCHAR(20),
        final_group_id VARCHAR(100),
        final_thread_id INTEGER,
        reject_group_id VARCHAR(100),
        reject_thread_id INTEGER,
        reject_custom_message TEXT,
        reject_topic_configs JSONB,
        dest_group_id VARCHAR(100),
        is_listening BOOLEAN DEFAULT FALSE NOT NULL,
        forward_count INTEGER DEFAULT 0 NOT NULL,
        last_forward_time BIGINT
      );
    `);

    // Add new columns to automation_setups if they don't exist
    const alterQueries = [
      'ALTER TABLE automation_setups ADD COLUMN IF NOT EXISTS source_thread_id INTEGER',
      'ALTER TABLE automation_setups ADD COLUMN IF NOT EXISTS source_thread_ids INTEGER[]',
      'ALTER TABLE automation_setups ADD COLUMN IF NOT EXISTS source_message_recognition_config JSONB',
      'ALTER TABLE automation_setups ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT 0',
      'ALTER TABLE automation_setups ADD COLUMN IF NOT EXISTS approval_group_id VARCHAR(100)',
      'ALTER TABLE automation_setups ADD COLUMN IF NOT EXISTS approval_thread_id INTEGER',
      'ALTER TABLE automation_setups ADD COLUMN IF NOT EXISTS approval_message_mode VARCHAR(20)',
      'ALTER TABLE automation_setups ADD COLUMN IF NOT EXISTS approval_custom_message TEXT',
      'ALTER TABLE automation_setups ADD COLUMN IF NOT EXISTS approval_action_config JSONB',
      'ALTER TABLE automation_setups ADD COLUMN IF NOT EXISTS approval_topic_configs JSONB',
      'ALTER TABLE automation_setups ADD COLUMN IF NOT EXISTS supply_group_id VARCHAR(100)',
      'ALTER TABLE automation_setups ADD COLUMN IF NOT EXISTS supply_thread_id INTEGER',
      'ALTER TABLE automation_setups ADD COLUMN IF NOT EXISTS supplier_selection_hide_after_action BOOLEAN DEFAULT FALSE',
      'ALTER TABLE automation_setups ADD COLUMN IF NOT EXISTS supply_prompt_hide_after_action BOOLEAN DEFAULT FALSE',
      'ALTER TABLE automation_setups ADD COLUMN IF NOT EXISTS supply_listen_group_id VARCHAR(100)',
      'ALTER TABLE automation_setups ADD COLUMN IF NOT EXISTS supply_listen_thread_ids INTEGER[]',
      'ALTER TABLE automation_setups ADD COLUMN IF NOT EXISTS supply_listen_thread_id INTEGER',
      'ALTER TABLE automation_setups ADD COLUMN IF NOT EXISTS supply_change_group_id VARCHAR(100)',
      'ALTER TABLE automation_setups ADD COLUMN IF NOT EXISTS supply_change_thread_id INTEGER',
      'ALTER TABLE automation_setups ADD COLUMN IF NOT EXISTS supply_change_message_mode VARCHAR(20)',
      'ALTER TABLE automation_setups ADD COLUMN IF NOT EXISTS supplier_routes JSONB',
      'ALTER TABLE automation_setups ADD COLUMN IF NOT EXISTS delivery_group_id VARCHAR(100)',
      'ALTER TABLE automation_setups ADD COLUMN IF NOT EXISTS delivery_thread_id INTEGER',
      'ALTER TABLE automation_setups ADD COLUMN IF NOT EXISTS final_message_mode VARCHAR(20)',
      'ALTER TABLE automation_setups ADD COLUMN IF NOT EXISTS final_group_id VARCHAR(100)',
      'ALTER TABLE automation_setups ADD COLUMN IF NOT EXISTS final_thread_id INTEGER',
      'ALTER TABLE automation_setups ADD COLUMN IF NOT EXISTS reject_group_id VARCHAR(100)',
      'ALTER TABLE automation_setups ADD COLUMN IF NOT EXISTS reject_thread_id INTEGER',
      'ALTER TABLE automation_setups ADD COLUMN IF NOT EXISTS reject_custom_message TEXT',
      'ALTER TABLE automation_setups ADD COLUMN IF NOT EXISTS reject_topic_configs JSONB',
      'ALTER TABLE chats ADD COLUMN IF NOT EXISTS photo_data TEXT',
      'ALTER TABLE chats ADD COLUMN IF NOT EXISTS photo_mime VARCHAR(100)'
    ];
    for (const q of alterQueries) {
      await client.query(q);
    }

    await client.query(`
      WITH ordered AS (
        SELECT id, ROW_NUMBER() OVER (ORDER BY COALESCE(sort_order, 2147483647), name ASC, id ASC) - 1 AS next_sort_order
        FROM automation_setups
      )
      UPDATE automation_setups AS setups
      SET sort_order = ordered.next_sort_order
      FROM ordered
      WHERE setups.id = ordered.id
        AND (setups.sort_order IS NULL OR setups.sort_order <> ordered.next_sort_order)
    `);

    await client.query(`
      UPDATE automation_setups
      SET source_thread_ids = ARRAY[source_thread_id]
      WHERE source_thread_ids IS NULL AND source_thread_id IS NOT NULL
    `);

    await client.query(`
      UPDATE automation_setups
      SET source_message_recognition_config = COALESCE(source_message_recognition_config, $1::jsonb)
      WHERE source_message_recognition_config IS NULL
    `, [JSON.stringify(DEFAULT_SOURCE_MESSAGE_RECOGNITION_CONFIG)]);

    await client.query(`
      UPDATE automation_setups
      SET supply_listen_group_id = COALESCE(supply_listen_group_id, supply_group_id),
          supply_listen_thread_ids = COALESCE(
            supply_listen_thread_ids,
            CASE
              WHEN supply_listen_thread_id IS NOT NULL THEN ARRAY[supply_listen_thread_id]
              WHEN supply_thread_id IS NOT NULL THEN ARRAY[supply_thread_id]
              ELSE NULL
            END
          ),
          supply_listen_thread_id = COALESCE(
            supply_listen_thread_id,
            CASE
              WHEN supply_listen_thread_ids IS NOT NULL AND array_length(supply_listen_thread_ids, 1) > 0
                THEN supply_listen_thread_ids[1]
              WHEN supply_thread_id IS NOT NULL
                THEN supply_thread_id
              ELSE NULL
            END
          )
      WHERE supply_listen_group_id IS NULL
         OR supply_listen_thread_id IS NULL
         OR supply_listen_thread_ids IS NULL
    `);

    await client.query(`
      UPDATE automation_setups
      SET approval_message_mode = COALESCE(approval_message_mode, 'forward'),
          approval_custom_message = COALESCE(approval_custom_message, $1)
      WHERE approval_message_mode IS NULL OR approval_custom_message IS NULL
    `, [DEFAULT_APPROVAL_CUSTOM_MESSAGE]);

    await client.query(`
      UPDATE automation_setups
      SET approval_action_config = COALESCE(approval_action_config, $1::jsonb)
      WHERE approval_action_config IS NULL
    `, [JSON.stringify({
      hideAfterAction: false,
      refreshOnSourceReply: false,
      deleteSourceMessageOnReply: false,
      agreeButtonLabel: '👍 Đồng ý',
      disagreeButtonLabel: '👎 Không đồng ý',
      agreeResultMessage: '✅ *ĐÃ PHÊ DUYỆT SƠ BỘ* bởi {{userFullName}}',
      disagreeResultMessage: '❌ *BỊ TỪ CHỐI PHÊ DUYỆT* bởi {{userFullName}}',
    })]);

    await client.query(`
      UPDATE automation_setups
      SET approval_topic_configs = COALESCE(approval_topic_configs, '[]'::jsonb)
      WHERE approval_topic_configs IS NULL
    `);

    await client.query(`
      UPDATE automation_setups
      SET reject_custom_message = COALESCE(reject_custom_message, $1),
          reject_topic_configs = COALESCE(reject_topic_configs, '[]'::jsonb)
      WHERE reject_custom_message IS NULL OR reject_topic_configs IS NULL
    `, [DEFAULT_REJECT_CUSTOM_MESSAGE]);

    await client.query(`
      UPDATE automation_setups
      SET supplier_routes = COALESCE(supplier_routes, '[]'::jsonb)
      WHERE supplier_routes IS NULL
    `);

    await client.query(`
      UPDATE automation_setups
      SET supply_change_message_mode = COALESCE(supply_change_message_mode, 'forward')
      WHERE supply_change_message_mode IS NULL
    `);

    await client.query(`
      UPDATE automation_setups
      SET final_message_mode = COALESCE(final_message_mode, 'forward')
      WHERE final_message_mode IS NULL
    `);

    // Create workflow_logs table
    await client.query(`
      CREATE TABLE IF NOT EXISTS workflow_logs (
        id SERIAL PRIMARY KEY,
        automation_id VARCHAR(100) NOT NULL,
        original_chat_id VARCHAR(100) NOT NULL,
        original_thread_id INTEGER,
        original_msg_id INTEGER NOT NULL,
        original_sender_name VARCHAR(255),
        original_text TEXT,
        original_media_label VARCHAR(100),
        approval_msg_id INTEGER,
        supply_msg_id INTEGER,
        supplier_selection_msg_id INTEGER,
        supply_change_msg_id INTEGER,
        supplier_route_id VARCHAR(100),
        selected_supplier_group_id VARCHAR(100),
        selected_supplier_thread_id INTEGER,
        supply_prompt_group_id VARCHAR(100),
        supply_prompt_thread_id INTEGER,
        delivery_msg_id INTEGER,
        status VARCHAR(50) DEFAULT 'pending'
      );
    `);

    const workflowLogAlterQueries = [
      'ALTER TABLE workflow_logs ADD COLUMN IF NOT EXISTS supplier_selection_msg_id INTEGER',
      'ALTER TABLE workflow_logs ADD COLUMN IF NOT EXISTS original_thread_id INTEGER',
      'ALTER TABLE workflow_logs ADD COLUMN IF NOT EXISTS original_sender_name VARCHAR(255)',
      'ALTER TABLE workflow_logs ADD COLUMN IF NOT EXISTS supply_change_msg_id INTEGER',
      'ALTER TABLE workflow_logs ADD COLUMN IF NOT EXISTS supplier_route_id VARCHAR(100)',
      'ALTER TABLE workflow_logs ADD COLUMN IF NOT EXISTS selected_supplier_group_id VARCHAR(100)',
      'ALTER TABLE workflow_logs ADD COLUMN IF NOT EXISTS selected_supplier_thread_id INTEGER',
      'ALTER TABLE workflow_logs ADD COLUMN IF NOT EXISTS supply_prompt_group_id VARCHAR(100)',
      'ALTER TABLE workflow_logs ADD COLUMN IF NOT EXISTS supply_prompt_thread_id INTEGER',
      'ALTER TABLE workflow_logs ADD COLUMN IF NOT EXISTS delivery_group_id VARCHAR(100)',
      'ALTER TABLE workflow_logs ADD COLUMN IF NOT EXISTS original_msg_ids TEXT',
      'ALTER TABLE workflow_logs ADD COLUMN IF NOT EXISTS approval_content_msg_ids TEXT',
      'ALTER TABLE workflow_logs ADD COLUMN IF NOT EXISTS thread_root_msg_id INTEGER',
    ];
    for (const q of workflowLogAlterQueries) {
      await client.query(q);
    }

    // Add unique index to prevent duplicate workflow logs for same message + automation
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_workflow_logs_automation_msg
      ON workflow_logs (automation_id, original_msg_id)
    `);

    // Create global_settings table
    await client.query(`
      CREATE TABLE IF NOT EXISTS global_settings (
        key VARCHAR(100) PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
  } catch (error) {
    console.error('Error during database schema migration:', error);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Loads the database structure (chats and topics) from PostgreSQL.
 */
export async function loadDatabase(includePhotoData = true): Promise<Database> {
  const p = getPool();
  try {
    await ensureDatabase();
    
    const chatsRes = includePhotoData
      ? await p.query('SELECT * FROM chats')
      : await p.query('SELECT chat_id, chat_title, chat_type, username, photo_path, last_updated FROM chats');
    const topicsRes = await p.query('SELECT * FROM topics');
    
    const chats: Record<string, ChatEntry> = {};
    
    for (const row of chatsRes.rows) {
      const rawPhotoPath = typeof row.photo_path === 'string' ? row.photo_path : null;
      const rawPhotoData = includePhotoData && typeof row.photo_data === 'string' && row.photo_data.length > 0
        ? row.photo_data
        : null;
      const rawPhotoMime = includePhotoData && typeof row.photo_mime === 'string' && row.photo_mime.trim()
        ? row.photo_mime.trim()
        : null;
      const lastUpdated = Number(row.last_updated);
      chats[row.chat_id] = {
        chatId: row.chat_id,
        chatTitle: row.chat_title,
        chatType: row.chat_type as any,
        username: row.username,
        photoPath: rawPhotoData
          ? getChatPhotoUrl(row.chat_id, lastUpdated)
          : rawPhotoPath && rawPhotoPath.startsWith('/api/chats/')
            ? rawPhotoPath
            : null,
        photoData: rawPhotoData,
        photoMime: rawPhotoMime,
        lastUpdated,
        topics: {}
      };
    }
    
    for (const row of topicsRes.rows) {
      if (chats[row.chat_id]) {
        chats[row.chat_id].topics[row.thread_id] = {
          threadId: row.thread_id,
          topicName: row.topic_name,
          topicIcon: row.topic_icon,
          lastUpdated: Number(row.last_updated)
        };
      }
    }
    
    return { chats };
  } catch (error) {
    console.error('Error loading database from PostgreSQL:', error);
    return { chats: {} };
  }
}

/**
 * Saves the database (upserts chats and topics) into PostgreSQL.
 */
export async function saveDatabase(database: Database): Promise<void> {
  const p = getPool();
  const client = await p.connect();
  try {
    await client.query('BEGIN');
    
    for (const chat of Object.values(database.chats)) {
      const photoData = chat.photoData && chat.photoData.trim() ? chat.photoData : null;
      const photoMime = photoData ? (chat.photoMime?.trim() || 'image/jpeg') : null;
      const photoPath = photoData ? getChatPhotoUrl(chat.chatId, chat.lastUpdated) : null;
      await client.query(`
        INSERT INTO chats (chat_id, chat_title, chat_type, username, photo_path, photo_data, photo_mime, last_updated)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (chat_id) DO UPDATE SET
          chat_title = EXCLUDED.chat_title,
          chat_type = EXCLUDED.chat_type,
          username = EXCLUDED.username,
          photo_path = EXCLUDED.photo_path,
          photo_data = EXCLUDED.photo_data,
          photo_mime = EXCLUDED.photo_mime,
          last_updated = EXCLUDED.last_updated
      `, [chat.chatId, chat.chatTitle, chat.chatType, chat.username, photoPath, photoData, photoMime, chat.lastUpdated]);
      
      for (const topic of Object.values(chat.topics)) {
        await client.query(`
          INSERT INTO topics (chat_id, thread_id, topic_name, topic_icon, last_updated)
          VALUES ($1, $2, $3, $4, $5)
          ON CONFLICT (chat_id, thread_id) DO UPDATE SET
            topic_name = EXCLUDED.topic_name,
            topic_icon = EXCLUDED.topic_icon,
            last_updated = EXCLUDED.last_updated
        `, [chat.chatId, topic.threadId, topic.topicName, topic.topicIcon, topic.lastUpdated]);
      }
    }
    
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error saving database to PostgreSQL:', error);
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Global Settings Helpers
// ---------------------------------------------------------------------------

/**
 * Loads the global Telegram Bot Token setting.
 */
export async function loadGlobalBotToken(): Promise<string> {
  const p = getPool();
  try {
    await ensureDatabase();
    const res = await p.query("SELECT value FROM global_settings WHERE key = 'global_bot_token'");
    if (res.rows.length === 0) return '';
    return res.rows[0].value;
  } catch (error) {
    console.error('Error loading global bot token:', error);
    return '';
  }
}

/**
 * Saves the global Telegram Bot Token setting.
 */
export async function saveGlobalBotToken(token: string): Promise<void> {
  const p = getPool();
  try {
    await ensureDatabase();
    await p.query(`
      INSERT INTO global_settings (key, value)
      VALUES ('global_bot_token', $1)
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
    `, [token]);
  } catch (error) {
    console.error('Error saving global bot token:', error);
    throw error;
  }
}

/**
 * Loads a string value from global settings.
 */
export async function loadGlobalSetting(key: string): Promise<string> {
  const p = getPool();
  try {
    await ensureDatabase();
    const res = await p.query('SELECT value FROM global_settings WHERE key = $1', [key]);
    if (res.rows.length === 0) return '';
    return res.rows[0].value ?? '';
  } catch (error) {
    console.error(`Error loading global setting "${key}":`, error);
    return '';
  }
}

/**
 * Saves a string value to global settings.
 */
export async function saveGlobalSetting(key: string, value: string): Promise<void> {
  const p = getPool();
  try {
    await ensureDatabase();
    await p.query(`
      INSERT INTO global_settings (key, value)
      VALUES ($1, $2)
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
    `, [key, value]);
  } catch (error) {
    console.error(`Error saving global setting "${key}":`, error);
    throw error;
  }
}

/**
 * Removes a string value from global settings.
 */
export async function deleteGlobalSetting(key: string): Promise<void> {
  const p = getPool();
  try {
    await ensureDatabase();
    await p.query('DELETE FROM global_settings WHERE key = $1', [key]);
  } catch (error) {
    console.error(`Error deleting global setting "${key}":`, error);
    throw error;
  }
}

export const TELEGRAM_SESSION_SETTING_KEY = 'telegram_session_string';

export async function loadTelegramSessionString(): Promise<string> {
  return loadGlobalSetting(TELEGRAM_SESSION_SETTING_KEY);
}

export async function saveTelegramSessionString(sessionString: string): Promise<void> {
  await saveGlobalSetting(TELEGRAM_SESSION_SETTING_KEY, sessionString);
}

export async function deleteTelegramSessionString(): Promise<void> {
  await deleteGlobalSetting(TELEGRAM_SESSION_SETTING_KEY);
}

// ---------------------------------------------------------------------------
// Automation Setups Helpers
// ---------------------------------------------------------------------------

const DEFAULT_AUTOMATION_SETUP = (id: string): AutomationSetup => ({
  id,
  name: 'Automation mới',
  sortOrder: 0,
  botToken: '',
  sourceGroupId: '',
  sourceThreadIds: [],
  sourceThreadId: null,
  sourceMessageRecognitionConfig: DEFAULT_SOURCE_MESSAGE_RECOGNITION_CONFIG,
  approvalGroupId: '',
  approvalThreadId: null,
  approvalMessageMode: 'forward',
  approvalCustomMessage: DEFAULT_APPROVAL_CUSTOM_MESSAGE,
  approvalActionConfig: {
    hideAfterAction: false,
    refreshOnSourceReply: false,
    deleteSourceMessageOnReply: false,
    agreeButtonLabel: '👍 Đồng ý',
    disagreeButtonLabel: '👎 Không đồng ý',
    agreeResultMessage: '✅ *ĐÃ PHÊ DUYỆT SƠ BỘ* bởi {{userFullName}}',
    disagreeResultMessage: '❌ *BỊ TỪ CHỐI PHÊ DUYỆT* bởi {{userFullName}}',
  },
  approvalTopicConfigs: [],
  supplyGroupId: '',
  supplyThreadId: null,
  supplierSelectionHideAfterAction: false,
  supplyPromptHideAfterAction: false,
  supplyListenGroupId: '',
  supplyListenThreadIds: [],
  supplyListenThreadId: null,
  supplyChangeGroupId: '',
  supplyChangeThreadId: null,
  supplyChangeMessageMode: 'forward',
  supplierRoutes: [],
  deliveryGroupId: '',
  deliveryThreadId: null,
  finalMessageMode: 'forward',
  finalGroupId: '',
  finalThreadId: null,
  rejectGroupId: '',
  rejectThreadId: null,
  rejectCustomMessage: DEFAULT_REJECT_CUSTOM_MESSAGE,
  rejectTopicConfigs: [],
  isListening: false,
  forwardCount: 0,
  lastForwardTime: null,
  destGroupId: '',
});

/**
 * Loads all automation setups.
 */
export async function loadAutomationSetups(): Promise<AutomationSetup[]> {
  const p = getPool();
  try {
    await ensureDatabase();
    const globalToken = await loadGlobalBotToken();
    const res = await p.query('SELECT * FROM automation_setups ORDER BY sort_order ASC, name ASC');
    return res.rows.map((row) => {
      const sourceThreadIds = readStoredThreadIds(row.source_thread_ids, row.source_thread_id);
      return {
        id: row.id,
        name: row.name,
        sortOrder: Number(row.sort_order ?? 0),
        botToken: globalToken,
        sourceGroupId: row.source_group_id || '',
        sourceThreadIds,
        sourceThreadId: sourceThreadIds[0] ?? null,
        sourceMessageRecognitionConfig: normalizeSourceMessageRecognitionConfig(row.source_message_recognition_config),
        approvalGroupId: row.approval_group_id || '',
        approvalThreadId: normalizeThreadId(row.approval_thread_id),
        approvalMessageMode: normalizeApprovalMessageMode(row.approval_message_mode),
        approvalCustomMessage: row.approval_custom_message || DEFAULT_APPROVAL_CUSTOM_MESSAGE,
        approvalActionConfig: normalizeApprovalActionConfig(row.approval_action_config),
        approvalTopicConfigs: normalizeApprovalTopicConfigs(row.approval_topic_configs),
        supplyGroupId: row.supply_group_id || '',
        supplyThreadId: normalizeThreadId(row.supply_thread_id),
        supplierSelectionHideAfterAction: row.supplier_selection_hide_after_action === true,
        supplyPromptHideAfterAction: row.supply_prompt_hide_after_action === true,
        supplyListenGroupId: row.supply_listen_group_id || '',
        supplyListenThreadIds: readStoredThreadIds(row.supply_listen_thread_ids, row.supply_listen_thread_id),
        supplyListenThreadId: normalizeThreadId(row.supply_listen_thread_id),
        supplyChangeGroupId: row.supply_change_group_id || '',
        supplyChangeThreadId: normalizeThreadId(row.supply_change_thread_id),
        supplyChangeMessageMode: row.supply_change_message_mode === 'copy' ? 'copy' : 'forward',
        supplierRoutes: normalizeSupplierRoutes(row.supplier_routes),
        deliveryGroupId: row.delivery_group_id || '',
        deliveryThreadId: normalizeThreadId(row.delivery_thread_id),
        finalMessageMode: row.final_message_mode === 'copy' ? 'copy' : 'forward',
        finalGroupId: row.final_group_id || '',
        finalThreadId: normalizeThreadId(row.final_thread_id),
        rejectGroupId: row.reject_group_id || '',
        rejectThreadId: normalizeThreadId(row.reject_thread_id),
        rejectCustomMessage: row.reject_custom_message || DEFAULT_REJECT_CUSTOM_MESSAGE,
        rejectTopicConfigs: normalizeRejectTopicConfigs(row.reject_topic_configs),
        isListening: row.is_listening,
        forwardCount: row.forward_count,
        lastForwardTime: row.last_forward_time ? Number(row.last_forward_time) : null,
        destGroupId: row.dest_group_id || '',
      };
    });
  } catch (error) {
    console.error('Error loading automation setups from PostgreSQL:', error);
    return [];
  }
}

/**
 * Loads a single automation setup by ID.
 */
export async function loadAutomationSetup(id: string): Promise<AutomationSetup | null> {
  const p = getPool();
  try {
    await ensureDatabase();
    const globalToken = await loadGlobalBotToken();
    const res = await p.query('SELECT * FROM automation_setups WHERE id = $1', [id]);
    if (res.rows.length === 0) return null;
    const row = res.rows[0];
    const sourceThreadIds = readStoredThreadIds(row.source_thread_ids, row.source_thread_id);
    return {
      id: row.id,
      name: row.name,
      sortOrder: Number(row.sort_order ?? 0),
      botToken: globalToken,
      sourceGroupId: row.source_group_id || '',
      sourceThreadIds,
      sourceThreadId: sourceThreadIds[0] ?? null,
      sourceMessageRecognitionConfig: normalizeSourceMessageRecognitionConfig(row.source_message_recognition_config),
      approvalGroupId: row.approval_group_id || '',
      approvalThreadId: normalizeThreadId(row.approval_thread_id),
      approvalMessageMode: normalizeApprovalMessageMode(row.approval_message_mode),
      approvalCustomMessage: row.approval_custom_message || DEFAULT_APPROVAL_CUSTOM_MESSAGE,
      approvalActionConfig: normalizeApprovalActionConfig(row.approval_action_config),
      approvalTopicConfigs: normalizeApprovalTopicConfigs(row.approval_topic_configs),
      supplyGroupId: row.supply_group_id || '',
      supplyThreadId: normalizeThreadId(row.supply_thread_id),
      supplierSelectionHideAfterAction: row.supplier_selection_hide_after_action === true,
      supplyPromptHideAfterAction: row.supply_prompt_hide_after_action === true,
      supplyListenGroupId: row.supply_listen_group_id || '',
      supplyListenThreadIds: readStoredThreadIds(row.supply_listen_thread_ids, row.supply_listen_thread_id),
      supplyListenThreadId: normalizeThreadId(row.supply_listen_thread_id),
      supplyChangeGroupId: row.supply_change_group_id || '',
      supplyChangeThreadId: normalizeThreadId(row.supply_change_thread_id),
      supplyChangeMessageMode: row.supply_change_message_mode === 'copy' ? 'copy' : 'forward',
      supplierRoutes: normalizeSupplierRoutes(row.supplier_routes),
      deliveryGroupId: row.delivery_group_id || '',
      deliveryThreadId: normalizeThreadId(row.delivery_thread_id),
      finalMessageMode: row.final_message_mode === 'copy' ? 'copy' : 'forward',
      finalGroupId: row.final_group_id || '',
      finalThreadId: normalizeThreadId(row.final_thread_id),
      rejectGroupId: row.reject_group_id || '',
      rejectThreadId: normalizeThreadId(row.reject_thread_id),
      rejectCustomMessage: row.reject_custom_message || DEFAULT_REJECT_CUSTOM_MESSAGE,
      rejectTopicConfigs: normalizeRejectTopicConfigs(row.reject_topic_configs),
      isListening: row.is_listening,
      forwardCount: row.forward_count,
      lastForwardTime: row.last_forward_time ? Number(row.last_forward_time) : null,
      destGroupId: row.dest_group_id || '',
    };
  } catch (error) {
    console.error(`Error loading automation setup for ${id}:`, error);
    return null;
  }
}

/**
 * Saves or updates an automation setup.
 */
export async function saveAutomationSetup(setup: Partial<AutomationSetup> & { id: string }): Promise<AutomationSetup> {
  const p = getPool();
  try {
    await ensureDatabase();
    const existing = await loadAutomationSetup(setup.id);
    const current = existing || DEFAULT_AUTOMATION_SETUP(setup.id);
    const hasField = (key: keyof AutomationSetup) =>
      Object.prototype.hasOwnProperty.call(setup, key);
    let sortOrder = hasField('sortOrder')
      ? Number(setup.sortOrder ?? current.sortOrder)
      : current.sortOrder;
    if (!Number.isFinite(sortOrder) || sortOrder < 0) {
      sortOrder = current.sortOrder;
    }
    if (!existing && !hasField('sortOrder')) {
      const maxSortRes = await p.query('SELECT COALESCE(MAX(sort_order), -1) AS max_sort_order FROM automation_setups');
      sortOrder = Number(maxSortRes.rows[0]?.max_sort_order ?? -1) + 1;
    }
    const sourceThreadIds = hasField('sourceThreadIds')
      ? normalizeThreadIds(setup.sourceThreadIds)
      : hasField('sourceThreadId')
        ? normalizeThreadIds(setup.sourceThreadId)
        : current.sourceThreadIds;
    const storedSourceThreadIds = sourceThreadIds.length > 0 ? sourceThreadIds : null;
    const updated = {
      ...current,
      ...setup,
      sortOrder,
      sourceThreadIds,
      sourceThreadId: sourceThreadIds[0] ?? null,
      sourceMessageRecognitionConfig: hasField('sourceMessageRecognitionConfig')
        ? normalizeSourceMessageRecognitionConfig(setup.sourceMessageRecognitionConfig)
        : current.sourceMessageRecognitionConfig,
      approvalMessageMode: hasField('approvalMessageMode')
        ? normalizeApprovalMessageMode(setup.approvalMessageMode)
        : current.approvalMessageMode,
      approvalCustomMessage: hasField('approvalCustomMessage')
        ? (typeof setup.approvalCustomMessage === 'string' ? setup.approvalCustomMessage : String(setup.approvalCustomMessage ?? ''))
        : current.approvalCustomMessage,
      approvalActionConfig: hasField('approvalActionConfig')
        ? normalizeApprovalActionConfig(setup.approvalActionConfig)
        : current.approvalActionConfig,
      approvalTopicConfigs: hasField('approvalTopicConfigs')
        ? normalizeApprovalTopicConfigs(setup.approvalTopicConfigs)
        : current.approvalTopicConfigs,
      supplierRoutes: hasField('supplierRoutes')
        ? normalizeSupplierRoutes(setup.supplierRoutes)
        : current.supplierRoutes,
      supplierSelectionHideAfterAction: hasField('supplierSelectionHideAfterAction')
        ? setup.supplierSelectionHideAfterAction === true
        : current.supplierSelectionHideAfterAction,
      supplyPromptHideAfterAction: hasField('supplyPromptHideAfterAction')
        ? setup.supplyPromptHideAfterAction === true
        : current.supplyPromptHideAfterAction,
      approvalThreadId: hasField('approvalThreadId') ? normalizeThreadId(setup.approvalThreadId) : current.approvalThreadId,
      supplyThreadId: hasField('supplyThreadId') ? normalizeThreadId(setup.supplyThreadId) : current.supplyThreadId,
      supplyListenGroupId: hasField('supplyListenGroupId')
        ? (typeof setup.supplyListenGroupId === 'string' ? setup.supplyListenGroupId : String(setup.supplyListenGroupId ?? ''))
        : current.supplyListenGroupId,
      supplyListenThreadIds: hasField('supplyListenThreadIds')
        ? normalizeThreadIds(setup.supplyListenThreadIds)
        : hasField('supplyListenThreadId')
          ? normalizeThreadIds(setup.supplyListenThreadId)
          : current.supplyListenThreadIds,
      supplyListenThreadId: hasField('supplyListenThreadIds')
        ? (normalizeThreadIds(setup.supplyListenThreadIds)[0] ?? null)
        : hasField('supplyListenThreadId')
          ? normalizeThreadId(setup.supplyListenThreadId)
          : current.supplyListenThreadId,
      supplyChangeGroupId: hasField('supplyChangeGroupId') ? (typeof setup.supplyChangeGroupId === 'string' ? setup.supplyChangeGroupId : String(setup.supplyChangeGroupId ?? '')) : current.supplyChangeGroupId,
      supplyChangeThreadId: hasField('supplyChangeThreadId') ? normalizeThreadId(setup.supplyChangeThreadId) : current.supplyChangeThreadId,
      supplyChangeMessageMode: hasField('supplyChangeMessageMode')
        ? (setup.supplyChangeMessageMode === 'copy' ? 'copy' : 'forward')
        : current.supplyChangeMessageMode,
      deliveryThreadId: hasField('deliveryThreadId') ? normalizeThreadId(setup.deliveryThreadId) : current.deliveryThreadId,
      finalMessageMode: hasField('finalMessageMode')
        ? (setup.finalMessageMode === 'copy' ? 'copy' : 'forward')
        : current.finalMessageMode,
      finalThreadId: hasField('finalThreadId') ? normalizeThreadId(setup.finalThreadId) : current.finalThreadId,
      rejectThreadId: hasField('rejectThreadId') ? normalizeThreadId(setup.rejectThreadId) : current.rejectThreadId,
      rejectCustomMessage: hasField('rejectCustomMessage')
        ? (typeof setup.rejectCustomMessage === 'string' ? setup.rejectCustomMessage : String(setup.rejectCustomMessage ?? ''))
        : current.rejectCustomMessage,
      rejectTopicConfigs: hasField('rejectTopicConfigs')
        ? normalizeRejectTopicConfigs(setup.rejectTopicConfigs)
        : current.rejectTopicConfigs,
    };

    await p.query(`
        INSERT INTO automation_setups (
        id, name, sort_order, source_group_id, source_thread_id, source_thread_ids, source_message_recognition_config,
        approval_group_id, approval_thread_id, approval_message_mode, approval_custom_message, approval_action_config, approval_topic_configs,
        supply_group_id, supply_thread_id, supplier_selection_hide_after_action, supply_prompt_hide_after_action, supply_listen_group_id, supply_listen_thread_ids, supply_listen_thread_id, supply_change_group_id, supply_change_thread_id, supply_change_message_mode, supplier_routes,
        delivery_group_id, delivery_thread_id, final_message_mode,
        final_group_id, final_thread_id,
        reject_group_id, reject_thread_id, reject_custom_message, reject_topic_configs,
        is_listening, forward_count, last_forward_time, dest_group_id
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33, $34, $35, $36, $37)
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        sort_order = EXCLUDED.sort_order,
        source_group_id = EXCLUDED.source_group_id,
        source_thread_id = EXCLUDED.source_thread_id,
        source_thread_ids = EXCLUDED.source_thread_ids,
        source_message_recognition_config = EXCLUDED.source_message_recognition_config,
        approval_group_id = EXCLUDED.approval_group_id,
        approval_thread_id = EXCLUDED.approval_thread_id,
        approval_message_mode = EXCLUDED.approval_message_mode,
        approval_custom_message = EXCLUDED.approval_custom_message,
        approval_action_config = EXCLUDED.approval_action_config,
        approval_topic_configs = EXCLUDED.approval_topic_configs,
        supply_group_id = EXCLUDED.supply_group_id,
        supply_thread_id = EXCLUDED.supply_thread_id,
        supplier_selection_hide_after_action = EXCLUDED.supplier_selection_hide_after_action,
        supply_prompt_hide_after_action = EXCLUDED.supply_prompt_hide_after_action,
        supply_listen_group_id = EXCLUDED.supply_listen_group_id,
        supply_listen_thread_ids = EXCLUDED.supply_listen_thread_ids,
        supply_listen_thread_id = EXCLUDED.supply_listen_thread_id,
        supply_change_group_id = EXCLUDED.supply_change_group_id,
        supply_change_thread_id = EXCLUDED.supply_change_thread_id,
        supply_change_message_mode = EXCLUDED.supply_change_message_mode,
        supplier_routes = EXCLUDED.supplier_routes,
        delivery_group_id = EXCLUDED.delivery_group_id,
        delivery_thread_id = EXCLUDED.delivery_thread_id,
        final_message_mode = EXCLUDED.final_message_mode,
        final_group_id = EXCLUDED.final_group_id,
        final_thread_id = EXCLUDED.final_thread_id,
        reject_group_id = EXCLUDED.reject_group_id,
        reject_thread_id = EXCLUDED.reject_thread_id,
        reject_custom_message = EXCLUDED.reject_custom_message,
        reject_topic_configs = EXCLUDED.reject_topic_configs,
        is_listening = EXCLUDED.is_listening,
        forward_count = EXCLUDED.forward_count,
        last_forward_time = EXCLUDED.last_forward_time,
        dest_group_id = EXCLUDED.dest_group_id
    `, [
      updated.id,
      updated.name,
      updated.sortOrder,
      updated.sourceGroupId,
      updated.sourceThreadId,
      storedSourceThreadIds,
      JSON.stringify(updated.sourceMessageRecognitionConfig),
      updated.approvalGroupId,
      updated.approvalThreadId,
      updated.approvalMessageMode,
      updated.approvalCustomMessage,
      JSON.stringify(updated.approvalActionConfig),
      JSON.stringify(updated.approvalTopicConfigs),
      updated.supplyGroupId,
      updated.supplyThreadId,
      updated.supplierSelectionHideAfterAction,
      updated.supplyPromptHideAfterAction,
      updated.supplyListenGroupId,
      updated.supplyListenThreadIds.length > 0 ? updated.supplyListenThreadIds : null,
      updated.supplyListenThreadId,
      updated.supplyChangeGroupId,
      updated.supplyChangeThreadId,
      updated.supplyChangeMessageMode,
      JSON.stringify(updated.supplierRoutes),
      updated.deliveryGroupId,
      updated.deliveryThreadId,
      updated.finalMessageMode,
      updated.finalGroupId,
      updated.finalThreadId,
      updated.rejectGroupId,
      updated.rejectThreadId,
      updated.rejectCustomMessage,
      JSON.stringify(updated.rejectTopicConfigs),
      updated.isListening,
      updated.forwardCount,
      updated.lastForwardTime,
      updated.destGroupId,
    ]);

    return updated;
  } catch (error) {
    console.error(`Error saving automation setup ${setup.id}:`, error);
    throw error;
  }
}

/**
 * Deletes an automation setup.
 */
export async function deleteAutomationSetup(id: string): Promise<void> {
  const p = getPool();
  try {
    await ensureDatabase();
    await p.query('DELETE FROM automation_setups WHERE id = $1', [id]);
  } catch (error) {
    console.error(`Error deleting automation setup ${id}:`, error);
    throw error;
  }
}

/**
 * Fetches all active automation setups (isListening = true).
 */
export async function getActiveAutomationSetups(): Promise<AutomationSetup[]> {
  const p = getPool();
  try {
    await ensureDatabase();
    const globalToken = await loadGlobalBotToken();
    const res = await p.query('SELECT * FROM automation_setups WHERE is_listening = true');
    return res.rows.map((row) => {
      const sourceThreadIds = readStoredThreadIds(row.source_thread_ids, row.source_thread_id);
      return {
        id: row.id,
        name: row.name,
        sortOrder: Number(row.sort_order ?? 0),
        botToken: globalToken,
        sourceGroupId: row.source_group_id || '',
        sourceThreadIds,
        sourceThreadId: sourceThreadIds[0] ?? null,
        sourceMessageRecognitionConfig: normalizeSourceMessageRecognitionConfig(row.source_message_recognition_config),
        approvalGroupId: row.approval_group_id || '',
        approvalThreadId: normalizeThreadId(row.approval_thread_id),
        approvalMessageMode: normalizeApprovalMessageMode(row.approval_message_mode),
        approvalCustomMessage: row.approval_custom_message || DEFAULT_APPROVAL_CUSTOM_MESSAGE,
        approvalActionConfig: normalizeApprovalActionConfig(row.approval_action_config),
        approvalTopicConfigs: normalizeApprovalTopicConfigs(row.approval_topic_configs),
        supplyGroupId: row.supply_group_id || '',
        supplyThreadId: normalizeThreadId(row.supply_thread_id),
        supplierSelectionHideAfterAction: row.supplier_selection_hide_after_action === true,
        supplyPromptHideAfterAction: row.supply_prompt_hide_after_action === true,
        supplyListenGroupId: row.supply_listen_group_id || '',
        supplyListenThreadIds: readStoredThreadIds(row.supply_listen_thread_ids, row.supply_listen_thread_id),
        supplyListenThreadId: normalizeThreadId(row.supply_listen_thread_id),
        supplyChangeGroupId: row.supply_change_group_id || '',
        supplyChangeThreadId: normalizeThreadId(row.supply_change_thread_id),
        supplyChangeMessageMode: row.supply_change_message_mode === 'copy' ? 'copy' : 'forward',
        supplierRoutes: normalizeSupplierRoutes(row.supplier_routes),
        deliveryGroupId: row.delivery_group_id || '',
        deliveryThreadId: normalizeThreadId(row.delivery_thread_id),
        finalMessageMode: row.final_message_mode === 'copy' ? 'copy' : 'forward',
        finalGroupId: row.final_group_id || '',
        finalThreadId: normalizeThreadId(row.final_thread_id),
        rejectGroupId: row.reject_group_id || '',
        rejectThreadId: normalizeThreadId(row.reject_thread_id),
        rejectCustomMessage: row.reject_custom_message || DEFAULT_REJECT_CUSTOM_MESSAGE,
        rejectTopicConfigs: normalizeRejectTopicConfigs(row.reject_topic_configs),
        isListening: row.is_listening,
        forwardCount: row.forward_count,
        lastForwardTime: row.last_forward_time ? Number(row.last_forward_time) : null,
        destGroupId: row.dest_group_id || '',
      };
    });
  } catch (error) {
    console.error('Error fetching active automation setups:', error);
    return [];
  }
}
