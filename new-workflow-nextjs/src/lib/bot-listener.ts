/**
 * bot-listener.ts
 *
 * Telegram Bot API long-polling listener that:
 *  1. Listens to new group/topic messages through getUpdates.
 *  2. Handles inline button callbacks and reply-based workflow steps.
 *  3. Uses GramJS only for login/session sync and Telegram metadata sync.
 *
 * All state is kept in Node.js `global` so it survives Next.js hot-reloads.
 */

import FormData from 'form-data';
import { getTelegramClient, sendSseUpdate } from './telegram';
import {
  loadAutomationSetup,
  saveAutomationSetup,
  getActiveAutomationSetups,
  loadGlobalBotToken,
  loadGlobalSetting,
  loadDatabase,
  getPool,
  normalizeThreadId,
  normalizeThreadIds,
  ApprovalMessageMode,
  FinalMessageMode,
  SupplierRoute,
  SourceMessageRecognitionConfig,
  ApprovalActionConfig,
  ApprovalTopicConfig,
  RejectTopicConfig,
  DEFAULT_APPROVAL_CUSTOM_MESSAGE,
  DEFAULT_APPROVAL_ACTION_CONFIG,
  DEFAULT_REJECT_CUSTOM_MESSAGE,
  DEFAULT_SOURCE_MESSAGE_RECOGNITION_CONFIG,
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
  sourceMessageRecognitionConfig: SourceMessageRecognitionConfig;
  normalizedSourceId: string;
  approvalGroupId: string;
  approvalThreadId: number | null;
  approvalMessageMode: ApprovalMessageMode;
  approvalCustomMessage: string;
  approvalActionConfig: ApprovalActionConfig;
  approvalTopicConfigs: ApprovalTopicConfig[];
  supplyGroupId: string;
  supplyThreadId: number | null;
  supplyListenGroupId: string;
  supplyListenThreadIds: number[];
  supplyListenThreadId: number | null;
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
  forwardCount: number;
  lastForwardTime: number | null;
}

declare global {
  // eslint-disable-next-line no-var
  var __activeListeners: Map<string, ActiveListener> | undefined;
  // eslint-disable-next-line no-var
  var __globalBotToken: string | undefined;
  // eslint-disable-next-line no-var
  var __botPollingInterval: NodeJS.Timeout | null | undefined;
  // eslint-disable-next-line no-var
  var __botPollingActive: boolean | undefined;
  // eslint-disable-next-line no-var
  var __botPollingOffset: number | undefined;
  // eslint-disable-next-line no-var
  var __processingCallbackActions: Set<string> | undefined;
  // eslint-disable-next-line no-var
  var __processedUpdateIds: Set<number> | undefined;
  // eslint-disable-next-line no-var
  var __mediaGroupBuffers: Map<string, { timer: NodeJS.Timeout; messages: any[] }> | undefined;
  // eslint-disable-next-line no-var
  var __pendingIncompleteNotices: Map<string, { chatId: number; noticeMsgId: number; createdAt: number }> | undefined;
  // eslint-disable-next-line no-var
  var __replyMediaGroupBuffers: Map<string, { timer: NodeJS.Timeout; updates: any[] }> | undefined;
}

// Initialize active listeners Map if not present
if (!global.__activeListeners) {
  global.__activeListeners = new Map();
}
if (!global.__processingCallbackActions) {
  global.__processingCallbackActions = new Set();
}
if (!global.__processedUpdateIds) {
  global.__processedUpdateIds = new Set();
}
if (!global.__mediaGroupBuffers) {
  global.__mediaGroupBuffers = new Map();
}
if (!global.__pendingIncompleteNotices) {
  global.__pendingIncompleteNotices = new Map();
}
if (!global.__replyMediaGroupBuffers) {
  global.__replyMediaGroupBuffers = new Map();
}

function removeLegacyGramjsListenerIfAny(): void {
  const legacyHandler = (global as any).__globalListenerHandler;
  const legacyClient = (global as any).__globalListenerClient;

  if (!legacyHandler || !legacyClient) return;

  try {
    legacyClient.removeEventHandler(legacyHandler);
    console.log('[BotListener] Removed legacy GramJS message handler.');
  } catch (err: any) {
    console.warn('[BotListener] Failed to remove legacy GramJS handler:', err?.message || err);
  } finally {
    (global as any).__globalListenerHandler = undefined;
    (global as any).__globalListenerClient = undefined;
  }
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

function emitListenerLog(
  level: 'info' | 'warn' | 'error' | 'success',
  message: string,
  extra?: { automationId?: string; step?: string }
): void {
  const payload = {
    type: 'log',
    source: 'bot',
    level,
    message,
    ts: Date.now(),
    automationId: extra?.automationId,
    step: extra?.step,
  };
  sendSseUpdate(payload);

  const prefix = extra?.step ? `[BotListener:${extra.step}]` : '[BotListener]';
  if (level === 'error') {
    console.error(prefix, message);
  } else if (level === 'warn') {
    console.warn(prefix, message);
  } else {
    console.log(prefix, message);
  }
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
    removeLegacyGramjsListenerIfAny();

    // Cache the global bot token
    const globalToken = await loadGlobalBotToken();
    global.__globalBotToken = globalToken;

    const setups = await getActiveAutomationSetups();
    console.log(`[BotListener] Found ${setups.length} active automations to auto-start.`);
    emitListenerLog('info', `Tự khởi động ${setups.length} automation đang bật.`, { step: 'auto-start' });
    
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
          sourceMessageRecognitionConfig: setup.sourceMessageRecognitionConfig,
          normalizedSourceId: normalized,
          approvalGroupId: setup.approvalGroupId,
          approvalThreadId: setup.approvalThreadId,
          approvalMessageMode: setup.approvalMessageMode,
          approvalCustomMessage: setup.approvalCustomMessage,
          approvalActionConfig: setup.approvalActionConfig,
          approvalTopicConfigs: setup.approvalTopicConfigs,
          supplyGroupId: setup.supplyGroupId,
          supplyThreadId: setup.supplyThreadId,
          supplyListenGroupId: setup.supplyListenGroupId,
          supplyListenThreadIds: setup.supplyListenThreadIds,
          supplyListenThreadId: setup.supplyListenThreadId,
          supplierRoutes: setup.supplierRoutes,
          deliveryGroupId: setup.deliveryGroupId,
          deliveryThreadId: setup.deliveryThreadId,
          finalMessageMode: setup.finalMessageMode,
          finalGroupId: setup.finalGroupId,
          finalThreadId: setup.finalThreadId,
          rejectGroupId: setup.rejectGroupId,
          rejectThreadId: setup.rejectThreadId,
          rejectCustomMessage: setup.rejectCustomMessage,
          rejectTopicConfigs: setup.rejectTopicConfigs,
          forwardCount: setup.forwardCount,
          lastForwardTime: setup.lastForwardTime,
        });
        console.log(`[BotListener] Registered auto-start for: ${setup.name} (ID: ${setup.id})`);
        emitListenerLog('info', `Đã nạp automation "${setup.name}" vào listener.`, {
          automationId: setup.id,
          step: 'auto-start',
        });
      }
    }

    if (global.__activeListeners!.size > 0) {
      startBotPolling();
    }
  } catch (err: any) {
    console.error('[BotListener] Auto-start failed:', err.message);
    emitListenerLog('error', `Auto-start thất bại: ${err.message}`, { step: 'auto-start' });
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
  emitListenerLog('info', 'Bắt đầu Telegram polling loop.', { step: 'polling' });
  
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
  emitListenerLog('warn', 'Đã dừng Telegram polling loop.', { step: 'polling' });
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
        void handleBotUpdate(update).catch((err: any) => {
          console.error('[BotListener] Unhandled update error:', err?.message || err);
          emitListenerLog('error', `Unhandled update error: ${err?.message || err}`, { step: 'update' });
        });
      }
    }
  } catch (err: any) {
    console.error('[BotListener] Error in Bot polling:', err.message);
    emitListenerLog('error', `Polling lỗi: ${err.message}`, { step: 'polling' });
  }

  if (global.__botPollingActive) {
    global.__botPollingInterval = setTimeout(pollUpdates, 1000);
  }
}

