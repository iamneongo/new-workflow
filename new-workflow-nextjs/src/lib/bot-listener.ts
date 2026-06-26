/**
 * bot-listener.ts
 *
 * Manages a GramJS NewMessage event handler that:
 *  1. Listens to all new messages in selected source groups/topics.
 *  2. Initiates a multi-step interactive workflow using inline buttons:
 *     - Step 2: Approval Group/Topic (2 buttons: Agree / Disagree)
 *     - Step 3: Supply Option Group/Topic (3 buttons: Agree Supply / Disagree Supply / Change Request)
 *     - Step 4: Delivery Group/Topic (Awaits reply)
 *     - Step 5: Final Acceptance Group/Topic (Notifies completion)
 *     - Reject Branch: Sends reject notifications to configured group/topic.
 *
 * All state is kept in Node.js `global` so it survives Next.js hot-reloads.
 */

import { NewMessage, NewMessageEvent } from 'telegram/events/index.js';
import { Api } from 'telegram';
import FormData from 'form-data';
import { getTelegramClient, sendSseUpdate } from './telegram';
import { 
  loadAutomationSetup, 
  saveAutomationSetup, 
  getActiveAutomationSetups, 
  loadGlobalBotToken, 
  getPool,
  normalizeThreadId,
  AutomationSetup 
} from './database';

// ---------------------------------------------------------------------------
// Global state types
// ---------------------------------------------------------------------------
export interface ActiveListener {
  automationId: string;
  botToken: string;
  sourceGroupId: string;
  sourceThreadIds: number[];
  sourceThreadId: number | null;
  normalizedSourceId: string;
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
  forwardCount: number;
  lastForwardTime: number | null;
}

declare global {
  // eslint-disable-next-line no-var
  var __activeListeners: Map<string, ActiveListener> | undefined;
  // eslint-disable-next-line no-var
  var __globalListenerHandler: ((event: NewMessageEvent) => Promise<void>) | undefined;
  // eslint-disable-next-line no-var
  var __globalListenerClient: any | undefined;
  // eslint-disable-next-line no-var
  var __globalBotToken: string | undefined;
  // eslint-disable-next-line no-var
  var __botPollingInterval: NodeJS.Timeout | null | undefined;
  // eslint-disable-next-line no-var
  var __botPollingActive: boolean | undefined;
  // eslint-disable-next-line no-var
  var __botPollingOffset: number | undefined;
}

// Initialize active listeners Map if not present
if (!global.__activeListeners) {
  global.__activeListeners = new Map();
}

// ---------------------------------------------------------------------------
// Public helpers
// ---------------------------------------------------------------------------
export function isListenerActiveForAutomation(automationId: string): boolean {
  return global.__activeListeners?.has(automationId) ?? false;
}

export function getListenerStatsForAutomation(automationId: string) {
  const active = global.__activeListeners?.get(automationId);
  if (active) {
    return { count: active.forwardCount, lastTime: active.lastForwardTime };
  }
  return { count: 0, lastTime: null };
}

