import { Pool } from 'pg';

let pool: Pool | null = null;

export function getPool(): Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('DATABASE_URL is not defined in environment variables.');
    }
    pool = new Pool({
      connectionString,
      ssl: {
        rejectUnauthorized: false,
      },
    });
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
  lastUpdated: number;
  topics: Record<string, TopicEntry>;
}

export interface AutomationSetup {
  id: string;
  name: string;
  botToken: string;
  sourceGroupId: string;
  sourceThreadId: number | null;
  approvalGroupId: string;
  approvalThreadId: number | null;
  supplyGroupId: string;
  supplyThreadId: number | null;
  deliveryGroupId: string;
  deliveryThreadId: number | null;
  finalGroupId: string;
  finalThreadId: number | null;
  rejectGroupId: string;
  rejectThreadId: number | null;
  isListening: boolean;
  forwardCount: number;
  lastForwardTime: number | null;
  destGroupId: string; // compatibility
}

export interface Database {
  chats: Record<string, ChatEntry>;
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
        bot_token VARCHAR(255),
        source_group_id VARCHAR(100),
        dest_group_id VARCHAR(100),
        is_listening BOOLEAN DEFAULT FALSE NOT NULL,
        forward_count INTEGER DEFAULT 0 NOT NULL,
        last_forward_time BIGINT
      );
    `);

    // Add new columns to automation_setups if they don't exist
    const alterQueries = [
      'ALTER TABLE automation_setups ADD COLUMN IF NOT EXISTS source_thread_id INTEGER',
      'ALTER TABLE automation_setups ADD COLUMN IF NOT EXISTS approval_group_id VARCHAR(100)',
      'ALTER TABLE automation_setups ADD COLUMN IF NOT EXISTS approval_thread_id INTEGER',
      'ALTER TABLE automation_setups ADD COLUMN IF NOT EXISTS supply_group_id VARCHAR(100)',
      'ALTER TABLE automation_setups ADD COLUMN IF NOT EXISTS supply_thread_id INTEGER',
      'ALTER TABLE automation_setups ADD COLUMN IF NOT EXISTS delivery_group_id VARCHAR(100)',
      'ALTER TABLE automation_setups ADD COLUMN IF NOT EXISTS delivery_thread_id INTEGER',
      'ALTER TABLE automation_setups ADD COLUMN IF NOT EXISTS final_group_id VARCHAR(100)',
      'ALTER TABLE automation_setups ADD COLUMN IF NOT EXISTS final_thread_id INTEGER',
      'ALTER TABLE automation_setups ADD COLUMN IF NOT EXISTS reject_group_id VARCHAR(100)',
      'ALTER TABLE automation_setups ADD COLUMN IF NOT EXISTS reject_thread_id INTEGER'
    ];
    for (const q of alterQueries) {
      await client.query(q);
    }

    // Create workflow_logs table
    await client.query(`
      CREATE TABLE IF NOT EXISTS workflow_logs (
        id SERIAL PRIMARY KEY,
        automation_id VARCHAR(100) NOT NULL,
        original_chat_id VARCHAR(100) NOT NULL,
        original_msg_id INTEGER NOT NULL,
        original_text TEXT,
        original_media_label VARCHAR(100),
        approval_msg_id INTEGER,
        supply_msg_id INTEGER,
        delivery_msg_id INTEGER,
        status VARCHAR(50) DEFAULT 'pending'
      );
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
export async function loadDatabase(): Promise<Database> {
  const p = getPool();
  try {
    await ensureDatabase();
    
    const chatsRes = await p.query('SELECT * FROM chats');
    const topicsRes = await p.query('SELECT * FROM topics');
    
    const chats: Record<string, ChatEntry> = {};
    
    for (const row of chatsRes.rows) {
      chats[row.chat_id] = {
        chatId: row.chat_id,
        chatTitle: row.chat_title,
        chatType: row.chat_type as any,
        username: row.username,
        photoPath: row.photo_path,
        lastUpdated: Number(row.last_updated),
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
      await client.query(`
        INSERT INTO chats (chat_id, chat_title, chat_type, username, photo_path, last_updated)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (chat_id) DO UPDATE SET
          chat_title = EXCLUDED.chat_title,
          chat_type = EXCLUDED.chat_type,
          username = EXCLUDED.username,
          photo_path = EXCLUDED.photo_path,
          last_updated = EXCLUDED.last_updated
      `, [chat.chatId, chat.chatTitle, chat.chatType, chat.username, chat.photoPath, chat.lastUpdated]);
      
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

// ---------------------------------------------------------------------------
// Automation Setups Helpers
// ---------------------------------------------------------------------------

const DEFAULT_AUTOMATION_SETUP = (id: string): AutomationSetup => ({
  id,
  name: 'Automation mới',
  botToken: '',
  sourceGroupId: '',
  sourceThreadId: null,
  approvalGroupId: '',
  approvalThreadId: null,
  supplyGroupId: '',
  supplyThreadId: null,
  deliveryGroupId: '',
  deliveryThreadId: null,
  finalGroupId: '',
  finalThreadId: null,
  rejectGroupId: '',
  rejectThreadId: null,
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
    const res = await p.query('SELECT * FROM automation_setups ORDER BY name ASC');
    return res.rows.map((row) => ({
      id: row.id,
      name: row.name,
      botToken: globalToken,
      sourceGroupId: row.source_group_id || '',
      sourceThreadId: normalizeThreadId(row.source_thread_id),
      approvalGroupId: row.approval_group_id || '',
      approvalThreadId: normalizeThreadId(row.approval_thread_id),
      supplyGroupId: row.supply_group_id || '',
      supplyThreadId: normalizeThreadId(row.supply_thread_id),
      deliveryGroupId: row.delivery_group_id || '',
      deliveryThreadId: normalizeThreadId(row.delivery_thread_id),
      finalGroupId: row.final_group_id || '',
      finalThreadId: normalizeThreadId(row.final_thread_id),
      rejectGroupId: row.reject_group_id || '',
      rejectThreadId: normalizeThreadId(row.reject_thread_id),
      isListening: row.is_listening,
      forwardCount: row.forward_count,
      lastForwardTime: row.last_forward_time ? Number(row.last_forward_time) : null,
      destGroupId: row.dest_group_id || '',
    }));
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
    return {
      id: row.id,
      name: row.name,
      botToken: globalToken,
      sourceGroupId: row.source_group_id || '',
      sourceThreadId: normalizeThreadId(row.source_thread_id),
      approvalGroupId: row.approval_group_id || '',
      approvalThreadId: normalizeThreadId(row.approval_thread_id),
      supplyGroupId: row.supply_group_id || '',
      supplyThreadId: normalizeThreadId(row.supply_thread_id),
      deliveryGroupId: row.delivery_group_id || '',
      deliveryThreadId: normalizeThreadId(row.delivery_thread_id),
      finalGroupId: row.final_group_id || '',
      finalThreadId: normalizeThreadId(row.final_thread_id),
      rejectGroupId: row.reject_group_id || '',
      rejectThreadId: normalizeThreadId(row.reject_thread_id),
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
    const current = await loadAutomationSetup(setup.id) || DEFAULT_AUTOMATION_SETUP(setup.id);
    const hasField = (key: keyof AutomationSetup) =>
      Object.prototype.hasOwnProperty.call(setup, key);
    const updated = {
      ...current,
      ...setup,
      sourceThreadId: hasField('sourceThreadId') ? normalizeThreadId(setup.sourceThreadId) : current.sourceThreadId,
      approvalThreadId: hasField('approvalThreadId') ? normalizeThreadId(setup.approvalThreadId) : current.approvalThreadId,
      supplyThreadId: hasField('supplyThreadId') ? normalizeThreadId(setup.supplyThreadId) : current.supplyThreadId,
      deliveryThreadId: hasField('deliveryThreadId') ? normalizeThreadId(setup.deliveryThreadId) : current.deliveryThreadId,
      finalThreadId: hasField('finalThreadId') ? normalizeThreadId(setup.finalThreadId) : current.finalThreadId,
      rejectThreadId: hasField('rejectThreadId') ? normalizeThreadId(setup.rejectThreadId) : current.rejectThreadId,
    };

    await p.query(`
        INSERT INTO automation_setups (
        id, name, source_group_id, source_thread_id,
        approval_group_id, approval_thread_id,
        supply_group_id, supply_thread_id,
        delivery_group_id, delivery_thread_id,
        final_group_id, final_thread_id,
        reject_group_id, reject_thread_id,
        is_listening, forward_count, last_forward_time, dest_group_id
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        source_group_id = EXCLUDED.source_group_id,
        source_thread_id = EXCLUDED.source_thread_id,
        approval_group_id = EXCLUDED.approval_group_id,
        approval_thread_id = EXCLUDED.approval_thread_id,
        supply_group_id = EXCLUDED.supply_group_id,
        supply_thread_id = EXCLUDED.supply_thread_id,
        delivery_group_id = EXCLUDED.delivery_group_id,
        delivery_thread_id = EXCLUDED.delivery_thread_id,
        final_group_id = EXCLUDED.final_group_id,
        final_thread_id = EXCLUDED.final_thread_id,
        reject_group_id = EXCLUDED.reject_group_id,
        reject_thread_id = EXCLUDED.reject_thread_id,
        is_listening = EXCLUDED.is_listening,
        forward_count = EXCLUDED.forward_count,
        last_forward_time = EXCLUDED.last_forward_time,
        dest_group_id = EXCLUDED.dest_group_id
    `, [
      updated.id,
      updated.name,
      updated.sourceGroupId,
      updated.sourceThreadId,
      updated.approvalGroupId,
      updated.approvalThreadId,
      updated.supplyGroupId,
      updated.supplyThreadId,
      updated.deliveryGroupId,
      updated.deliveryThreadId,
      updated.finalGroupId,
      updated.finalThreadId,
      updated.rejectGroupId,
      updated.rejectThreadId,
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
    return res.rows.map((row) => ({
      id: row.id,
      name: row.name,
      botToken: globalToken,
      sourceGroupId: row.source_group_id || '',
      sourceThreadId: normalizeThreadId(row.source_thread_id),
      approvalGroupId: row.approval_group_id || '',
      approvalThreadId: normalizeThreadId(row.approval_thread_id),
      supplyGroupId: row.supply_group_id || '',
      supplyThreadId: normalizeThreadId(row.supply_thread_id),
      deliveryGroupId: row.delivery_group_id || '',
      deliveryThreadId: normalizeThreadId(row.delivery_thread_id),
      finalGroupId: row.final_group_id || '',
      finalThreadId: normalizeThreadId(row.final_thread_id),
      rejectGroupId: row.reject_group_id || '',
      rejectThreadId: normalizeThreadId(row.reject_thread_id),
      isListening: row.is_listening,
      forwardCount: row.forward_count,
      lastForwardTime: row.last_forward_time ? Number(row.last_forward_time) : null,
      destGroupId: row.dest_group_id || '',
    }));
  } catch (error) {
    console.error('Error fetching active automation setups:', error);
    return [];
  }
}