async function handleBotUpdate(update: any, forcedAlbumMsgIds?: number[]) {
  // Dedup: skip if this update_id has already been processed (prevents polling retry duplicates).
  // Skipped for the synthetic re-dispatch of a buffered reply album (forcedAlbumMsgIds set below).
  const updateId: number = update.update_id;
  if (!forcedAlbumMsgIds) {
    if (global.__processedUpdateIds!.has(updateId)) {
      console.log(`[BotListener] Skipping already-processed update_id ${updateId}.`);
      return;
    }
    global.__processedUpdateIds!.add(updateId);
    // Cleanup old entries to prevent memory leak (keep last 500)
    if (global.__processedUpdateIds!.size > 1000) {
      const entries = Array.from(global.__processedUpdateIds!);
      global.__processedUpdateIds = new Set(entries.slice(-500));
    }

    // A reply that's part of a media-group album (e.g. nghiệm thu reply with
    // several photos) arrives as one update per photo. Buffer them so the
    // reply-handling branches below run once for the whole album instead of
    // once per photo (which used to create one "GHI NHẬN NGHIỆM THU" per photo).
    if (update.message?.media_group_id && update.message?.reply_to_message) {
      const mgId = String(update.message.media_group_id);
      let buffer = global.__replyMediaGroupBuffers!.get(mgId);
      if (buffer) {
        clearTimeout(buffer.timer);
        buffer.updates.push(update);
      } else {
        buffer = { timer: null as any, updates: [update] };
        global.__replyMediaGroupBuffers!.set(mgId, buffer);
      }
      buffer.timer = setTimeout(() => {
        const buf = global.__replyMediaGroupBuffers!.get(mgId);
        if (!buf) return;
        global.__replyMediaGroupBuffers!.delete(mgId);
        const sortedUpdates = buf.updates.sort((a: any, b: any) => Number(a.message.message_id) - Number(b.message.message_id));
        const representative = sortedUpdates.find((u: any) => u.message.text || u.message.caption) || sortedUpdates[0];
        const allIds = sortedUpdates.map((u: any) => Number(u.message.message_id));
        void handleBotUpdate(representative, allIds).catch((err: any) => {
          console.error('[BotListener] Unhandled buffered reply album error:', err?.message || err);
        });
      }, 1000);
      return;
    }
  }

  let callbackFailureReporter: ((bodyText: string, label: string) => Promise<void>) | null = null;
  try {
    const p = getPool();
    const token = global.__globalBotToken || await loadGlobalBotToken();
    if (!token) {
      emitListenerLog('error', 'Thiếu bot token khi xử lý update.', { step: 'update' });
      return;
    }
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
      const actionKey = `${logId}:${action}`;
      if (global.__processingCallbackActions!.has(actionKey)) {
        return;
      }
      global.__processingCallbackActions!.add(actionKey);

      const callbackChatId = cq.message?.chat?.id;
      const callbackMessageId = cq.message?.message_id;
      const originalCleanText = cq.message?.text || cq.message?.caption || '';
      const updateCallbackStatus = async (bodyText: string, label: string) => {
        if (!callbackChatId || !callbackMessageId) return;
        await editTelegramMessageWithFallback(baseUrl, {
          chat_id: callbackChatId,
          message_id: callbackMessageId,
          text: `${originalCleanText}\n\n${bodyText}`,
          reply_markup: { inline_keyboard: [] },
        }, label);
      };
      callbackFailureReporter = updateCallbackStatus;
      try {
        if (callbackChatId && callbackMessageId) {
          await updateCallbackStatus('⏳ Đang xử lý lựa chọn...', 'callback ack');
        }

        const logRes = await p.query('SELECT * FROM workflow_logs WHERE id = $1', [logId]);
        if (logRes.rows.length === 0) {
          await updateCallbackStatus('❌ Không tìm thấy workflow log để xử lý.', 'callback missing log');
          return;
        }
        const log = logRes.rows[0];

        const autoSetup = await loadAutomationSetup(log.automation_id);
        if (!autoSetup) {
          await updateCallbackStatus('❌ Không tìm thấy cấu hình automation.', 'callback missing automation');
          return;
        }

        if (action === 'appr_agree') {
          if (log.status !== 'pending') {
            await updateCallbackStatus('⚠️ Lựa chọn này đã được xử lý trước đó.', 'callback stale approval');
            return;
          }

          const apprAgreeClaim = await p.query(
            "UPDATE workflow_logs SET status = 'approved' WHERE id = $1 AND status = 'pending' RETURNING id",
            [logId]
          );
          if (apprAgreeClaim.rows.length === 0) {
            return;
          }
          const approvalTopicConfig = resolveApprovalTopicConfig(autoSetup, normalizeThreadId(log.original_thread_id));
          const approvalDecisionText = formatApprovalDecisionMessage(approvalTopicConfig.approvalActionConfig.agreeResultMessage, userFullName, log.original_text || '');
          const headerText = buildApprovalHeaderText(autoSetup, log);

          const supplierRoutes = getConfiguredSupplierRoutes(autoSetup);
          const listenMatch = matchesSupplyListenScope(autoSetup, log);
          emitListenerLog('info', `Kiểm tra kênh/topic lắng nghe: ${listenMatch.matched ? 'khớp' : 'không khớp'} - ${listenMatch.reason}`, {
            automationId: log.automation_id,
            step: 'supplier-select',
          });

          if (listenMatch.matched && supplierRoutes.length > 0) {
            await p.query("UPDATE workflow_logs SET status = 'supplier_selecting' WHERE id = $1", [logId]);
            emitListenerLog('info', `Kênh/topic lắng nghe khớp: hiển thị danh sách ${supplierRoutes.length} nhà cung ứng để chọn.`, {
              automationId: log.automation_id,
              step: 'supplier-select',
            });
            await appendApprovalStatusLine(p, baseUrl, log, autoSetup.approvalGroupId, headerText, `✅ ${approvalDecisionText}\n\n🏭 Hãy chọn nhà cung ứng:`, {
              inline_keyboard: supplierRoutes.map((route) => ([
                { text: route.name, callback_data: `supplier_select:${logId}:${route.id}` },
              ])),
            });
            return;
          }

          if (listenMatch.matched) {
            emitListenerLog('warn', 'Tin ở kênh/topic lắng nghe không có nhà cung ứng cấu hình hợp lệ, không thể mở nhánh supplier.', {
              automationId: log.automation_id,
              step: 'supplier-select',
            });
            await updateCallbackStatus('❌ Chưa cấu hình nhà cung ứng cho kênh/topic này.', 'callback missing supplier route');
          } else {
            emitListenerLog('info', 'Tin nhắn không nằm trong kênh/topic lắng nghe của Bước 3, dừng ở bước phê duyệt và không đi sang supplier.', {
              automationId: log.automation_id,
              step: 'supplier-select',
            });
            await appendApprovalStatusLine(p, baseUrl, log, autoSetup.approvalGroupId, headerText, `✅ ${approvalDecisionText}`);
            return;
          }

        } else if (action === 'appr_disagree') {
          if (log.status !== 'pending') {
            await updateCallbackStatus('⚠️ Lựa chọn này đã được xử lý trước đó.', 'callback stale reject');
            return;
          }

          await p.query("UPDATE workflow_logs SET status = 'rejected' WHERE id = $1", [logId]);
          const sourceThreadId = normalizeThreadId(log.original_thread_id);
          const approvalTopicConfig = resolveApprovalTopicConfig(autoSetup, sourceThreadId);
          const rejectTopicConfig = resolveRejectTopicConfig(autoSetup, sourceThreadId);
          const approvalDecisionText = formatApprovalDecisionMessage(approvalTopicConfig.approvalActionConfig.disagreeResultMessage, userFullName, log.original_text || '');
          const headerText = buildApprovalHeaderText(autoSetup, log);

          // Send reject notification
          const rejectTarget = resolveApprovalRejectTarget(autoSetup);
          if (!rejectTarget.groupId) {
            console.warn(`[BotListener] Reject target is not configured for automation: ${log.automation_id}.`);
            await updateCallbackStatus('❌ Chưa có nhóm nào để nhận thông báo từ chối.', 'callback reject missing group');
            return;
          }
          if (rejectTarget.usedFallback) {
            emitListenerLog('warn', 'Chưa cấu hình nhóm từ chối riêng, dùng nhóm phê duyệt làm nơi nhận thông báo từ chối.', {
              automationId: log.automation_id,
              step: 'approval',
            });
          }
          const rejectText = formatRejectCustomMessagePlain(
            rejectTopicConfig.rejectCustomMessage,
            userFullName,
            log.original_sender_name || '',
            log.original_text || ''
          );
          await sendDividerMessageIfNeeded(baseUrl, rejectTarget.groupId, rejectTarget.threadId || undefined, 'reject notice');
          await sendTelegramMessageWithFallback(baseUrl, {
            chat_id: rejectTarget.groupId,
            message_thread_id: rejectTarget.threadId || undefined,
            text: rejectText,
          }, 'reject notice');
          await appendApprovalStatusLine(p, baseUrl, log, autoSetup.approvalGroupId, headerText, `❌ ${approvalDecisionText}`);

        } else if (action === 'supplier_select') {
          if (parts.length < 3) {
            await updateCallbackStatus('❌ Thiếu thông tin nhà cung ứng đã chọn.', 'callback missing supplier id');
            return;
          }
          const routeId = parts[2];
          const supplierRoutes = getConfiguredSupplierRoutes(autoSetup);
          const selectedRoute = supplierRoutes.find((route) => route.id === routeId);
          const supplierSelectHeaderText = buildApprovalHeaderText(autoSetup, log);
          if (!selectedRoute) {
            await updateCallbackStatus('❌ Nhà cung ứng đã chọn không còn hợp lệ.', 'callback invalid supplier');
            return;
          }

          emitListenerLog('info', `Đã chọn nhà cung ứng "${selectedRoute.name}".`, {
            automationId: log.automation_id,
            step: 'supplier-select',
          });

          emitListenerLog('info', `Đang gửi tới supplier ${selectedRoute.name} (chat_id=${selectedRoute.groupId}${selectedRoute.threadId !== null ? `, topic=${selectedRoute.threadId}` : ''}).`, {
            automationId: log.automation_id,
            step: 'supplier-select',
          });

          void (async () => {
          const supplyText = withProjectTag(log.original_text, `💬 *YÊU CẦU CUNG CẤP VẬT TƯ*\n\nNội dung: ${log.original_text || '[Media]'}\n\nVui lòng lựa chọn phương án:`);
          const promptPromise = sendTelegramMessageWithFallback(baseUrl, {
            chat_id: selectedRoute.groupId,
            message_thread_id: selectedRoute.threadId || undefined,
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
          }, `supplier route ${selectedRoute.name}`);

          const originalMsgIds: number[] = typeof log.original_msg_ids === 'string' && log.original_msg_ids.trim()
            ? log.original_msg_ids.split(',').map(Number).filter(Boolean)
            : [Number(log.original_msg_id)];

          const sendMethod: 'forwardMessage' | 'copyMessage' = selectedRoute.messageMode === 'copy' ? 'copyMessage' : 'forwardMessage';
          const contentPromise = sendTelegramMethodWithFallback(baseUrl, sendMethod, {
            chat_id: selectedRoute.groupId,
            message_thread_id: selectedRoute.threadId || undefined,
            from_chat_id: log.original_chat_id,
            message_id: log.original_msg_id,
            message_ids: originalMsgIds,
          }, `supplier route content ${selectedRoute.name}`);

          const [promptData, contentData] = await Promise.all([promptPromise, contentPromise]);

          if (!promptData.ok) {
            const promptError = promptData.description || 'unknown error';
            const promptHint = /chat not found/i.test(promptError)
              ? 'Bot chưa được thêm vào nhóm/kênh đích hoặc chat_id đang sai.'
              : '';
            emitListenerLog('error', `Không gửi được prompt nhà cung ứng "${selectedRoute.name}" tới chat ${selectedRoute.groupId}: ${promptData.description || 'unknown error'}`, {
              automationId: log.automation_id,
              step: 'supplier-select',
            });
            await appendApprovalStatusLine(p, baseUrl, log, autoSetup.approvalGroupId, supplierSelectHeaderText, `❌ Không gửi được prompt đến ${selectedRoute.name}.${promptHint ? ` ${promptHint}` : ''}`);
            return;
          }

          await p.query(
            `UPDATE workflow_logs
             SET status = 'supply_sent',
                 supply_msg_id = $1,
                 supplier_route_id = $2,
                 selected_supplier_group_id = $3,
                 selected_supplier_thread_id = $4,
                 supply_prompt_group_id = $5,
                 supply_prompt_thread_id = $6
             WHERE id = $7`,
            [
              promptData.result.message_id,
              selectedRoute.id,
              selectedRoute.groupId,
              selectedRoute.threadId,
              selectedRoute.groupId,
              selectedRoute.threadId,
              logId,
            ]
          );

          if (!contentData.ok) {
            const contentError = contentData.description || 'unknown error';
            const contentHint = /chat not found/i.test(contentError)
              ? 'Bot chưa được thêm vào nhóm/kênh đích hoặc chat_id đang sai.'
              : '';
            emitListenerLog('error', `Không chuyển được nội dung sang ${selectedRoute.name}: ${contentData.description || 'unknown error'}`, {
              automationId: log.automation_id,
              step: 'supplier-select',
            });
            await appendApprovalStatusLine(p, baseUrl, log, autoSetup.approvalGroupId, supplierSelectHeaderText, `⚠️ Đã chọn ${selectedRoute.name}, nhưng chưa chuyển được nội dung.${contentHint ? ` ${contentHint}` : ''}`);
            return;
          }

          await appendApprovalStatusLine(p, baseUrl, log, autoSetup.approvalGroupId, supplierSelectHeaderText, `✅ Đã chọn NCC: ${selectedRoute.name}`);
        })().catch((err: any) => {
          emitListenerLog('error', `Xử lý nhà cung ứng "${selectedRoute.name}" lỗi: ${err.message}`, {
            automationId: log.automation_id,
            step: 'supplier-select',
          });
          void updateCallbackStatus(`❌ Xử lý nhà cung ứng lỗi: ${err.message}`, 'supplier error ack');
        });

        return;

      } else if (action === 'supply_agree') {
        if (log.status !== 'supply_sent') {
          await updateCallbackStatus('⚠️ Lựa chọn này đã được xử lý trước đó.', 'callback stale supply agree');
          return;
        }

        const expectedSupplyListenTarget = resolveSupplyListenTarget(autoSetup, log);
        if (expectedSupplyListenTarget.groupIds.length > 0 && !matchesSupplyListenGroup(cq.message.chat.id, autoSetup, log)) {
          await updateCallbackStatus(`⚠️ Bỏ qua vì chat không khớp.\nKỳ vọng: ${expectedSupplyListenTarget.groupIds.join(', ')}\nThực tế: ${String(cq.message.chat.id)}`, 'callback supply agree mismatch');
          return;
        }
        if (expectedSupplyListenTarget.threadIds.length > 0) {
          const actualThreadId = normalizeThreadId(cq.message.message_thread_id);
          if (!matchesSupplyListenThread(actualThreadId, autoSetup, log)) {
            await updateCallbackStatus(`⚠️ Bỏ qua vì topic không khớp.\nKỳ vọng: ${expectedSupplyListenTarget.threadIds.join(', ')}\nThực tế: ${actualThreadId ?? 'general'}`, 'callback supply agree topic mismatch');
            return;
          }
        }

        const supplyAgreeClaim = await p.query(
          "UPDATE workflow_logs SET status = 'supply_agreed' WHERE id = $1 AND status = 'supply_sent' RETURNING id",
          [logId]
        );
        if (supplyAgreeClaim.rows.length === 0) {
          // Đã được một lần xử lý khác (vd. update bị Telegram gửi lại sau khi service restart) giành xử lý trước.
          return;
        }
        const supplyAgreeHeaderText = buildApprovalHeaderText(autoSetup, log);

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
          await updateCallbackStatus('❌ Chưa cấu hình nhóm giao nhận.', 'callback missing delivery group');
          return;
        }
        const deliveryText = withProjectTag(log.original_text, `📦 *THÔNG BÁO GIAO NHẬN VẬT TƯ*\n\nNội dung yêu cầu: ${log.original_text || '[Media]'}\n\nVật tư đang được vận chuyển đến công trình.`);
        await sendDividerMessageIfNeeded(baseUrl, autoSetup.deliveryGroupId, autoSetup.deliveryThreadId || undefined, 'delivery notice');
        const deliveryData = await sendTelegramMessageWithFallback(baseUrl, {
          chat_id: autoSetup.deliveryGroupId,
          message_thread_id: autoSetup.deliveryThreadId || undefined,
          text: deliveryText,
        }, 'delivery notice');
        if (deliveryData.ok) {
          await p.query(
            "UPDATE workflow_logs SET delivery_msg_id = $1, delivery_group_id = $2 WHERE id = $3",
            [deliveryData.result.message_id, normalizeComparableChatId(autoSetup.deliveryGroupId), logId]
          );
          emitListenerLog('success', `Đã gửi thông báo giao nhận vật tư #${deliveryData.result.message_id}.`, {
            automationId: log.automation_id,
            step: 'delivery',
          });
          await appendApprovalStatusLine(p, baseUrl, log, autoSetup.approvalGroupId, supplyAgreeHeaderText, `✅ Đã đồng ý cấp vật tư — ${userFullName}`);
          await appendApprovalStatusLine(p, baseUrl, log, autoSetup.approvalGroupId, supplyAgreeHeaderText, `📦 Đang giao đến công trình`);
        } else {
          emitListenerLog('error', `Không gửi được thông báo giao nhận: ${deliveryData.description || 'unknown error'}`, {
            automationId: log.automation_id,
            step: 'delivery',
          });
        }

      } else if (action === 'supply_reject' || action === 'supply_change') {
        if (log.status !== 'supply_sent') {
          await updateCallbackStatus('⚠️ Lựa chọn này đã được xử lý trước đó.', 'callback stale supply decision');
          return;
        }

        const expectedSupplyListenTarget = resolveSupplyListenTarget(autoSetup, log);
        if (expectedSupplyListenTarget.groupIds.length > 0 && !matchesSupplyListenGroup(cq.message.chat.id, autoSetup, log)) {
          await updateCallbackStatus(`⚠️ Bỏ qua vì chat không khớp.\nKỳ vọng: ${expectedSupplyListenTarget.groupIds.join(', ')}\nThực tế: ${String(cq.message.chat.id)}`, 'callback supply decision mismatch');
          return;
        }
        if (expectedSupplyListenTarget.threadIds.length > 0) {
          const actualThreadId = normalizeThreadId(cq.message.message_thread_id);
          if (!matchesSupplyListenThread(actualThreadId, autoSetup, log)) {
            await updateCallbackStatus(`⚠️ Bỏ qua vì topic không khớp.\nKỳ vọng: ${expectedSupplyListenTarget.threadIds.join(', ')}\nThực tế: ${actualThreadId ?? 'general'}`, 'callback supply decision topic mismatch');
            return;
          }
        }

        const isChange = action === 'supply_change';
        const newStatus = isChange ? 'supply_changed' : 'supply_rejected';
        const supplyDecisionHeaderText = buildApprovalHeaderText(autoSetup, log);

        const supplyDecisionClaim = await p.query(
          "UPDATE workflow_logs SET status = $1 WHERE id = $2 AND status = 'supply_sent' RETURNING id",
          [newStatus, logId]
        );
        if (supplyDecisionClaim.rows.length === 0) {
          return;
        }

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

        // Send reject/change notification
        const rejectTarget = resolveSupplyRejectTarget(autoSetup, log);
        if (!isChange && !rejectTarget.groupId) {
          console.warn(`[BotListener] Reject target is not configured for automation: ${log.automation_id}.`);
          await updateCallbackStatus('❌ Chưa có nhóm nào để nhận thông báo từ chối.', 'callback missing reject group');
          return;
        }
        if (!isChange && rejectTarget.usedFallback) {
          emitListenerLog('warn', 'Chưa cấu hình nhóm từ chối riêng, dùng nhóm vật tư hiện tại làm nơi nhận thông báo từ chối.', {
            automationId: log.automation_id,
            step: 'supplier-select',
          });
        }
        const rejectText = withProjectTag(log.original_text, isChange
          ? `🔄 *THÔNG BÁO YÊU CẦU THAY ĐỔI VẬT TƯ*\n\nPhương án: Yêu cầu thay đổi vật tư bởi ${userFullName}\nNội dung ban đầu: ${log.original_text || '[Media]'}\n\n👉 Hãy trả lời ngay dưới tin nhắn này. Bot sẽ chuyển tiếp nội dung phản hồi sang nhóm/topic đã cấu hình để mọi người cùng nắm được đề xuất thay đổi.`
          : `❌ *THÔNG BÁO TỪ CHỐI CUNG CẤP VẬT TƯ*\n\nPhương án: Từ chối cung cấp vật tư bởi ${userFullName}\nNội dung ban đầu: ${log.original_text || '[Media]'}`);
        await sendDividerMessageIfNeeded(baseUrl, isChange ? cq.message.chat.id : rejectTarget.groupId, isChange ? (cq.message.message_thread_id || undefined) : (rejectTarget.threadId || undefined), 'reject/change notice');
        const rejectData = await sendTelegramMessageWithFallback(baseUrl, {
          chat_id: isChange ? cq.message.chat.id : rejectTarget.groupId,
          message_thread_id: isChange ? (cq.message.message_thread_id || undefined) : (rejectTarget.threadId || undefined),
          text: rejectText,
        }, 'reject/change notice');
        if (isChange && rejectData.ok) {
          await p.query("UPDATE workflow_logs SET supply_change_msg_id = $1 WHERE id = $2", [rejectData.result.message_id, logId]);
        }
        await appendApprovalStatusLine(p, baseUrl, log, autoSetup.approvalGroupId, supplyDecisionHeaderText, `${statusLabel} bởi ${userFullName}`);
      }
      } finally {
        global.__processingCallbackActions!.delete(actionKey);
      }
    }

    let replyHandled = false;

    // Helper: re-process a source message (either an explicit reply to it, or the
    // message itself after being edited in place) by superseding the previous
    // workflow log/approval prompt and regenerating it from the new content.
    const tryApplySourceReplyRefresh = async (
      msg: any,
      sourceMsgId: number,
      options: { isEdit: boolean }
    ): Promise<boolean> => {
      const chatId = msg.chat.id.toString();
      const replyThreadId = normalizeThreadId(msg.message_thread_id);
      // Match either the exact message replied to, or (since users often keep
      // replying to the very first/original message instead of their latest
      // reply) any log that shares the same thread root — picking the newest.
      const sourceReplyLogRes = await p.query(
        'SELECT * FROM workflow_logs WHERE original_msg_id = $1 OR thread_root_msg_id = $1 ORDER BY id DESC',
        [sourceMsgId]
      );
      if (sourceReplyLogRes.rows.length === 0) return false;

      for (const log of sourceReplyLogRes.rows) {
        const autoSetup = await loadAutomationSetup(log.automation_id);
        if (!autoSetup) continue;

        const approvalTopicConfig = resolveApprovalTopicConfig(autoSetup, normalizeThreadId(log.original_thread_id));
        const refreshEnabled = approvalTopicConfig.approvalActionConfig.refreshOnSourceReply === true
          || approvalTopicConfig.approvalActionConfig.attendanceSupplementReplyEnabled === true;
        if (!refreshEnabled) {
          continue;
        }

        const replyRefreshScope = matchesSourceReplyRefreshScope(chatId, replyThreadId, autoSetup, log);
        if (!replyRefreshScope.matched) {
          continue;
        }

        const newText = msg.text || msg.caption || '[Hình ảnh/Tài liệu]';
        const senderFullName = [msg.from?.first_name, msg.from?.last_name].filter(Boolean).join(' ') || msg.from?.username || 'Thành viên';
        const refreshedOriginalText = options.isEdit
          ? newText
          : formatSourceReplyRefreshText(log.original_text || '', newText, senderFullName);

        await p.query("UPDATE workflow_logs SET status = 'superseded' WHERE id = $1", [log.id]);

        if (log.approval_msg_id && autoSetup.approvalGroupId) {
          await deleteTelegramMessage(baseUrl, {
            chat_id: autoSetup.approvalGroupId,
            message_id: log.approval_msg_id,
          }, 'superseded approval prompt');
        }

        if (log.approval_divider_msg_id && autoSetup.approvalGroupId) {
          await deleteTelegramMessage(baseUrl, {
            chat_id: autoSetup.approvalGroupId,
            message_id: log.approval_divider_msg_id,
          }, 'superseded approval divider');
        }

        if (autoSetup.approvalGroupId && typeof log.approval_content_msg_ids === 'string' && log.approval_content_msg_ids.trim()) {
          const contentMsgIds = log.approval_content_msg_ids
            .split(',')
            .map((id: string) => Number(id.trim()))
            .filter((id: number) => Number.isInteger(id) && id > 0);
          for (const contentMsgId of contentMsgIds) {
            await deleteTelegramMessage(baseUrl, {
              chat_id: autoSetup.approvalGroupId,
              message_id: contentMsgId,
            }, 'superseded approval content');
          }
        }

        // The prompt may have already been approved/rejected and replaced by a
        // fresh "✅ Đã được chấm công/phê duyệt" notice block (START + notice +
        // forwarded content + END). Clean that up too so it doesn't linger.
        if (autoSetup.approvalGroupId && typeof log.post_notice_msg_ids === 'string' && log.post_notice_msg_ids.trim()) {
          const postNoticeMsgIds = log.post_notice_msg_ids
            .split(',')
            .map((id: string) => Number(id.trim()))
            .filter((id: number) => Number.isInteger(id) && id > 0);
          for (const postNoticeMsgId of postNoticeMsgIds) {
            await deleteTelegramMessage(baseUrl, {
              chat_id: autoSetup.approvalGroupId,
              message_id: postNoticeMsgId,
            }, 'superseded post-approval notice');
          }
        }

        if (!options.isEdit && approvalTopicConfig.approvalActionConfig.deleteSourceMessageOnReply === true) {
          await deleteTelegramMessage(baseUrl, {
            chat_id: msg.chat.id,
            message_id: sourceMsgId,
          }, 'superseded source message');
        }

        await reactToTelegramMessage(
          baseUrl,
          msg.chat.id,
          msg.message_id,
          options.isEdit ? 'source edit refresh ack' : 'source reply refresh ack'
        );

        await handleBotMessageTrigger(msg, p, token, undefined, {
          forceProcess: true,
          overrideOriginalText: refreshedOriginalText,
          threadRootMsgId: log.thread_root_msg_id ?? log.original_msg_id,
        });
        return true;
      }
      return false;
    };

    if (update.message && update.message.reply_to_message && !replyHandled) {
      const msg = update.message;
      const replyToMsgId = msg.reply_to_message.message_id;
      replyHandled = await tryApplySourceReplyRefresh(msg, replyToMsgId, { isEdit: false });
    }

    // Edited source message: treat as if the user replied to their own original
    // message with the corrected content (xử lý tin nhắn sửa như reply tin sửa).
    if (update.edited_message && !replyHandled) {
      const editedMsg = update.edited_message;
      replyHandled = await tryApplySourceReplyRefresh(editedMsg, editedMsg.message_id, { isEdit: true });
    }

    // 3. Reply to delivery message handler
    if (update.message && update.message.reply_to_message && !replyHandled) {
      const msg = update.message;
      const replyToMsgId = msg.reply_to_message.message_id;
      const chatId = msg.chat.id.toString();
      const replyThreadId = normalizeThreadId(msg.message_thread_id);

      emitListenerLog('info', `Nhận reply trong group ${chatId} tới message #${replyToMsgId}.`, {
        step: 'delivery-reply',
      });

      // Find log waiting for delivery reply or reply to the original request in step 3
      const logRes = await p.query(
        "SELECT * FROM workflow_logs WHERE status IN ('supply_agreed', 'completed') AND (delivery_msg_id = $1 OR original_msg_id = $1)",
        [replyToMsgId]
      );
      if (logRes.rows.length > 0) {
        for (const log of logRes.rows) {
          const autoSetup = await loadAutomationSetup(log.automation_id);
          if (!autoSetup) continue;

          // Verify chat ID
          const normLogGroup = normalizeComparableChatId(log.delivery_group_id || autoSetup.deliveryGroupId);
          const normChatId = normalizeComparableChatId(chatId);
          const isStep3OriginReply = Number(log.original_msg_id) === Number(replyToMsgId);
          if (isStep3OriginReply) {
            const step3ReplyScope = matchesSupplyListenReplyScope(chatId, replyThreadId, autoSetup, log);
            if (!step3ReplyScope.matched) {
              emitListenerLog('warn', `Bá» qua reply nghiá»‡m thu á»Ÿ bÆ°á»›c 3: ${step3ReplyScope.reason}.`, {
                automationId: log.automation_id,
                step: 'delivery-reply',
              });
              continue;
            }
          } else if (normLogGroup !== normChatId) {
            emitListenerLog('warn', `Bỏ qua reply delivery do chat không khớp. Reply chat=${chatId}, config=${autoSetup.deliveryGroupId}.`, {
              automationId: log.automation_id,
              step: 'delivery-reply',
            });
            continue;
          }

          if (log.status !== 'completed') {
            await p.query("UPDATE workflow_logs SET status = 'completed' WHERE id = $1", [log.id]);
          }
          replyHandled = true;

          const senderFullName = [msg.from?.first_name, msg.from?.last_name].filter(Boolean).join(' ') || msg.from?.username || 'Thành viên';
          const replyText = msg.text || '';
          if (!autoSetup.finalGroupId) {
            console.warn(`[BotListener] Final group is not configured for automation: ${log.automation_id}. Cannot send acceptance completion notification.`);
            emitListenerLog('error', `Chưa cấu hình nhóm nghiệm thu cuối cho automation ${log.automation_id}.`, {
              automationId: log.automation_id,
              step: 'delivery-reply',
            });
            continue;
          }

          await reactToTelegramMessage(baseUrl, msg.chat.id, msg.message_id, 'delivery reply ack');

          const nghiemThuHeaderText = buildApprovalHeaderText(autoSetup, log);
          await appendApprovalStatusLine(p, baseUrl, log, autoSetup.approvalGroupId, nghiemThuHeaderText, `✅ Đã nghiệm thu — ${senderFullName}`);

          const finalHeader = withProjectTag(log.original_text, `✅ *GHI NHẬN NGHIỆM THU VẬT TƯ*\n\nYêu cầu: "${log.original_text || '[Media]'}"\n\nĐã được xác nhận bởi *${senderFullName}*\nPhản hồi sẽ được chuyển tiếp bên dưới bằng chế độ *${autoSetup.finalMessageMode === 'copy' ? 'COPY' : 'FORWARD'}*.`);
          await sendDividerMessageIfNeeded(baseUrl, autoSetup.finalGroupId, autoSetup.finalThreadId || undefined, 'final header');
          await sendTelegramMessageWithFallback(baseUrl, {
            chat_id: autoSetup.finalGroupId,
            message_thread_id: autoSetup.finalThreadId || undefined,
            text: finalHeader,
          }, 'final header');

          const finalContentMethod: 'copyMessage' | 'forwardMessage' = autoSetup.finalMessageMode === 'copy' ? 'copyMessage' : 'forwardMessage';
          const finalRelayMsgIds = forcedAlbumMsgIds && forcedAlbumMsgIds.length > 0 ? forcedAlbumMsgIds : [msg.message_id];
          await sendTelegramMethodWithFallback(baseUrl, finalContentMethod, {
            chat_id: autoSetup.finalGroupId,
            message_thread_id: autoSetup.finalThreadId || undefined,
            from_chat_id: msg.chat.id,
            message_id: finalRelayMsgIds[0],
            message_ids: finalRelayMsgIds,
          }, 'final relay content');

          console.log(`[BotListener] Workflow log ${log.id} successfully completed & notified!`);
        }
      }
    }

    // 3b. Reply attempting "nghiệm thu" on a vật tư request that was never
    // agreed/completed (e.g. it was rejected, changed, or still pending):
    // remove any reaction to signal it's invalid and don't continue the flow.
    if (update.message && update.message.reply_to_message && !replyHandled) {
      const msg = update.message;
      const replyToMsgId = msg.reply_to_message.message_id;
      const notAgreedLogRes = await p.query(
        `SELECT * FROM workflow_logs
         WHERE (original_msg_id = $1 OR delivery_msg_id = $1)
           AND supply_msg_id IS NOT NULL
           AND status NOT IN ('supply_agreed', 'completed')`,
        [replyToMsgId]
      );
      if (notAgreedLogRes.rows.length > 0) {
        const log = notAgreedLogRes.rows[0];
        replyHandled = true;
        await unreactTelegramMessage(baseUrl, msg.chat.id, msg.message_id, 'nghiệm thu reply on unagreed supply request');
        emitListenerLog('warn', `Bỏ qua reply nghiệm thu vì yêu cầu vật tư #${log.id} chưa được đồng ý cấp (status hiện tại: ${log.status}).`, {
          automationId: log.automation_id,
          step: 'delivery-reply',
        });
      }
    }

    // 4. Reply to "supplier requested change" notice
    if (update.message && update.message.reply_to_message) {
      const msg = update.message;
      const replyToMsgId = msg.reply_to_message.message_id;
      const chatId = msg.chat.id.toString();
      const replyThreadId = normalizeThreadId(msg.message_thread_id);

      const logRes = await p.query(
        "SELECT * FROM workflow_logs WHERE supply_change_msg_id = $1 AND status = 'supply_changed'",
        [replyToMsgId]
      );
      if (logRes.rows.length > 0) {
        for (const log of logRes.rows) {
          const autoSetup = await loadAutomationSetup(log.automation_id);
          if (!autoSetup) continue;

          const targetGroupId = autoSetup.supplyChangeGroupId || autoSetup.supplyGroupId;
          if (!targetGroupId) {
            console.warn(`[BotListener] Change request group is not configured for automation: ${log.automation_id}. Cannot relay change reply.`);
            continue;
          }

          const supplyChangeReplyScope = matchesSupplyChangeReplyScope(chatId, replyThreadId, autoSetup, log);
          if (!supplyChangeReplyScope.matched) {
            emitListenerLog('warn', `Bỏ qua reply change: ${supplyChangeReplyScope.reason}.`, {
              automationId: log.automation_id,
              step: 'supply-change-reply',
            });
            continue;
          }

          const senderFullName = [msg.from?.first_name, msg.from?.last_name].filter(Boolean).join(' ') || msg.from?.username || 'Thành viên';
          const replyText = msg.text || msg.caption || '';
          const relayHeader = `🔄 *NHÀ CUNG ỨNG YÊU CẦU THAY ĐỔI VẬT TƯ*\n\n*Người phản hồi:* ${senderFullName}\n*Nội dung phản hồi:* ${replyText || '[Media]'}\n\nNội dung chi tiết bên dưới được bot chuyển tiếp từ tin nhắn reply.`;
          const originalSenderName = typeof log.original_sender_name === 'string' && log.original_sender_name.trim()
            ? log.original_sender_name.trim()
            : 'Kh\u00f4ng r\u00f5';
          const originalRequestText = log.original_text || '[Media]';
          const enrichedRelayHeader = withProjectTag(log.original_text, `🔄 *NHÀ CUNG ỨNG YÊU CẦU THAY ĐỔI VẬT TƯ*\n\n*Yêu cầu ban đầu từ:* ${originalSenderName}\n*Nội dung yêu cầu ban đầu:* ${originalRequestText}\n\n*Người đang phản hồi:* ${senderFullName}\n*Nội dung phản hồi:* ${replyText || '[Media]'}\n\nNội dung chi tiết bên dưới là tin reply gốc được bot chuyển tiếp lại.`);
          const relayMode: 'copyMessage' | 'forwardMessage' = autoSetup.supplyChangeMessageMode === 'copy' ? 'copyMessage' : 'forwardMessage';
          const relayThreadId = autoSetup.supplyChangeThreadId || autoSetup.supplyThreadId || undefined;
          replyHandled = true;

          await sendDividerMessageIfNeeded(baseUrl, targetGroupId, relayThreadId, 'supply change relay header');
          const relayData = await sendTelegramMessageWithFallback(baseUrl, {
            chat_id: targetGroupId,
            message_thread_id: relayThreadId,
            text: enrichedRelayHeader,
          }, 'supply change relay header');

          if (relayData.ok) {
            const supplyChangeRelayMsgIds = forcedAlbumMsgIds && forcedAlbumMsgIds.length > 0 ? forcedAlbumMsgIds : [msg.message_id];
            await sendTelegramMethodWithFallback(baseUrl, relayMode, {
              chat_id: targetGroupId,
              message_thread_id: relayThreadId,
              from_chat_id: msg.chat.id,
              message_id: supplyChangeRelayMsgIds[0],
              message_ids: supplyChangeRelayMsgIds,
            }, 'supply change relay content');
          }
        }
      }
    }

    if (update.message && update.message.reply_to_message && !replyHandled) {
      const msg = update.message;
      const replyToMsgId = msg.reply_to_message.message_id;
      const chatId = msg.chat.id.toString();
      const replyThreadId = normalizeThreadId(msg.message_thread_id);
      const existingReplyRes = await p.query(
        "SELECT * FROM workflow_logs WHERE original_msg_id = $1 OR delivery_msg_id = $1 OR supply_change_msg_id = $1",
        [replyToMsgId]
      );

      for (const log of existingReplyRes.rows) {
        const autoSetup = await loadAutomationSetup(log.automation_id);
        if (!autoSetup) continue;

        const isOriginalReply = Number(log.original_msg_id) === Number(replyToMsgId);
        const isDeliveryReply = Number(log.delivery_msg_id) === Number(replyToMsgId);
        const isSupplyChangeReply = Number(log.supply_change_msg_id) === Number(replyToMsgId);

        const matchesOriginalReply = isOriginalReply
          && matchesSupplyListenReplyScope(chatId, replyThreadId, autoSetup, log).matched;
        const matchesDeliveryReply = isDeliveryReply
          && matchesDeliveryReplyScope(chatId, autoSetup, log);
        const matchesChangeReply = isSupplyChangeReply
          && matchesSupplyChangeReplyScope(chatId, replyThreadId, autoSetup, log).matched;

        if (!matchesOriginalReply && !matchesDeliveryReply && !matchesChangeReply) {
          continue;
        }

        replyHandled = true;
        emitListenerLog('info', `Bỏ qua reply lặp cho workflow #${log.id} đang ở trạng thái ${log.status}.`, {
          automationId: log.automation_id,
          step: 'reply-filter',
        });
        break;
      }
    }

    // 2. New message trigger handler
    if (update.message && !replyHandled) {
      const msg = update.message;
      if (msg.media_group_id) {
        const mgId = String(msg.media_group_id);
        let buffer = global.__mediaGroupBuffers!.get(mgId);
        if (buffer) {
          clearTimeout(buffer.timer);
          buffer.messages.push(msg);
        } else {
          buffer = {
            timer: null as any,
            messages: [msg],
          };
          global.__mediaGroupBuffers!.set(mgId, buffer);
        }

        buffer.timer = setTimeout(async () => {
          try {
            const buf = global.__mediaGroupBuffers!.get(mgId);
            if (!buf) return;
            global.__mediaGroupBuffers!.delete(mgId);

            // Sắp xếp theo ID tin nhắn tăng dần
            const sortedMsgs = buf.messages.sort((a: any, b: any) => Number(a.message_id) - Number(b.message_id));
            
            // Lấy tin nhắn có text/caption làm đại diện
            const representativeMsg = sortedMsgs.find((m: any) => m.text || m.caption) || sortedMsgs[0];
            const allMsgIds = sortedMsgs.map((m: any) => Number(m.message_id));

            // Kích hoạt trigger cho tin nhắn đại diện, kèm theo mảng tất cả message_id của album
            await handleBotMessageTrigger(representativeMsg, p, token, allMsgIds);
          } catch (err: any) {
            console.error('[BotListener] Error in media group debounce timer:', err?.message || err);
          }
        }, 1000);
      } else {
        await handleBotMessageTrigger(msg, p, token);
      }
    }
  } catch (err: any) {
    console.error('[BotListener] Error handling bot update:', err.message);
    emitListenerLog('error', `Xử lý update lỗi: ${err.message}`, { step: 'update' });
    if (update.callback_query && callbackFailureReporter) {
      await callbackFailureReporter(`❌ Xử lý lựa chọn lỗi: ${err.message}`, 'callback fatal error');
    }
  }
}