// ---------------------------------------------------------------------------
// Test Bot Token via Telegram Bot API getMe
// ---------------------------------------------------------------------------
export async function testBotToken(token: string): Promise<{ ok: boolean; username?: string; error?: string }> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/getMe`);
    const data = await res.json() as any;
    if (data.ok) {
      return { ok: true, username: data.result.username };
    }
    return { ok: false, error: data.description || 'Token không hợp lệ' };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}

// ---------------------------------------------------------------------------
// Auto-start listeners from persisted DB configs (called on startup)
// ---------------------------------------------------------------------------
export async function autoStartFromConfig(): Promise<void> {
  try {
    // Cache the global bot token
    const globalToken = await loadGlobalBotToken();
    global.__globalBotToken = globalToken;

    const setups = await getActiveAutomationSetups();
    console.log(`[BotListener] Found ${setups.length} active automations to auto-start.`);
    
    global.__activeListeners!.clear();
    
    for (const setup of setups) {
      if (
        globalToken && 
        setup.sourceGroupId
      ) {
        const normalized = setup.sourceGroupId.replace(/^-100/, '').replace(/^-/, '');
        global.__activeListeners!.set(setup.id, {
          automationId: setup.id,
          botToken: globalToken,
          sourceGroupId: setup.sourceGroupId,
          sourceThreadIds: setup.sourceThreadIds,
          sourceThreadId: setup.sourceThreadId,
          normalizedSourceId: normalized,
          approvalGroupId: setup.approvalGroupId,
          approvalThreadId: setup.approvalThreadId,
          supplyGroupId: setup.supplyGroupId,
          supplyThreadId: setup.supplyThreadId,
          deliveryGroupId: setup.deliveryGroupId,
          deliveryThreadId: setup.deliveryThreadId,
          finalGroupId: setup.finalGroupId,
          finalThreadId: setup.finalThreadId,
          rejectGroupId: setup.rejectGroupId,
          rejectThreadId: setup.rejectThreadId,
          forwardCount: setup.forwardCount,
          lastForwardTime: setup.lastForwardTime,
        });
        console.log(`[BotListener] Registered auto-start for: ${setup.name} (ID: ${setup.id})`);
      }
    }

    if (global.__activeListeners!.size > 0) {
      await ensureGlobalHandlerRegistered();
      startBotPolling();
    }
  } catch (err: any) {
    console.error('[BotListener] Auto-start failed:', err.message);
  }
}

// ---------------------------------------------------------------------------
// Telegram Bot Long Polling loop for button callbacks and replies
// ---------------------------------------------------------------------------
async function deleteBotWebhook(token: string): Promise<void> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/deleteWebhook?drop_pending_updates=true`);
    const data = await res.json() as any;
    console.log('[BotListener] Deleted active webhooks for Bot:', data);
  } catch (err: any) {
    console.error('[BotListener] Failed to delete active webhook:', err.message);
  }
}

export function startBotPolling() {
  if (global.__botPollingActive) return;
  global.__botPollingActive = true;
  if (global.__botPollingOffset === undefined) {
    global.__botPollingOffset = 0;
  }
  console.log('[BotListener] Starting Telegram Bot polling loop...');
  
  // Clean up any active webhook first to enable getUpdates polling without conflict
  loadGlobalBotToken().then((token) => {
    const activeToken = global.__globalBotToken || token;
    if (activeToken) {
      deleteBotWebhook(activeToken).then(() => {
        pollUpdates();
      });
    } else {
      pollUpdates();
    }
  });
}

export function stopBotPolling() {
  global.__botPollingActive = false;
  if (global.__botPollingInterval) {
    clearTimeout(global.__botPollingInterval);
    global.__botPollingInterval = null;
  }
  console.log('[BotListener] Stopped Telegram Bot polling loop.');
}

