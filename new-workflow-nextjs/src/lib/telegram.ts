import { TelegramClient, Api } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { loadDatabase, saveDatabase } from './database';

const sessionFilePath = path.join(process.cwd(), 'data', 'session.txt');
const photosDir = path.join(process.cwd(), 'public', 'photos');

const apiId = parseInt(process.env.API_ID || '0');
const apiHash = process.env.API_HASH || '';

// -----------------------------------------------------------------------
// Module-level singleton to persist across hot-reloads in Next.js dev mode
// -----------------------------------------------------------------------
declare global {
  // eslint-disable-next-line no-var
  var __telegramClient: TelegramClient | undefined;
  // eslint-disable-next-line no-var
  var __telegramConnected: boolean | undefined;
  // eslint-disable-next-line no-var
  var __telegramInitializing: Promise<TelegramClient> | undefined;
  // eslint-disable-next-line no-var
  var __isSyncing: boolean | undefined;
  // eslint-disable-next-line no-var
  var __sseClients: Set<ReadableStreamDefaultController<Uint8Array>> | undefined;
  // eslint-disable-next-line no-var
  var __authResolvers: {
    phone?: (value: string) => void;
    code?: (value: string) => void;
    password?: (value: string) => void;
  } | undefined;
}

// SSE client set
if (!global.__sseClients) {
  global.__sseClients = new Set();
}

if (global.__authResolvers === undefined) {
  global.__authResolvers = {};
}

export const sseClients = global.__sseClients;

/**
 * Sends a JSON update to all connected SSE clients.
 */
export function sendSseUpdate(data: object): void {
  const payload = `data: ${JSON.stringify(data)}\n\n`;
  const encoded = new TextEncoder().encode(payload);
  for (const controller of sseClients) {
    try {
      controller.enqueue(encoded);
    } catch {
      sseClients.delete(controller);
    }
  }
}

function emitRuntimeLog(
  level: 'info' | 'warn' | 'error' | 'success',
  source: string,
  message: string
): void {
  sendSseUpdate({
    type: 'log',
    level,
    source,
    message,
    ts: Date.now(),
  });
}

/**
 * Returns a promise that resolves when the user supplies the requested value.
 * Used for interactive auth via the /api/auth endpoint.
 */
function waitForAuthInput(field: 'phone' | 'code' | 'password'): Promise<string> {
  return new Promise((resolve) => {
    global.__authResolvers![field] = resolve;
    sendSseUpdate({ type: 'authRequired', field });
  });
}

/**
 * Resolves a pending auth input from the web UI.
 */
export function resolveAuthInput(field: 'phone' | 'code' | 'password', value: string): boolean {
  const resolver = global.__authResolvers?.[field];
  if (resolver) {
    resolver(value);
    delete global.__authResolvers![field];
    return true;
  }
  return false;
}

/**
 * Returns whether a specific auth field is pending resolution.
 */
export function isPendingAuth(field: 'phone' | 'code' | 'password'): boolean {
  return !!global.__authResolvers?.[field];
}

/**
 * Logs out the current Telegram session, clears in-memory state, and removes the saved session file.
 */
export async function logoutTelegramClient(): Promise<void> {
  const client = global.__telegramClient;

  try {
    if (client) {
      try {
        await client.destroy();
      } catch (err: any) {
        console.warn('[Telegram Logout] Client destroy failed:', err?.message || err);
      }
    }
  } finally {
    global.__telegramClient = undefined;
    global.__telegramConnected = false;
    global.__telegramInitializing = undefined;
    global.__isSyncing = false;
    global.__authResolvers = {};

    try {
      const botListener = await import('./bot-listener');
      botListener.stopBotPolling();
    } catch (err: any) {
      console.warn('[Telegram Logout] Failed to stop bot polling:', err?.message || err);
    }

    try {
      (global as any).__activeListeners?.clear?.();
    } catch {
      // ignore
    }

    try {
      await fs.unlink(sessionFilePath);
    } catch (err: any) {
      if (err?.code !== 'ENOENT') {
        console.warn('[Telegram Logout] Failed to remove session file:', err?.message || err);
      }
    }

    sendSseUpdate({ type: 'loggedOut' });
  }
}

/**
 * Initialises and returns the singleton TelegramClient.
 * On first call, starts the client (authenticating if needed).
 */
export async function getTelegramClient(): Promise<TelegramClient> {
  if (global.__telegramClient && global.__telegramConnected) {
    return global.__telegramClient;
  }

  // If already initializing, wait for the same promise (prevents double auth)
  if (global.__telegramInitializing) {
    return global.__telegramInitializing;
  }

  // Create a new initialization promise and store it
  global.__telegramInitializing = _initTelegramClient().finally(() => {
    global.__telegramInitializing = undefined;
  });

  return global.__telegramInitializing;
}