// ---------------------------------------------------------------------------
// Handle new Bot API message updates from source groups/topics
// ---------------------------------------------------------------------------
async function handleBotMessageTrigger(
  msg: any,
  p: ReturnType<typeof getPool>,
  botToken: string,
  mediaGroupMsgIds?: number[],
  options?: {
    forceProcess?: boolean;
    overrideOriginalText?: string;
    threadRootMsgId?: number;
  }
): Promise<void> {
  const rawChatId = msg?.chat?.id?.toString?.() ?? '';
  if (!rawChatId) return;

  const chatId = rawChatId.replace(/^-100/, '').replace(/^-/, '');
  const threadId = normalizeThreadId(msg?.message_thread_id);
  const sender = msg?.from as any;
  const hasUserContent = Boolean(
    msg?.text ||
    msg?.caption ||
    msg?.photo ||
    msg?.document ||
    msg?.video ||
    msg?.voice ||
    msg?.audio ||
    msg?.animation ||
    msg?.sticker ||
    msg?.contact ||
    msg?.location ||
    msg?.poll ||
    msg?.venue ||
    msg?.dice
  );

  if (!hasUserContent) {
    emitListenerLog('info', `Bỏ qua service message ở chat ${chatId}.`, { step: 'filter' });
    return;
  }

  const messageText = msg.text || msg.caption || '';
  const sourceMessageId = Number(msg?.message_id ?? msg?.id);
  if (!Number.isInteger(sourceMessageId) || sourceMessageId <= 0) {
    emitListenerLog('error', 'Thiếu message_id từ Bot API, không thể ghi workflow log.', {
      step: 'db',
    });
    return;
  }
  console.log(`[BotListener] Bot API received message: "${messageText}" from chat ID: ${rawChatId} (normalized: ${chatId})`);

  if (sender?.is_bot) {
    console.log(`[BotListener] Ignoring bot-authored message in chat ${chatId}.`);
    emitListenerLog('info', `Bỏ qua tin nhắn do bot gửi trong chat ${chatId}.`, { step: 'filter' });
    return;
  }

  for (const listener of global.__activeListeners!.values()) {
    if (listener.normalizedSourceId !== chatId) continue;

    emitListenerLog('info', `Khớp nhóm nguồn ${chatId}. Kiểm tra topic...`, {
      automationId: listener.automationId,
      step: 'match',
    });

    const configuredThreadIds = listener.sourceThreadIds.length > 0
      ? listener.sourceThreadIds
      : listener.sourceThreadId !== null
        ? [listener.sourceThreadId]
        : [];

    if (configuredThreadIds.length > 0 && (threadId === null || !configuredThreadIds.includes(threadId))) {
      emitListenerLog('warn', `Bỏ qua do topic không khớp. Topic nhận được: ${threadId ?? 'root/general'}, topic cấu hình: ${configuredThreadIds.join(', ')}`, {
        automationId: listener.automationId,
        step: 'topic-filter',
      });
      continue;
    }

    const sourceRecognition = resolveSourceMessageRecognitionConfig(listener);
    const noticeBaseUrl = `https://api.telegram.org/bot${botToken || global.__globalBotToken}`;
    const incompleteNoticeKey = `${listener.automationId}:${chatId}:${threadId ?? 'root'}:${sender?.id ?? 'unknown'}`;
    if (!options?.forceProcess && sourceRecognition.enabled) {
      const matchResult = matchesSourceMessageRecognition(messageText, sourceRecognition);
      if (!matchResult.matched) {
        emitListenerLog('warn', `Bỏ qua tin nhắn vì không khớp dấu hiệu nhận dạng. Thiếu: ${matchResult.missingKeywords.join(', ')}`, {
          automationId: listener.automationId,
          step: 'message-filter',
        });

        // Chấm thiếu: bot báo thiếu thông tin và chờ tin nhắn bổ sung từ cùng người gửi.
        const prevNotice = global.__pendingIncompleteNotices!.get(incompleteNoticeKey);
        if (prevNotice) {
          await deleteTelegramMessage(noticeBaseUrl, {
            chat_id: prevNotice.chatId,
            message_id: prevNotice.noticeMsgId,
          }, 'stale incomplete attendance notice');
          global.__pendingIncompleteNotices!.delete(incompleteNoticeKey);
        }
        const noticeData = await sendTelegramMessageWithFallback(noticeBaseUrl, {
          chat_id: msg.chat.id,
          message_thread_id: msg.message_thread_id || undefined,
          reply_to_message_id: msg.message_id,
          text: `⚠️ Tin nhắn chấm công thiếu thông tin: ${matchResult.missingKeywords.join(', ')}. Vui lòng gửi tin nhắn bổ sung đầy đủ.`,
        }, 'incomplete attendance notice');
        if (noticeData.ok) {
          global.__pendingIncompleteNotices!.set(incompleteNoticeKey, {
            chatId: msg.chat.id,
            noticeMsgId: noticeData.result.message_id,
            createdAt: Date.now(),
          });
        }
        continue;
      }
    }

    // Tin nhắn bổ sung đã đủ thông tin: xóa thông báo "chấm thiếu" cũ đã gửi.
    const resolvedNotice = global.__pendingIncompleteNotices!.get(incompleteNoticeKey);
    if (resolvedNotice) {
      global.__pendingIncompleteNotices!.delete(incompleteNoticeKey);
      await deleteTelegramMessage(noticeBaseUrl, {
        chat_id: resolvedNotice.chatId,
        message_id: resolvedNotice.noticeMsgId,
      }, 'resolved incomplete attendance notice');
    }

    console.log(`[BotListener] Received trigger msg from chat ${chatId} (Thread: ${threadId})`);
    emitListenerLog('info', `Nhận tin nhắn trigger từ topic ${threadId ?? 'root/general'}.`, {
      automationId: listener.automationId,
      step: 'trigger',
    });

    console.log(`[BotListener] Trigger stage: resolving bot token for ${listener.automationId}`);
    emitListenerLog('info', 'Đang lấy bot token...', { automationId: listener.automationId, step: 'token' });
    const currentBotToken = botToken || global.__globalBotToken || await loadGlobalBotToken();
    if (!currentBotToken) {
      console.warn(`[BotListener] Global bot token is missing. Skipping forward for ${listener.automationId}.`);
      emitListenerLog('error', 'Thiếu bot token toàn cục, không thể tiếp tục.', {
        automationId: listener.automationId,
        step: 'token',
      });
      continue;
    }
    const activeBaseUrl = `https://api.telegram.org/bot${currentBotToken}`;
    emitListenerLog('info', 'Bot token sẵn sàng.', { automationId: listener.automationId, step: 'token' });

    const originalText = options?.overrideOriginalText ?? messageText;
    const originalThreadId = normalizeThreadId(msg?.message_thread_id);

    // Dedup check: ensure same message_id is not processed twice for the same automation
    const existingLog = await p.query(
      'SELECT id FROM workflow_logs WHERE automation_id = $1 AND original_msg_id = $2 LIMIT 1',
      [listener.automationId, sourceMessageId]
    );
    if (existingLog.rows.length > 0) {
      emitListenerLog('warn', `Bỏ qua tin nhắn #${sourceMessageId} vì đã được xử lý trước đó (workflow log #${existingLog.rows[0].id}).`, {
        automationId: listener.automationId,
        step: 'dedup',
      });
      continue;
    }

    console.log(`[BotListener] Trigger stage: writing workflow log for ${listener.automationId}`);
    emitListenerLog('info', 'Đang ghi workflow log...', { automationId: listener.automationId, step: 'db' });
    let logId: number;
    try {
      const msgIdsStr = Array.isArray(mediaGroupMsgIds) && mediaGroupMsgIds.length > 0
        ? mediaGroupMsgIds.join(',')
        : sourceMessageId.toString();

      const logRes = await p.query(
        `INSERT INTO workflow_logs (automation_id, original_chat_id, original_thread_id, original_msg_id, original_msg_ids, original_text, status, thread_root_msg_id)
         VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7)
         ON CONFLICT (automation_id, original_msg_id) DO NOTHING
         RETURNING id`,
        [listener.automationId, listener.sourceGroupId, originalThreadId, sourceMessageId, msgIdsStr, originalText, options?.threadRootMsgId ?? sourceMessageId]
      );
      if (logRes.rows.length === 0) {
        emitListenerLog('warn', `Bỏ qua tin nhắn #${sourceMessageId} do trùng lặp (ON CONFLICT).`, {
          automationId: listener.automationId,
          step: 'dedup',
        });
        continue;
      }
      logId = logRes.rows[0].id;
    } catch (insertErr: any) {
      // Fallback: unique constraint violation (race condition)
      if (insertErr.code === '23505') {
        emitListenerLog('warn', `Bỏ qua tin nhắn #${sourceMessageId} do trùng lặp (unique constraint).`, {
          automationId: listener.automationId,
          step: 'dedup',
        });
        continue;
      }
      throw insertErr;
    }
    emitListenerLog('info', `Đã tạo workflow log #${logId}.`, { automationId: listener.automationId, step: 'db' });

    let senderName = 'Unknown';
    try {
      senderName = [sender?.first_name, sender?.last_name].filter(Boolean).join(' ')
        || sender?.username
        || msg?.sender_chat?.title
        || 'Unknown';
    } catch {}
    await p.query(
      'UPDATE workflow_logs SET original_sender_name = $1 WHERE id = $2',
      [senderName, logId]
    );

    if (!listener.approvalGroupId) {
      console.warn(`[BotListener] Approval group is not configured for automation: ${listener.automationId}. Skipping message forward.`);
      emitListenerLog('error', 'Chưa cấu hình nhóm phê duyệt, dừng tại bước trigger.', {
        automationId: listener.automationId,
        step: 'approval',
      });

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

    const approvalTopicConfig = resolveApprovalTopicConfig(listener, threadId);

    console.log(`[BotListener] Trigger stage: sending approval prompt for log ${logId}`);
    emitListenerLog('info', `Đang gửi prompt phê duyệt vào nhóm ${listener.approvalGroupId}...`, {
      automationId: listener.automationId,
      step: 'approval',
    });
    const approvalDividerMsgId = await sendDividerMessageIfNeeded(activeBaseUrl, listener.approvalGroupId, listener.approvalThreadId || undefined, 'approval prompt');
    const apprData = await sendTelegramMessageWithFallback(activeBaseUrl, {
      chat_id: listener.approvalGroupId,
      message_thread_id: listener.approvalThreadId || undefined,
      text: withProjectTag(originalText, formatApprovalCustomMessagePlain(
        approvalTopicConfig.approvalCustomMessage,
        senderName,
        originalText
      )),
      reply_markup: {
        inline_keyboard: [
          [
            { text: approvalTopicConfig.approvalActionConfig.agreeButtonLabel, callback_data: `appr_agree:${logId}` },
            { text: approvalTopicConfig.approvalActionConfig.disagreeButtonLabel, callback_data: `appr_disagree:${logId}` }
          ]
        ]
      }
    }, 'approval prompt');
    emitListenerLog(
      apprData.ok ? 'info' : 'error',
      apprData.ok
        ? `Đã gửi prompt phê duyệt #${logId} thành công.`
        : `Gửi prompt phê duyệt thất bại: ${apprData.description || 'unknown error'}`,
      { automationId: listener.automationId, step: 'approval' }
    );
    if (apprData.ok) {
      await p.query(
        "UPDATE workflow_logs SET approval_msg_id = $1, approval_divider_msg_id = $2 WHERE id = $3",
        [apprData.result.message_id, approvalDividerMsgId, logId]
      );
    }

    const contentMethod = approvalTopicConfig.approvalMessageMode === 'copy' ? 'copyMessage' : 'forwardMessage';
    const contentLabel = approvalTopicConfig.approvalMessageMode === 'copy' ? 'approval copy' : 'approval forward';
    emitListenerLog(
      'info',
      approvalTopicConfig.approvalMessageMode === 'copy'
        ? 'Đang copy full nội dung gốc sang nhóm phê duyệt...'
        : 'Đang forward nội dung gốc sang nhóm phê duyệt...',
      { automationId: listener.automationId, step: 'content' }
    );
    const contentData = await sendTelegramMethodWithFallback(activeBaseUrl, contentMethod, {
      chat_id: listener.approvalGroupId,
      message_thread_id: listener.approvalThreadId || undefined,
      from_chat_id: listener.sourceGroupId,
      message_id: sourceMessageId,
      message_ids: mediaGroupMsgIds || [sourceMessageId],
    }, contentLabel);
    emitListenerLog(
      contentData.ok ? 'info' : 'error',
      contentData.ok
        ? `Đã ${approvalTopicConfig.approvalMessageMode === 'copy' ? 'copy' : 'forward'} nội dung gốc thành công.`
        : `Không thể ${approvalTopicConfig.approvalMessageMode === 'copy' ? 'copy' : 'forward'} nội dung gốc: ${contentData.description || 'unknown error'}`,
      { automationId: listener.automationId, step: 'content' }
    );

    if (contentData.ok) {
      const contentMsgIds: number[] = Array.isArray(contentData.result)
        ? contentData.result.map((r: any) => r?.message_id).filter((id: any): id is number => Number.isInteger(id))
        : Number.isInteger(contentData.result?.message_id)
          ? [contentData.result.message_id]
          : [];
      if (contentMsgIds.length > 0) {
        await p.query(
          "UPDATE workflow_logs SET approval_content_msg_ids = $1 WHERE id = $2",
          [contentMsgIds.join(','), logId]
        );
      }
    }

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
  }
}

// ---------------------------------------------------------------------------
// Start Listener for an automation setup
// ---------------------------------------------------------------------------
export async function startListenerForAutomation(automationId: string): Promise<void> {
  const setup = await loadAutomationSetup(automationId);
  if (!setup) throw new Error('Không tìm thấy cấu hình Automation.');

  removeLegacyGramjsListenerIfAny();

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
    sourceMessageRecognitionConfig: setup.sourceMessageRecognitionConfig,
    normalizedSourceId: normalized,
    approvalGroupId: setup.approvalGroupId,
    approvalThreadId: setup.approvalThreadId,
    approvalMessageMode: setup.approvalMessageMode,
    approvalCustomMessage: setup.approvalCustomMessage,
    approvalActionConfig: setup.approvalActionConfig,
    approvalTopicConfigs: setup.approvalTopicConfigs,
    supplyGroupId: setup.supplyGroupId,
    supplyThreadId: setup.supplyThreadId,
    supplyListenGroupId: setup.supplyListenGroupId,
    supplyListenThreadIds: setup.supplyListenThreadIds,
    supplyListenThreadId: setup.supplyListenThreadId,
    supplierRoutes: setup.supplierRoutes,
    deliveryGroupId: setup.deliveryGroupId,
    deliveryThreadId: setup.deliveryThreadId,
    finalMessageMode: setup.finalMessageMode,
    finalGroupId: setup.finalGroupId,
    finalThreadId: setup.finalThreadId,
    rejectGroupId: setup.rejectGroupId,
    rejectThreadId: setup.rejectThreadId,
    rejectCustomMessage: setup.rejectCustomMessage,
    rejectTopicConfigs: setup.rejectTopicConfigs,
    forwardCount: setup.forwardCount,
    lastForwardTime: setup.lastForwardTime,
  });

  // Start polling
  startBotPolling();

  console.log(`[BotListener] Started listener for automation ID: ${automationId}`);
  emitListenerLog('success', 'Listener đã được bật.', { automationId, step: 'listener' });
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
  emitListenerLog('warn', `Đã dừng listener cho automation ${automationId}.`, {
    automationId,
    step: 'listener',
  });
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
  form.append('chat_id', await resolveBotApiChatId(chatId));
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