async function pollUpdates() {
  if (!global.__botPollingActive) return;
  const token = global.__globalBotToken || await loadGlobalBotToken();
  if (!token) {
    global.__botPollingInterval = setTimeout(pollUpdates, 5000);
    return;
  }

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/getUpdates?offset=${global.__botPollingOffset || 0}&timeout=10`);
    const data = await res.json() as any;
    if (data.ok && data.result.length > 0) {
      for (const update of data.result) {
        global.__botPollingOffset = update.update_id + 1;
        await handleBotUpdate(update);
      }
    }
  } catch (err: any) {
    console.error('[BotListener] Error in Bot polling:', err.message);
  }

  if (global.__botPollingActive) {
    global.__botPollingInterval = setTimeout(pollUpdates, 1000);
  }
}

async function handleBotUpdate(update: any) {
  try {
    const p = getPool();
    const token = global.__globalBotToken || await loadGlobalBotToken();
    const baseUrl = `https://api.telegram.org/bot${token}`;

    // 1. Callback query handler
    if (update.callback_query) {
      const cq = update.callback_query;
      const data = cq.data || '';
      const callbackQueryId = cq.id;
      const userFullName = [cq.from.first_name, cq.from.last_name].filter(Boolean).join(' ') || cq.from.username || 'Thành viên';

      // Answer immediately
      await fetch(`${baseUrl}/answerCallbackQuery`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callback_query_id: callbackQueryId }),
      });

      const parts = data.split(':');
      if (parts.length < 2) return;
      const action = parts[0];
      const logId = Number(parts[1]);

      const logRes = await p.query('SELECT * FROM workflow_logs WHERE id = $1', [logId]);
      if (logRes.rows.length === 0) return;
      const log = logRes.rows[0];

      const autoSetup = await loadAutomationSetup(log.automation_id);
      if (!autoSetup) return;

      const originalCleanText = cq.message.text || '';

      if (action === 'appr_agree') {
        if (log.status !== 'pending') return;

        await p.query("UPDATE workflow_logs SET status = 'approved' WHERE id = $1", [logId]);

        await fetch(`${baseUrl}/editMessageText`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: cq.message.chat.id,
            message_id: cq.message.message_id,
            text: `${originalCleanText}\n\n✅ *ĐÃ PHÊ DUYỆT SƠ BỘ* bởi ${userFullName}`,
          }),
        });

        // Send to Step 3 (Supply Group)
        if (!autoSetup.supplyGroupId) {
          console.warn(`[BotListener] Supply group is not configured for automation: ${log.automation_id}. Cannot send supply prompt.`);
          return;
        }
        const supplyText = `💬 *YÊU CẦU CUNG CẤP VẬT TƯ*\n\nNội dung: ${log.original_text || '[Media]'}\n\nVui lòng lựa chọn phương án:`;
        const supplyData = await sendTelegramMessageWithFallback(baseUrl, {
          chat_id: autoSetup.supplyGroupId,
          message_thread_id: autoSetup.supplyThreadId || undefined,
          text: supplyText,
          reply_markup: {
            inline_keyboard: [
              [
                { text: '✅ Đồng ý cấp vật tư', callback_data: `supply_agree:${logId}` },
              ],
              [
                { text: '❌ Không đồng ý cấp vật tư', callback_data: `supply_reject:${logId}` },
                { text: '🔄 Yêu cầu thay đổi vật tư', callback_data: `supply_change:${logId}` },
              ]
            ]
          }
        }, 'supply prompt');
        if (supplyData.ok) {
          await p.query("UPDATE workflow_logs SET supply_msg_id = $1, status = 'supply_sent' WHERE id = $2", [supplyData.result.message_id, logId]);
        }

      } else if (action === 'appr_disagree') {
        if (log.status !== 'pending') return;

        await p.query("UPDATE workflow_logs SET status = 'rejected' WHERE id = $1", [logId]);

        await fetch(`${baseUrl}/editMessageText`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: cq.message.chat.id,
            message_id: cq.message.message_id,
            text: `${originalCleanText}\n\n❌ *BỊ TỪ CHỐI PHÊ DUYỆT* bởi ${userFullName}`,
          }),
        });

        // Send reject notification
        if (!autoSetup.rejectGroupId) {
          console.warn(`[BotListener] Reject group is not configured for automation: ${log.automation_id}. Cannot send reject notification.`);
          return;
        }
        const rejectText = `❌ *THÔNG BÁO TỪ CHỐI PHÊ DUYỆT*\n\nYêu cầu vật tư đã bị từ chối phê duyệt bởi ${userFullName}.\nNội dung: ${log.original_text || '[Media]'}`;
        await sendTelegramMessageWithFallback(baseUrl, {
          chat_id: autoSetup.rejectGroupId,
          message_thread_id: autoSetup.rejectThreadId || undefined,
          text: rejectText,
        }, 'reject notice');

      } else if (action === 'supply_agree') {
        if (log.status !== 'supply_sent') return;

        await p.query("UPDATE workflow_logs SET status = 'supply_agreed' WHERE id = $1", [logId]);

        await fetch(`${baseUrl}/editMessageText`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: cq.message.chat.id,
            message_id: cq.message.message_id,
            text: `${originalCleanText}\n\n✅ *ĐỒNG Ý CẤP VẬT TƯ* bởi ${userFullName}`,
          }),
        });

        // Send message to delivery group
        if (!autoSetup.deliveryGroupId) {
          console.warn(`[BotListener] Delivery group is not configured for automation: ${log.automation_id}. Cannot send delivery notification.`);
          return;
        }
        const deliveryText = `📦 *THÔNG BÁO GIAO NHẬN VẬT TƯ*\n\nVật tư đang được vận chuyển đến công trình.\n👉 *YÊU CẦU:* Khi nhận được vật tư, vui lòng *REPLY* trực tiếp vào tin nhắn này để nghiệm thu.`;
        const deliveryData = await sendTelegramMessageWithFallback(baseUrl, {
          chat_id: autoSetup.deliveryGroupId,
          message_thread_id: autoSetup.deliveryThreadId || undefined,
          text: deliveryText,
        }, 'delivery notice');
        if (deliveryData.ok) {
          await p.query("UPDATE workflow_logs SET delivery_msg_id = $1 WHERE id = $2", [deliveryData.result.message_id, logId]);
        }

      } else if (action === 'supply_reject' || action === 'supply_change') {
        if (log.status !== 'supply_sent') return;

        const isChange = action === 'supply_change';
        const newStatus = isChange ? 'supply_changed' : 'supply_rejected';

        await p.query("UPDATE workflow_logs SET status = $1 WHERE id = $2", [newStatus, logId]);

        const statusLabel = isChange ? '🔄 YÊU CẦU THAY ĐỔI VẬT TƯ' : '❌ TỪ CHỐI CUNG CẤP VẬT TƯ';
        await fetch(`${baseUrl}/editMessageText`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: cq.message.chat.id,
            message_id: cq.message.message_id,
            text: `${originalCleanText}\n\n${statusLabel} bởi ${userFullName}`,
          }),
        });

        // Send reject notification
        if (!autoSetup.rejectGroupId) {
          console.warn(`[BotListener] Reject group is not configured for automation: ${log.automation_id}. Cannot send reject/change notification.`);
          return;
        }
        const rejectText = `${isChange ? '🔄' : '❌'} *THÔNG BÁO TỪ CHỐI/YÊU CẦU THAY ĐỔI VẬT TƯ*\n\nPhương án: ${isChange ? 'Yêu cầu thay đổi vật tư' : 'Từ chối cung cấp vật tư'} bởi ${userFullName}\nNội dung ban đầu: ${log.original_text || '[Media]'}`;
        await sendTelegramMessageWithFallback(baseUrl, {
          chat_id: autoSetup.rejectGroupId,
          message_thread_id: autoSetup.rejectThreadId || undefined,
          text: rejectText,
        }, 'reject/change notice');
      }
    }

    // 2. Reply to delivery message handler
    if (update.message && update.message.reply_to_message) {
      const msg = update.message;
      const replyToMsgId = msg.reply_to_message.message_id;
      const chatId = msg.chat.id.toString();

      // Find log waiting for delivery reply
      const logRes = await p.query(
        "SELECT * FROM workflow_logs WHERE delivery_msg_id = $1 AND status = 'supply_agreed'",
        [replyToMsgId]
      );
      if (logRes.rows.length > 0) {
        for (const log of logRes.rows) {
          const autoSetup = await loadAutomationSetup(log.automation_id);
          if (!autoSetup) continue;

          // Verify chat ID
          const normLogGroup = autoSetup.deliveryGroupId.replace(/^-100/, '');
          const normChatId = chatId.replace(/^-100/, '');
          if (normLogGroup !== normChatId) continue;

          await p.query("UPDATE workflow_logs SET status = 'completed' WHERE id = $1", [log.id]);

          const senderFullName = [msg.from?.first_name, msg.from?.last_name].filter(Boolean).join(' ') || msg.from?.username || 'Thành viên';
          const replyText = msg.text || '';

          const finalMessage = `✅ *NGHIỆM THU VẬT TƯ HOÀN TẤT*\n\nYêu cầu: "${log.original_text || '[Media]'}"\n\nĐã được nghiệm thu thành công bởi *${senderFullName}*\nPhản hồi: "${replyText}"`;
          if (!autoSetup.finalGroupId) {
            console.warn(`[BotListener] Final group is not configured for automation: ${log.automation_id}. Cannot send acceptance completion notification.`);
            continue;
          }
          await sendTelegramMessageWithFallback(baseUrl, {
            chat_id: autoSetup.finalGroupId,
            message_thread_id: autoSetup.finalThreadId || undefined,
            text: finalMessage,
          }, 'final notice');
          console.log(`[BotListener] Workflow log ${log.id} successfully completed & notified!`);
        }
      }
    }
  } catch (err: any) {
    console.error('[BotListener] Error handling bot update:', err.message);
  }
}