async function _initTelegramClient(): Promise<TelegramClient> {

  if (!apiId || !apiHash) {
    throw new Error('API_ID và API_HASH chưa được cấu hình trong .env.local');
  }

  // Ensure dirs exist
  await fs.mkdir(path.join(process.cwd(), 'data'), { recursive: true });
  await fs.mkdir(photosDir, { recursive: true });

  let savedSession = '';
  if (existsSync(sessionFilePath)) {
    savedSession = await fs.readFile(sessionFilePath, 'utf8');
  }

  const stringSession = new StringSession(savedSession);

  const client = new TelegramClient(stringSession, apiId, apiHash, {
    connectionRetries: 5,
  });

  await client.start({
    phoneNumber: async () => {
      console.log('[Telegram Auth] Yêu cầu số điện thoại...');
      return waitForAuthInput('phone');
    },
    password: async () => {
      console.log('[Telegram Auth] Yêu cầu mật khẩu 2FA...');
      return waitForAuthInput('password');
    },
    phoneCode: async () => {
      console.log('[Telegram Auth] Yêu cầu mã OTP...');
      return waitForAuthInput('code');
    },
    onError: (error) => {
      console.error('[Telegram Auth] Lỗi:', error);
      sendSseUpdate({ type: 'authError', message: error.message });
    },
  });

  // Save session
  const sessionString = client.session.save() as unknown as string;
  await fs.writeFile(sessionFilePath, sessionString, 'utf8');

  global.__telegramClient = client;
  global.__telegramConnected = true;

  console.log('[Telegram] Đã kết nối thành công!');
  sendSseUpdate({ type: 'connected' });

  // Auto start/resume bot polling if configured in database
  import('./bot-listener')
    .then(({ autoStartFromConfig }) => {
      autoStartFromConfig();
    })
    .catch((err) => {
      console.error('[Telegram] Lỗi khi import bot-listener để autoStart:', err);
    });

  return client;
}

/**
 * Core sync function: pulls all dialogs/topics and updates the JSON database.
 */
export async function syncTelegramData(): Promise<{ success: boolean; message?: string; error?: string }> {
  if (global.__isSyncing) {
    return { success: false, message: 'Tiến trình đồng bộ đang chạy...' };
  }

  global.__isSyncing = true;
  sendSseUpdate({ type: 'syncStart' });
  emitRuntimeLog('info', 'sync', 'Bắt đầu đồng bộ dữ liệu Telegram.');
  console.log('[Sync] Bắt đầu đồng bộ hóa...');

  try {
    const client = await getTelegramClient();
    const db = await loadDatabase();

    const dialogs = await client.getDialogs({});
    console.log(`[Sync] Tìm thấy ${dialogs.length} cuộc hội thoại.`);
    emitRuntimeLog('info', 'sync', `Tìm thấy ${dialogs.length} cuộc hội thoại.`);

    for (const dialog of dialogs) {
      const entity = dialog.entity as any;
      const isGroup = dialog.isGroup;
      const isChannel = dialog.isChannel;

      if (!isGroup && !isChannel) continue;

      const chatId = entity.id?.toString();
      if (!chatId) continue;

      let chatType: 'group' | 'channel' | 'supergroup' = 'group';
      if (isChannel) chatType = 'channel';
      if (entity.className === 'Channel' && !entity.broadcast) chatType = 'supergroup';

      if (!db.chats[chatId]) {
        db.chats[chatId] = {
          chatId,
          chatTitle: entity.title || 'Không rõ tên',
          chatType,
          username: entity.username || null,
          photoPath: null,
          lastUpdated: Date.now(),
          topics: {},
        };
      } else {
        db.chats[chatId].chatTitle = entity.title || db.chats[chatId].chatTitle;
        db.chats[chatId].chatType = chatType;
        db.chats[chatId].username = entity.username || db.chats[chatId].username;
        db.chats[chatId].lastUpdated = Date.now();
      }

      const chatEntry = db.chats[chatId];

      // Download profile photo if not cached
      if (!chatEntry.photoPath && entity.photo) {
        try {
          const buffer = await client.downloadProfilePhoto(entity) as Buffer | null;
          if (buffer && buffer.length > 0) {
            const localFileName = `${chatId}.jpg`;
            const localFilePath = path.join(photosDir, localFileName);
            await fs.writeFile(localFilePath, buffer);
            chatEntry.photoPath = `/photos/${localFileName}`;
            console.log(`[Sync] Đã tải ảnh đại diện: ${chatEntry.chatTitle}`);
          }
        } catch (photoError: any) {
          console.error(`[Sync] Không thể tải ảnh ${chatEntry.chatTitle}:`, photoError.message);
        }
      }

      // Fetch forum topics for supergroups
      if (chatType === 'supergroup' && entity.forum) {
        try {
          const result = await client.invoke(
            new Api.channels.GetForumTopics({
              channel: entity,
              limit: 100,
            })
          ) as any;

          if (result?.topics) {
            for (const topic of result.topics) {
              const threadId = topic.id;
              const topicName = topic.title || `Chủ đề #${threadId}`;
              let topicIcon = '💬';
              if (topic.iconEmojiId && topic.iconEmojiId.toString() !== '0') {
                topicIcon = '📌';
              }

              chatEntry.topics[threadId] = {
                threadId,
                topicName,
                topicIcon,
                lastUpdated: topic.date ? topic.date * 1000 : Date.now(),
              };
            }
          }
        } catch (topicError: any) {
          console.error(`[Sync] Lỗi topic ${chatEntry.chatTitle}:`, topicError.message);
        }
      }
    }

    await saveDatabase(db);
    console.log('[Sync] Hoàn tất, đã lưu database.');
    sendSseUpdate({ type: 'syncComplete' });
    emitRuntimeLog('success', 'sync', 'Đồng bộ dữ liệu hoàn tất.');
    return { success: true };
  } catch (error: any) {
    console.error('[Sync] Lỗi:', error);
    sendSseUpdate({ type: 'syncError', error: error.message });
    emitRuntimeLog('error', 'sync', `Đồng bộ lỗi: ${error.message}`);
    return { success: false, error: error.message };
  } finally {
    global.__isSyncing = false;
  }
}

export function isSyncing(): boolean {
  return !!global.__isSyncing;
}