async function resolveBotApiChatId(chatId: string): Promise<string> {
  if (!chatId) return chatId;
  if (chatId.startsWith('-100') || chatId.startsWith('-') || chatId.startsWith('@')) return chatId;
  if (!/^\d+$/.test(chatId)) return chatId;

  try {
    const db = await loadDatabase(false);
    const chat = db.chats[chatId];
    if (chat?.chatType === 'group') {
      return `-${chatId}`;
    }
    if (chat?.chatType === 'channel' || chat?.chatType === 'supergroup') {
      return `-100${chatId}`;
    }
  } catch (err: any) {
    console.warn(`[BotListener] resolveBotApiChatId fallback for ${chatId}: ${err?.message || err}`);
  }

  return `-100${chatId}`;
}

function addEmojiDivider(text: string): string {
  return text;
}

function formatApprovalCustomMessage(
  template: string,
  senderName: string,
  originalText: string
): string {
  const base = (template || DEFAULT_APPROVAL_CUSTOM_MESSAGE).trim() || DEFAULT_APPROVAL_CUSTOM_MESSAGE;
  return addEmojiDivider(base
    .replaceAll('{{senderName}}', senderName)
    .replaceAll('{{originalText}}', originalText || '[Hình ảnh/Tài liệu]'));
}

function formatApprovalDecisionMessage(
  template: string,
  userFullName: string,
  originalText: string
): string {
  const base = (template || '').trim();
  if (!base) {
    return '';
  }
  return base
    .replaceAll('{{userFullName}}', userFullName)
    .replaceAll('{{originalText}}', originalText || '[Hình ảnh/Tài liệu]');
}