// ---------------------------------------------------------------------------
// Ensure single global message event listener handler is registered
// ---------------------------------------------------------------------------
async function ensureGlobalHandlerRegistered(): Promise<void> {
  const client = await getTelegramClient();

  if (global.__globalListenerHandler && global.__globalListenerClient === client) {
    return; // Already registered on the current client
  }

  // Remove from old client if exists
  if (global.__globalListenerHandler && global.__globalListenerClient) {
    try {
      global.__globalListenerClient.removeEventHandler(global.__globalListenerHandler);
      console.log('[BotListener] Removed global NewMessage handler from old Telegram client.');
    } catch (e: any) {
      console.warn('[BotListener] Warning: Failed to remove event handler from old client:', e.message);
    }
  }

  const handler = async (event: NewMessageEvent) => {
    try {
      const msg = event.message;
      if (!msg) return;

      const rawChatId = msg.chatId?.toString() ?? '';
      const chatId = rawChatId.replace(/^-100/, '').replace(/^-/, '');

      console.log(`[BotListener] Global Handler received message: "${msg.text}" from chat ID: ${rawChatId} (normalized: ${chatId})`);
      
      // Iterate through all active listeners to check if sourceGroupId matches
      for (const listener of global.__activeListeners!.values()) {
        if (listener.normalizedSourceId === chatId) {
          
          // Check if specific topic thread matches (if topic filtering is configured)
          const msgReplyTo = msg.replyTo as any;
          const msgThreadId = normalizeThreadId(
            msgReplyTo?.replyToTopId ?? msgReplyTo?.replyToMsgId
          );
          const configuredThreadIds = listener.sourceThreadIds.length > 0
            ? listener.sourceThreadIds
            : listener.sourceThreadId !== null
              ? [listener.sourceThreadId]
              : [];
          if (configuredThreadIds.length > 0 && (msgThreadId === null || !configuredThreadIds.includes(msgThreadId))) {
            continue; // Thread doesn't match, skip.
          }

          console.log(`[BotListener] Received trigger msg from chat ${chatId} (Thread: ${msgThreadId})`);

          console.log(`[BotListener] Trigger stage: resolving bot token for ${listener.automationId}`);
          const botToken = global.__globalBotToken || await loadGlobalBotToken();
          if (!botToken) {
            console.warn(`[BotListener] Global bot token is missing. Skipping forward for ${listener.automationId}.`);
            continue;
          }
          console.log(`[BotListener] Trigger stage: bot token ready for ${listener.automationId}`);

          const originalText = msg.text || '';
          const p = getPool();
          
          // Insert into workflow logs
          console.log(`[BotListener] Trigger stage: writing workflow log for ${listener.automationId}`);
          const logRes = await p.query(
            `INSERT INTO workflow_logs (automation_id, original_chat_id, original_msg_id, original_text, status)
             VALUES ($1, $2, $3, $4, 'pending') RETURNING id`,
            [listener.automationId, listener.sourceGroupId, msg.id, originalText]
          );
          const logId = logRes.rows[0].id;
          console.log(`[BotListener] Trigger stage: workflow log created id=${logId} for ${listener.automationId}`);

          let senderName = 'Unknown';
          try {
            const sender = await msg.getSender() as any;
            if (sender) {
              senderName = [sender.firstName, sender.lastName].filter(Boolean).join(' ') || sender.username || sender.title || 'Unknown';
            }
          } catch {}

          if (!listener.approvalGroupId) {
            console.warn(`[BotListener] Approval group is not configured for automation: ${listener.automationId}. Skipping message forward.`);
            
            // Still update stats so the user sees the trigger works
            listener.forwardCount += 1;
            listener.lastForwardTime = Date.now();
            await saveAutomationSetup({
              id: listener.automationId,
              forwardCount: listener.forwardCount,
              lastForwardTime: listener.lastForwardTime,
            });
            sendSseUpdate({
              type: 'messageForwarded',
              automationId: listener.automationId,
              count: listener.forwardCount,
              lastTime: listener.lastForwardTime,
              preview: originalText.substring(0, 60) || '[Media]',
            });
            continue;
          }

          const baseUrl = `https://api.telegram.org/bot${botToken}`;
          const approvalText = `📡 *YÊU CẦU PHÊ DUYỆT VẬT TƯ MỚI*\n\n👤 Người gửi: *${senderName}*\n\nNội dung:\n${originalText || '[Hình ảnh/Tài liệu]'}`;

          // Send message to approvalGroupId
          console.log(`[BotListener] Trigger stage: sending approval prompt for log ${logId}`);
          const apprData = await sendTelegramMessageWithFallback(baseUrl, {
            chat_id: listener.approvalGroupId,
            message_thread_id: listener.approvalThreadId || undefined,
            text: approvalText,
            reply_markup: {
              inline_keyboard: [
                [
                  { text: '👍 Đồng ý', callback_data: `appr_agree:${logId}` },
                  { text: '👎 Không đồng ý', callback_data: `appr_disagree:${logId}` }
                ]
              ]
            }
          }, 'approval prompt');
          console.log(`[BotListener] Trigger stage: approval response ok=${apprData.ok} for log ${logId}`);
          if (apprData.ok) {
            await p.query("UPDATE workflow_logs SET approval_msg_id = $1 WHERE id = $2", [apprData.result.message_id, logId]);
          }

          // Forward media if present
          const hasPhoto = !!(msg as any).photo;
          const hasVideo = !!(msg as any).video;
          const hasDocument = !!(msg as any).document;
          if (hasPhoto || hasVideo || hasDocument) {
            await trySendApprovalMedia(baseUrl, listener.approvalGroupId, listener.approvalThreadId, msg);
          }

          // Update local stats
          listener.forwardCount += 1;
          listener.lastForwardTime = Date.now();

          // Persist stats to database
          await saveAutomationSetup({
            id: listener.automationId,
            forwardCount: listener.forwardCount,
            lastForwardTime: listener.lastForwardTime,
          });

          // Notify dashboard via SSE
          sendSseUpdate({
            type: 'messageForwarded',
            automationId: listener.automationId,
            count: listener.forwardCount,
            lastTime: listener.lastForwardTime,
            preview: originalText.substring(0, 60) || '[Media]',
          });
        }
      }
    } catch (err: any) {
      console.error('[BotListener] Error in global message handler:', err.message);
      sendSseUpdate({ type: 'forwardError', error: err.message });
    }
  };

  client.addEventHandler(handler, new NewMessage({}));
  global.__globalListenerHandler = handler;
  global.__globalListenerClient = client;
  console.log('[BotListener] Registered global NewMessage handler on Telegram client.');
}