function formatRejectCustomMessage(
  template: string,
  userFullName: string,
  senderName: string,
  originalText: string
): string {
  const base = (template || DEFAULT_REJECT_CUSTOM_MESSAGE).trim() || DEFAULT_REJECT_CUSTOM_MESSAGE;
  return addEmojiDivider(base
    .replaceAll('{{userFullName}}', userFullName)
    .replaceAll('{{senderName}}', senderName || 'Không rõ')
    .replaceAll('{{originalText}}', originalText || '[Hình ảnh/Tài liệu]'));
}

// Divider lines (START/END) were removed: unstable and visually cluttered.
// Kept as a no-op so existing call sites don't need to be touched.
async function sendDividerMessageIfNeeded(
  _baseUrl: string,
  _chatId: string | number,
  _threadId: number | null | undefined,
  _label: string,
  _kind: 'start' | 'end' = 'start'
): Promise<number | null> {
  return null;
}

function formatApprovalCustomMessagePlain(
  template: string,
  senderName: string,
  originalText: string
): string {
  const base = (template || DEFAULT_APPROVAL_CUSTOM_MESSAGE).trim() || DEFAULT_APPROVAL_CUSTOM_MESSAGE;
  return base
    .replaceAll('{{senderName}}', senderName)
    .replaceAll('{{originalText}}', originalText || '[Hình ảnh/Tài liệu]');
}

// Pull a short scannable "công trình" tag (the "CT: ..." line, or the first
// non-empty line as fallback) out of the source text so busy groups can tell
// requests apart at a glance without reading the full content.
function extractProjectTag(text: string): string {
  if (!text) return '';
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const ctLine = lines.find((l) => /^ct\s*[:.]/i.test(l));
  const tagLine = ctLine || lines[0] || '';
  return tagLine.length > 70 ? `${tagLine.slice(0, 67)}...` : tagLine;
}

function withProjectTag(originalText: string, body: string): string {
  const tag = extractProjectTag(originalText);
  return tag ? `🏗️ *${tag}*\n${body}` : body;
}

// Build the fixed "header" portion (project tag + custom approval message) of
// the single status message tracked per request, so it can be recomputed
// identically every time the status block is appended to.
function buildApprovalHeaderText(autoSetup: any, log: any): string {
  const approvalTopicConfig = resolveApprovalTopicConfig(autoSetup, normalizeThreadId(log.original_thread_id));
  return withProjectTag(log.original_text, formatApprovalCustomMessagePlain(
    approvalTopicConfig.approvalCustomMessage,
    log.original_sender_name || '',
    log.original_text || ''
  ));
}

// Append one line to the request's running status log and edit the single
// tracked message (log.approval_msg_id) in place, instead of deleting and
// recreating messages. Mutates log.status_log so subsequent calls within the
// same handler invocation see the latest accumulated text.
async function appendApprovalStatusLine(
  p: ReturnType<typeof getPool>,
  baseUrl: string,
  log: any,
  approvalGroupId: string | undefined | null,
  headerText: string,
  newLine: string,
  replyMarkup?: any
): Promise<void> {
  const existingLines = typeof log.status_log === 'string' && log.status_log.trim()
    ? log.status_log.split('\n').filter(Boolean)
    : [];
  const updatedLines = [...existingLines, newLine];
  const statusBlock = updatedLines.join('\n');
  const fullText = `${headerText}\n\n📋 *Trạng thái:*\n${statusBlock}`;

  if (log.approval_msg_id && approvalGroupId) {
    await editTelegramMessageWithFallback(baseUrl, {
      chat_id: approvalGroupId,
      message_id: log.approval_msg_id,
      text: fullText,
      reply_markup: replyMarkup || { inline_keyboard: [] },
    }, 'approval status update');
  }
  await p.query('UPDATE workflow_logs SET status_log = $1 WHERE id = $2', [statusBlock, log.id]);
  log.status_log = statusBlock;
}

function formatRejectCustomMessagePlain(
  template: string,
  userFullName: string,
  senderName: string,
  originalText: string
): string {
  const base = (template || DEFAULT_REJECT_CUSTOM_MESSAGE).trim() || DEFAULT_REJECT_CUSTOM_MESSAGE;
  return base
    .replaceAll('{{userFullName}}', userFullName)
    .replaceAll('{{senderName}}', senderName || 'Không rõ')
    .replaceAll('{{originalText}}', originalText || '[Hình ảnh/Tài liệu]');
}