// ---------------------------------------------------------------------------
// Start Listener for an automation setup
// ---------------------------------------------------------------------------
export async function startListenerForAutomation(automationId: string): Promise<void> {
  const setup = await loadAutomationSetup(automationId);
  if (!setup) throw new Error('Không tìm thấy cấu hình Automation.');

  const botToken = global.__globalBotToken || await loadGlobalBotToken();
  global.__globalBotToken = botToken;

  if (!botToken) {
    throw new Error('Chưa cấu hình Bot Token toàn cục. Vui lòng cấu hình ở Bước 2.');
  }
  if (!setup.sourceGroupId) {
    throw new Error('Chưa chọn nhóm nguồn (Trigger) cho Automation này.');
  }

  const normalized = setup.sourceGroupId.replace(/^-100/, '').replace(/^-/, '');

  // Persist "isListening = true" to DB
  await saveAutomationSetup({
    id: automationId,
    isListening: true,
  });

  // Add to active map
  global.__activeListeners!.set(automationId, {
    automationId,
    botToken,
    sourceGroupId: setup.sourceGroupId,
    sourceThreadIds: setup.sourceThreadIds,
    sourceThreadId: setup.sourceThreadId,
    normalizedSourceId: normalized,
    approvalGroupId: setup.approvalGroupId,
    approvalThreadId: setup.approvalThreadId,
    supplyGroupId: setup.supplyGroupId,
    supplyThreadId: setup.supplyThreadId,
    deliveryGroupId: setup.deliveryGroupId,
    deliveryThreadId: setup.deliveryThreadId,
    finalGroupId: setup.finalGroupId,
    finalThreadId: setup.finalThreadId,
    rejectGroupId: setup.rejectGroupId,
    rejectThreadId: setup.rejectThreadId,
    forwardCount: setup.forwardCount,
    lastForwardTime: setup.lastForwardTime,
  });

  // Ensure global handler is active
  await ensureGlobalHandlerRegistered();

  // Start polling
  startBotPolling();

  console.log(`[BotListener] Started listener for automation ID: ${automationId}`);
  sendSseUpdate({
    type: 'listenerStarted',
    automationId,
    config: {
      botToken,
      sourceGroupId: setup.sourceGroupId,
    },
  });
}