function resolveApprovalActionConfig(autoSetup: any) {
  const cfg = autoSetup?.approvalActionConfig || {};
  return {
    hideAfterAction: cfg.hideAfterAction === true,
    refreshOnSourceReply: cfg.refreshOnSourceReply === true,
    deleteSourceMessageOnReply: cfg.deleteSourceMessageOnReply === true,
    attendanceSupplementReplyEnabled: cfg.attendanceSupplementReplyEnabled === true,
    agreeButtonLabel: typeof cfg.agreeButtonLabel === 'string' && cfg.agreeButtonLabel.trim()
      ? cfg.agreeButtonLabel.trim()
      : DEFAULT_APPROVAL_ACTION_CONFIG.agreeButtonLabel,
    disagreeButtonLabel: typeof cfg.disagreeButtonLabel === 'string' && cfg.disagreeButtonLabel.trim()
      ? cfg.disagreeButtonLabel.trim()
      : DEFAULT_APPROVAL_ACTION_CONFIG.disagreeButtonLabel,
    agreeResultMessage: typeof cfg.agreeResultMessage === 'string' && cfg.agreeResultMessage.trim()
      ? cfg.agreeResultMessage.trim()
      : DEFAULT_APPROVAL_ACTION_CONFIG.agreeResultMessage,
    disagreeResultMessage: typeof cfg.disagreeResultMessage === 'string' && cfg.disagreeResultMessage.trim()
      ? cfg.disagreeResultMessage.trim()
      : DEFAULT_APPROVAL_ACTION_CONFIG.disagreeResultMessage,
  };
}

function resolveApprovalTopicConfig(autoSetup: any, sourceThreadId: number | null): {
  approvalMessageMode: ApprovalMessageMode;
  approvalCustomMessage: string;
  approvalActionConfig: ReturnType<typeof resolveApprovalActionConfig>;
} {
  const base = {
    approvalMessageMode: (autoSetup?.approvalMessageMode === 'copy' ? 'copy' : 'forward') as ApprovalMessageMode,
    approvalCustomMessage: typeof autoSetup?.approvalCustomMessage === 'string' && autoSetup.approvalCustomMessage.trim()
      ? autoSetup.approvalCustomMessage.trim()
      : DEFAULT_APPROVAL_CUSTOM_MESSAGE,
    approvalActionConfig: resolveApprovalActionConfig(autoSetup),
  };

  if (sourceThreadId === null || !Array.isArray(autoSetup?.approvalTopicConfigs)) {
    return base;
  }

  const matched = autoSetup.approvalTopicConfigs.find((item: any) => normalizeThreadId(item?.sourceThreadId) === sourceThreadId);
  if (!matched) return base;

  return {
    approvalMessageMode: matched.approvalMessageMode === 'copy' ? 'copy' : base.approvalMessageMode,
    approvalCustomMessage: typeof matched.approvalCustomMessage === 'string' && matched.approvalCustomMessage.trim()
      ? matched.approvalCustomMessage.trim()
      : base.approvalCustomMessage,
    approvalActionConfig: matched.approvalActionConfig
      ? resolveApprovalActionConfig({ approvalActionConfig: matched.approvalActionConfig })
      : base.approvalActionConfig,
  };
}

function resolveRejectTopicConfig(autoSetup: any, sourceThreadId: number | null): {
  rejectCustomMessage: string;
} {
  const base = {
    rejectCustomMessage: typeof autoSetup?.rejectCustomMessage === 'string' && autoSetup.rejectCustomMessage.trim()
      ? autoSetup.rejectCustomMessage.trim()
      : DEFAULT_REJECT_CUSTOM_MESSAGE,
  };

  if (sourceThreadId === null || !Array.isArray(autoSetup?.rejectTopicConfigs)) {
    return base;
  }

  const matched = autoSetup.rejectTopicConfigs.find((item: any) => normalizeThreadId(item?.sourceThreadId) === sourceThreadId);
  if (!matched) return base;

  return {
    rejectCustomMessage: typeof matched.rejectCustomMessage === 'string' && matched.rejectCustomMessage.trim()
      ? matched.rejectCustomMessage.trim()
      : base.rejectCustomMessage,
  };
}

function resolveSourceMessageRecognitionConfig(autoSetup: any): SourceMessageRecognitionConfig {
  const cfg = autoSetup?.sourceMessageRecognitionConfig || {};
  const requiredKeywords = Array.isArray(cfg.requiredKeywords)
    ? cfg.requiredKeywords
      .map((item: unknown) => (typeof item === 'string' ? item.trim() : ''))
      .filter(Boolean)
    : DEFAULT_SOURCE_MESSAGE_RECOGNITION_CONFIG.requiredKeywords;

  return {
    enabled: cfg.enabled !== false,
    requiredKeywords: requiredKeywords.length > 0
      ? Array.from(new Set(requiredKeywords))
      : DEFAULT_SOURCE_MESSAGE_RECOGNITION_CONFIG.requiredKeywords,
  };
}

function matchesSourceMessageRecognition(
  messageText: string,
  config: SourceMessageRecognitionConfig
): { matched: boolean; missingKeywords: string[] } {
  if (!config.enabled) {
    return { matched: true, missingKeywords: [] };
  }

  const normalizedMessage = (messageText || '').toLocaleLowerCase('vi-VN');
  const missingKeywords = config.requiredKeywords.filter((keyword) => {
    const normalizedKeyword = keyword.toLocaleLowerCase('vi-VN').trim();
    return normalizedKeyword.length > 0 && !normalizedMessage.includes(normalizedKeyword);
  });

  return {
    matched: missingKeywords.length === 0,
    missingKeywords,
  };
}

function normalizeComparableChatId(chatId: string | number | null | undefined): string {
  if (chatId === null || chatId === undefined) return '';
  return String(chatId).replace(/^-100/, '').replace(/^-/, '');
}

function matchesSourceReplyRefreshScope(
  actualChatId: string,
  actualThreadId: number | null,
  autoSetup: any,
  log: any
): { matched: boolean; reason: string } {
  const expectedGroupId = normalizeComparableChatId(log.original_chat_id || autoSetup.sourceGroupId);
  const expectedThreadId = normalizeThreadId(log.original_thread_id);
  const normalizedActualChatId = normalizeComparableChatId(actualChatId);

  if (!expectedGroupId || normalizedActualChatId !== expectedGroupId) {
    return {
      matched: false,
      reason: `reply chat=${normalizedActualChatId || 'unknown'} không khớp group nguồn ${expectedGroupId || 'unknown'}`,
    };
  }

  if (expectedThreadId === null) {
    if (actualThreadId !== null) {
      return {
        matched: false,
        reason: `reply topic=${actualThreadId} không khớp General`,
      };
    }
    return { matched: true, reason: 'Khớp group nguồn / General' };
  }

  if (actualThreadId !== expectedThreadId) {
    return {
      matched: false,
      reason: `reply topic=${actualThreadId ?? 'general'} không khớp topic nguồn ${expectedThreadId}`,
    };
  }

  return {
    matched: true,
    reason: `Khớp group ${expectedGroupId} / topic ${expectedThreadId}`,
  };
}

function formatSourceReplyRefreshText(
  originalText: string,
  replyText: string,
  senderFullName: string
): string {
  const originalBlock = originalText?.trim() ? originalText.trim() : '[Không có nội dung cũ]';
  const replyBlock = replyText?.trim() ? replyText.trim() : '[Hình ảnh/Tài liệu]';
  return `Yêu cầu cũ:\n${originalBlock}\n\nCập nhật mới từ ${senderFullName}:\n${replyBlock}`;
}

function resolveSupplyListenScope(autoSetup: any): { groupId: string; threadIds: number[] } {
  const groupId = normalizeComparableChatId(autoSetup.supplyListenGroupId || '');
  const threadIds = Array.from(new Set([
    ...(Array.isArray(autoSetup.supplyListenThreadIds) ? normalizeThreadIds(autoSetup.supplyListenThreadIds) : []),
    autoSetup.supplyListenThreadId,
    autoSetup.supplyThreadId,
  ].map((item) => normalizeThreadId(item)).filter((item): item is number => item !== null)));

  return { groupId, threadIds };
}

function matchesSupplyListenScope(autoSetup: any, log: any): { matched: boolean; reason: string } {
  const scope = resolveSupplyListenScope(autoSetup);
  const actualGroupId = normalizeComparableChatId(log.original_chat_id);
  const actualThreadId = normalizeThreadId(log.original_thread_id);

  if (scope.groupId && actualGroupId !== scope.groupId) {
    return {
      matched: false,
      reason: `Tin gốc thuộc group ${actualGroupId || 'unknown'}, không khớp group lắng nghe ${scope.groupId}`,
    };
  }

  if (scope.threadIds.length > 0) {
    if (actualThreadId === null || !scope.threadIds.includes(actualThreadId)) {
      return {
        matched: false,
        reason: `Tin gốc thuộc topic ${actualThreadId ?? 'general'}, không khớp topic lắng nghe ${scope.threadIds.join(', ')}`,
      };
    }
  }

  return {
    matched: true,
    reason: scope.groupId
      ? `Khớp group ${scope.groupId}${scope.threadIds.length > 0 ? ` / topic ${scope.threadIds.join(', ')}` : ''}`
      : 'Chưa cấu hình group/topic lắng nghe riêng, nhận theo scope mặc định',
  };
}

function matchesSupplyListenReplyScope(
  actualChatId: string | number | null | undefined,
  actualThreadId: number | null,
  autoSetup: any,
  log: any
): { matched: boolean; reason: string } {
  const scope = resolveSupplyListenScope(autoSetup);
  const expectedGroupId = scope.groupId || normalizeComparableChatId(log.original_chat_id);
  const normalizedActualChatId = normalizeComparableChatId(actualChatId);

  if (expectedGroupId && normalizedActualChatId !== expectedGroupId) {
    return {
      matched: false,
      reason: `Reply chat=${normalizedActualChatId || 'unknown'} khÃ´ng khá»›p group theo dÃµi ${expectedGroupId}`,
    };
  }

  if (scope.threadIds.length > 0) {
    if (actualThreadId === null || !scope.threadIds.includes(actualThreadId)) {
      return {
        matched: false,
        reason: `Reply topic=${actualThreadId ?? 'general'} khÃ´ng khá»›p danh sÃ¡ch topic theo dÃµi ${scope.threadIds.join(', ')}`,
      };
    }
  }

  return {
    matched: true,
    reason: expectedGroupId
      ? `Khá»›p group ${expectedGroupId}${scope.threadIds.length > 0 ? ` / topic ${scope.threadIds.join(', ')}` : ' / táº¥t cáº£ topic'}`
      : 'Khá»›p pháº¡m vi nghe reply máº·c Ä‘á»‹nh',
  };
}

function matchesDeliveryReplyScope(
  actualChatId: string | number | null | undefined,
  autoSetup: any,
  log: any
): boolean {
  const expectedGroupId = normalizeComparableChatId(log.delivery_group_id || autoSetup.deliveryGroupId);
  const normalizedActualChatId = normalizeComparableChatId(actualChatId);
  return !!expectedGroupId && normalizedActualChatId === expectedGroupId;
}