// ---------------------------------------------------------------------------
// Stop Listener for an automation setup
// ---------------------------------------------------------------------------
export async function stopListenerForAutomation(automationId: string): Promise<void> {
  // Persist "isListening = false" in DB
  await saveAutomationSetup({
    id: automationId,
    isListening: false,
  });

  // Remove from active map
  global.__activeListeners!.delete(automationId);

  // If no listeners left, we can stop bot polling
  if (global.__activeListeners!.size === 0) {
    stopBotPolling();
  }

  console.log(`[BotListener] Stopped listener for automation ID: ${automationId}`);
  sendSseUpdate({
    type: 'listenerStopped',
    automationId,
  });
}

// ---------------------------------------------------------------------------
// Try forwarding media to approval group via Bot API upload
// ---------------------------------------------------------------------------
async function trySendApprovalMedia(baseUrl: string, chatId: string, threadId: number | null, msg: any): Promise<void> {
  try {
    const client = await getTelegramClient();
    const buffer = await client.downloadMedia(msg, {}) as Buffer | null;
    if (!buffer || buffer.length === 0) return;

    const hasPhoto = !!msg.photo;
    const hasVideo = !!msg.video;

    const form = new FormData();
    form.append('chat_id', toBotApiChatId(chatId));
    if (threadId) {
      form.append('message_thread_id', threadId.toString());
    }

    const caption = msg.caption || '';
    if (caption) form.append('caption', caption);

    const filename = hasPhoto ? 'photo.jpg' : hasVideo ? 'video.mp4' : 'file';
    const method = hasPhoto ? 'sendPhoto' : hasVideo ? 'sendVideo' : 'sendDocument';
    const fieldName = hasPhoto ? 'photo' : hasVideo ? 'video' : 'document';

    form.append(fieldName, buffer, { filename });

    await fetch(`${baseUrl}/${method}`, {
      method: 'POST',
      body: form as any,
      headers: form.getHeaders() as any,
    });

    console.log(`[BotListener] Forwarded media (${method}) to approval group`);
  } catch (err: any) {
    console.warn('[BotListener] Media approval forward failed (non-fatal):', err.message);
  }
}