function matchesSupplyChangeReplyScope(
  actualChatId: string | number | null | undefined,
  actualThreadId: number | null,
  autoSetup: any,
  log: any
): { matched: boolean; reason: string } {
  const sourceGroupIds = Array.from(new Set([
    autoSetup.supplyListenGroupId,
    autoSetup.supplyChangeGroupId,
    log.selected_supplier_group_id,
    autoSetup.supplyGroupId,
  ].map((item) => normalizeComparableChatId(item)).filter(Boolean)));
  const expectedThreadIds = Array.from(new Set([
    ...(Array.isArray(autoSetup.supplyListenThreadIds) ? normalizeThreadIds(autoSetup.supplyListenThreadIds) : []),
    autoSetup.supplyListenThreadId,
    autoSetup.supplyChangeThreadId,
    log.selected_supplier_thread_id,
    autoSetup.supplyThreadId,
  ].map((item) => normalizeThreadId(item)).filter((item): item is number => item !== null)));
  const normalizedActualChatId = normalizeComparableChatId(actualChatId);

  if (sourceGroupIds.length === 0) {
    return {
      matched: false,
      reason: 'không có group nguồn để nhận reply thay đổi',
    };
  }

  if (!sourceGroupIds.includes(normalizedActualChatId)) {
    return {
      matched: false,
      reason: `chat không khớp, nhận ${normalizedActualChatId || 'unknown'}, cấu hình ${sourceGroupIds.join(', ')}`,
    };
  }

  if (expectedThreadIds.length > 0 && (actualThreadId === null || !expectedThreadIds.includes(actualThreadId))) {
    return {
      matched: false,
      reason: `topic không khớp, nhận ${actualThreadId ?? 'general'}, cấu hình ${expectedThreadIds.join(', ')}`,
    };
  }

  return {
    matched: true,
    reason: 'khớp phạm vi reply thay đổi',
  };
}

function resolveSupplyListenTarget(autoSetup: any, log: any): {
  groupIds: string[];
  threadIds: number[];
  groupId: string;
  threadId: number | null;
} {
  const groupIds = Array.from(new Set([
    log.supply_prompt_group_id,
    log.selected_supplier_group_id,
    autoSetup.supplyListenGroupId,
    autoSetup.supplyGroupId,
  ].map((item) => normalizeComparableChatId(item)).filter(Boolean)));

  const threadIds = Array.from(new Set([
    ...(Array.isArray(log.supply_prompt_thread_id) ? normalizeThreadIds(log.supply_prompt_thread_id) : []),
    log.supply_prompt_thread_id,
    ...(Array.isArray(autoSetup.supplyListenThreadIds) ? normalizeThreadIds(autoSetup.supplyListenThreadIds) : []),
    autoSetup.supplyListenThreadId,
    log.selected_supplier_thread_id,
    autoSetup.supplyThreadId,
  ].map((item) => normalizeThreadId(item)).filter((item): item is number => item !== null)));

  return {
    groupIds,
    groupId: groupIds[0] ?? '',
    threadIds,
    threadId: threadIds[0] ?? null,
  };
}

function matchesSupplyListenGroup(actualChatId: string | number | null | undefined, autoSetup: any, log: any): boolean {
  const actual = normalizeComparableChatId(actualChatId);
  if (!actual) return false;
  const target = resolveSupplyListenTarget(autoSetup, log);
  return target.groupIds.includes(actual);
}

function matchesSupplyListenThread(actualThreadId: number | null, autoSetup: any, log: any): boolean {
  const target = resolveSupplyListenTarget(autoSetup, log);
  if (target.threadIds.length === 0) return true;
  return actualThreadId !== null && target.threadIds.includes(actualThreadId);
}

function resolveApprovalRejectTarget(autoSetup: any): { groupId: string; threadId: number | null; usedFallback: boolean } {
  const groupId = autoSetup.rejectGroupId || autoSetup.approvalGroupId || '';
  const threadId = autoSetup.rejectThreadId ?? autoSetup.approvalThreadId ?? null;
  return {
    groupId,
    threadId,
    usedFallback: !autoSetup.rejectGroupId && !!autoSetup.approvalGroupId,
  };
}

function resolveSupplyRejectTarget(autoSetup: any, log: any): { groupId: string; threadId: number | null; usedFallback: boolean } {
  const groupId = autoSetup.rejectGroupId || log.selected_supplier_group_id || autoSetup.supplyGroupId || '';
  const threadId = autoSetup.rejectThreadId ?? log.selected_supplier_thread_id ?? autoSetup.supplyThreadId ?? null;
  return {
    groupId,
    threadId,
    usedFallback: !autoSetup.rejectGroupId && !!groupId,
  };
}

function getConfiguredSupplierRoutes(autoSetup: any): SupplierRoute[] {
  const routes = Array.isArray(autoSetup?.supplierRoutes) ? autoSetup.supplierRoutes : [];
  if (routes.length > 0) {
    return routes;
  }

  if (autoSetup?.supplyGroupId) {
    return [
      {
        id: 'legacy-supply',
        name: 'Nhà cung ứng mặc định',
        groupId: autoSetup.supplyGroupId,
        threadId: autoSetup.supplyThreadId ?? null,
        messageMode: autoSetup.approvalMessageMode === 'copy' ? 'copy' : 'forward',
      },
    ];
  }

  return [];
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function sendTelegramJson(
  baseUrl: string,
  method: string,
  payload: Record<string, unknown>,
  attempt = 1
): Promise<{ ok: boolean; result?: any; description?: string }> {
  const maxRetries = 3;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000); // Tăng timeout lên 12s cho các album/ảnh lớn

  try {
    console.log(`[BotListener] Telegram ${method} -> sending (attempt ${attempt}/${maxRetries})...`);
    const normalizedPayload = { ...payload };
    if (normalizedPayload.chat_id !== undefined) {
      normalizedPayload.chat_id = await resolveBotApiChatId(String(normalizedPayload.chat_id));
    }
    if (normalizedPayload.from_chat_id !== undefined) {
      normalizedPayload.from_chat_id = await resolveBotApiChatId(String(normalizedPayload.from_chat_id));
    }
    const res = await fetch(`${baseUrl}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(normalizedPayload),
      signal: controller.signal,
    });

    // Xử lý Rate Limit (429) từ Telegram
    if (res.status === 429) {
      const data = await res.json() as any;
      const retryAfter = Number(data?.parameters?.retry_after || 3);
      console.warn(`[BotListener] Telegram Rate Limit (429) on ${method}. Waiting for ${retryAfter}s before retry.`);
      if (attempt < maxRetries) {
        await delay((retryAfter * 1000) + 500);
        return sendTelegramJson(baseUrl, method, payload, attempt + 1);
      }
      return data;
    }

    const data = await res.json() as any;
    if (!data.ok) {
      console.warn(`[BotListener] Telegram ${method} failed:`, data.description || JSON.stringify(data));
      // Nếu server lỗi tạm thời (HTTP 5xx), thực hiện thử lại
      if (res.status >= 500 && attempt < maxRetries) {
        const backoff = Math.pow(2, attempt) * 1000;
        await delay(backoff);
        return sendTelegramJson(baseUrl, method, payload, attempt + 1);
      }
    } else {
      console.log(`[BotListener] Telegram ${method} ok.`);
    }
    return data;
  } catch (error: any) {
    const message = error?.name === 'AbortError' ? 'request timeout after 12s' : (error?.message || String(error));
    console.warn(`[BotListener] Telegram ${method} error (attempt ${attempt}/${maxRetries}): ${message}`);
    
    // Thử lại nếu lỗi kết nối mạng (FetchError, Timeout) và chưa vượt quá số lần thử lại
    if (attempt < maxRetries) {
      const backoff = Math.pow(2, attempt) * 1000;
      await delay(backoff);
      return sendTelegramJson(baseUrl, method, payload, attempt + 1);
    }
    return { ok: false, description: message };
  } finally {
    clearTimeout(timeout);
  }
}

async function sendTelegramMethodWithFallback(
  baseUrl: string,
  method: 'forwardMessage' | 'copyMessage',
  payload: Record<string, unknown>,
  label: string
): Promise<{ ok: boolean; result?: any; description?: string }> {
  // Nếu nhận được mảng message_ids, sử dụng copyMessages hoặc forwardMessages của Telegram API
  if (Array.isArray(payload.message_ids) && payload.message_ids.length > 0) {
    const multiMethod = method === 'forwardMessage' ? 'forwardMessages' : 'copyMessages';
    const multiPayload = { ...payload };
    delete multiPayload.message_id; // Xóa message_id đơn lẻ

    console.log(`[BotListener] Sending multiple messages (${multiMethod}): ${payload.message_ids.join(', ')}`);
    const primary = await sendTelegramJson(baseUrl, multiMethod, multiPayload);
    if (primary.ok) return primary;

    // Retry fallback không có message_thread_id
    const threadId = multiPayload.message_thread_id;
    if (threadId !== undefined) {
      const fallbackPayload = { ...multiPayload };
      delete fallbackPayload.message_thread_id;
      console.warn(`[BotListener] Retrying ${label} (multi) without message_thread_id fallback.`);
      const fallbackResult = await sendTelegramJson(baseUrl, multiMethod, fallbackPayload);
      if (fallbackResult.ok) return fallbackResult;
    }

    // Fallback nếu API telegram không hỗ trợ multi: gửi tuần tự từng ID
    console.warn(`[BotListener] Multi-message send failed, falling back to sequential sending.`);
    let lastResult: any = { ok: false, description: 'No messages to send' };
    for (const msgId of payload.message_ids) {
      const singlePayload = { ...payload };
      delete singlePayload.message_ids;
      singlePayload.message_id = msgId;
      lastResult = await sendTelegramMethodWithFallback(baseUrl, method, singlePayload, `${label} fallback msgId ${msgId}`);
    }
    return lastResult;
  }

  const primary = await sendTelegramJson(baseUrl, method, payload);
  if (primary.ok) return primary;

  const threadId = payload.message_thread_id;
  if (threadId !== undefined) {
    const fallbackPayload = { ...payload };
    delete fallbackPayload.message_thread_id;
    console.warn(`[BotListener] Retrying ${label} without message_thread_id fallback.`);
    return sendTelegramJson(baseUrl, method, fallbackPayload);
  }

  return primary;
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

async function editTelegramMessageWithFallback(
  baseUrl: string,
  payload: Record<string, unknown>,
  label: string
): Promise<{ ok: boolean; result?: any; description?: string }> {
  const primary = await sendTelegramJson(baseUrl, 'editMessageText', payload);
  if (primary.ok) return primary;

  console.warn(`[BotListener] Failed to edit ${label}: ${primary.description || 'unknown error'}`);
  return primary;
}

async function deleteTelegramMessage(
  baseUrl: string,
  payload: Record<string, unknown>,
  label: string
): Promise<{ ok: boolean; result?: any; description?: string }> {
  const result = await sendTelegramJson(baseUrl, 'deleteMessage', payload);
  if (!result.ok) {
    console.warn(`[BotListener] Failed to delete ${label}: ${result.description || 'unknown error'}`);
  }
  return result;
}

// React to a message (e.g. ❤️) instead of sending a separate ack text message.
async function reactToTelegramMessage(
  baseUrl: string,
  chatId: string | number,
  messageId: number,
  label: string,
  emoji: string = '❤'
): Promise<{ ok: boolean; result?: any; description?: string }> {
  const result = await sendTelegramJson(baseUrl, 'setMessageReaction', {
    chat_id: chatId,
    message_id: messageId,
    reaction: [{ type: 'emoji', emoji }],
  });
  if (!result.ok) {
    console.warn(`[BotListener] Failed to react to ${label}: ${result.description || 'unknown error'}`);
  }
  return result;
}

// Remove any reaction the bot previously set on a message (used to signal "this
// reply is invalid / can't proceed" instead of silently ignoring it).
async function unreactTelegramMessage(
  baseUrl: string,
  chatId: string | number,
  messageId: number,
  label: string
): Promise<{ ok: boolean; result?: any; description?: string }> {
  const result = await sendTelegramJson(baseUrl, 'setMessageReaction', {
    chat_id: chatId,
    message_id: messageId,
    reaction: [],
  });
  if (!result.ok) {
    console.warn(`[BotListener] Failed to clear reaction on ${label}: ${result.description || 'unknown error'}`);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Escape special chars for Telegram MarkdownV2 (unused now since we use default text parsing, but kept for helper logic if needed)
// ---------------------------------------------------------------------------
function escapeMd(text: string): string {
  return text.replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, '\\$&');
}