function toBotApiChatId(chatId: string): string {
  if (!chatId) return chatId;
  if (chatId.startsWith('-100') || chatId.startsWith('-')) return chatId;
  return `-100${chatId}`;
}

async function sendTelegramJson(
  baseUrl: string,
  method: string,
  payload: Record<string, unknown>
): Promise<{ ok: boolean; result?: any; description?: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    console.log(`[BotListener] Telegram ${method} -> sending...`);
    const normalizedPayload = { ...payload };
    if (normalizedPayload.chat_id !== undefined) {
      normalizedPayload.chat_id = toBotApiChatId(String(normalizedPayload.chat_id));
    }
    const res = await fetch(`${baseUrl}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(normalizedPayload),
      signal: controller.signal,
    });

    const data = await res.json() as any;
    if (!data.ok) {
      console.warn(`[BotListener] Telegram ${method} failed:`, data.description || JSON.stringify(data));
    } else {
      console.log(`[BotListener] Telegram ${method} ok.`);
    }
    return data;
  } catch (error: any) {
    const message = error?.name === 'AbortError' ? 'request timeout after 10s' : (error?.message || String(error));
    console.warn(`[BotListener] Telegram ${method} error: ${message}`);
    return { ok: false, description: message };
  } finally {
    clearTimeout(timeout);
  }
}

async function sendTelegramMessageWithFallback(
  baseUrl: string,
  payload: Record<string, unknown>,
  label: string
): Promise<{ ok: boolean; result?: any; description?: string }> {
  const primary = await sendTelegramJson(baseUrl, 'sendMessage', payload);
  if (primary.ok) return primary;

  const threadId = payload.message_thread_id;
  if (threadId !== undefined) {
    const fallbackPayload = { ...payload };
    delete fallbackPayload.message_thread_id;
    console.warn(`[BotListener] Retrying ${label} without message_thread_id fallback.`);
    return sendTelegramJson(baseUrl, 'sendMessage', fallbackPayload);
  }

  return primary;
}

// ---------------------------------------------------------------------------
// Escape special chars for Telegram MarkdownV2 (unused now since we use default text parsing, but kept for helper logic if needed)
// ---------------------------------------------------------------------------
function escapeMd(text: string): string {
  return text.replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, '\\$&');
}
