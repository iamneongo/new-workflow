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
  loadDatabase,
  getPool,
  normalizeThreadId,
  normalizeThreadIds,
  ApprovalMessageMode,
  FinalMessageMode,
  SupplierRoute,
  DEFAULT_APPROVAL_CUSTOM_MESSAGE,
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
  approvalMessageMode: ApprovalMessageMode;
  approvalCustomMessage: string;
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
}

// Initialize active listeners Map if not present
if (!global.__activeListeners) {
  global.__activeListeners = new Map();
}
if (!global.__processingCallbackActions) {
  global.__processingCallbackActions = new Set();
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
          normalizedSourceId: normalized,
          approvalGroupId: setup.approvalGroupId,
          approvalThreadId: setup.approvalThreadId,
          approvalMessageMode: setup.approvalMessageMode,
          approvalCustomMessage: setup.approvalCustomMessage,
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

async function handleBotUpdate(update: any) {
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

          const supplierRoutes = getConfiguredSupplierRoutes(autoSetup);
          const isCtMessage = isSupplierRoutingMessage(log.original_text || '');
          emitListenerLog('info', `Kiểm tra luồng CT: ${isCtMessage ? 'khớp' : 'không khớp'} - ${explainSupplierRoutingMatch(log.original_text || '')}`, {
            automationId: log.automation_id,
            step: 'supplier-select',
          });

          if (isCtMessage && supplierRoutes.length > 0) {
            await p.query("UPDATE workflow_logs SET status = 'supplier_selecting' WHERE id = $1", [logId]);

            const selectionText = `🏭 *CHỌN NHÀ CUNG ỨNG*\n\n${log.original_text || '[Media]'}\n\nHãy chọn nhà cung ứng để tiếp tục gửi yêu cầu.`;
            emitListenerLog('info', `CT message: hiển thị danh sách ${supplierRoutes.length} nhà cung ứng để chọn.`, {
              automationId: log.automation_id,
              step: 'supplier-select',
            });
            const selectionData = await sendTelegramMessageWithFallback(baseUrl, {
              chat_id: cq.message.chat.id,
              message_thread_id: cq.message.message_thread_id || autoSetup.approvalThreadId || undefined,
              text: selectionText,
              reply_markup: {
                inline_keyboard: supplierRoutes.map((route) => ([
                  { text: route.name, callback_data: `supplier_select:${logId}:${route.id}` },
                ])),
              }
            }, 'supplier selection prompt');

            if (selectionData.ok) {
              await p.query(
                "UPDATE workflow_logs SET supplier_selection_msg_id = $1 WHERE id = $2",
                [selectionData.result.message_id, logId]
              );
            }
            return;
          }

          if (isCtMessage) {
            emitListenerLog('warn', 'Tin CT không có nhà cung ứng cấu hình hợp lệ, không thể mở nhánh supplier.', {
              automationId: log.automation_id,
              step: 'supplier-select',
            });
            await updateCallbackStatus('❌ Chưa cấu hình nhà cung ứng cho tin CT này.', 'callback missing supplier route');
          } else {
            emitListenerLog('info', 'Tin nhắn không phải CT vật tư, dừng ở bước phê duyệt và không đi sang supplier.', {
              automationId: log.automation_id,
              step: 'supplier-select',
            });
            await updateCallbackStatus(`ℹ️ Tin này không thuộc flow CT nên bot dừng ở bước phê duyệt.\n${explainSupplierRoutingMatch(log.original_text || '')}`, 'callback non-ct approval');
          }
          return;

        } else if (action === 'appr_disagree') {
          if (log.status !== 'pending') {
            await updateCallbackStatus('⚠️ Lựa chọn này đã được xử lý trước đó.', 'callback stale reject');
            return;
          }

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
          const rejectText = `❌ *THÔNG BÁO TỪ CHỐI PHÊ DUYỆT*\n\nYêu cầu vật tư đã bị từ chối phê duyệt bởi ${userFullName}.\nNội dung: ${log.original_text || '[Media]'}`;
          await sendTelegramMessageWithFallback(baseUrl, {
            chat_id: rejectTarget.groupId,
            message_thread_id: rejectTarget.threadId || undefined,
            text: rejectText,
          }, 'reject notice');

        } else if (action === 'supplier_select') {
          if (parts.length < 3) {
            await updateCallbackStatus('❌ Thiếu thông tin nhà cung ứng đã chọn.', 'callback missing supplier id');
            return;
          }
          const routeId = parts[2];
          const supplierRoutes = getConfiguredSupplierRoutes(autoSetup);
          const selectedRoute = supplierRoutes.find((route) => route.id === routeId);
          if (!selectedRoute) {
            await updateCallbackStatus('❌ Nhà cung ứng đã chọn không còn hợp lệ.', 'callback invalid supplier');
            return;
          }

          if (!isSupplierRoutingMessage(log.original_text || '')) {
            await updateCallbackStatus('⚠️ Nội dung gốc không phải CT vật tư nên bot không mở nhánh supplier.', 'callback non-ct supplier');
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

          if (callbackChatId && callbackMessageId) {
            await editTelegramMessageWithFallback(baseUrl, {
              chat_id: callbackChatId,
              message_id: callbackMessageId,
              text: `${originalCleanText}\n\n⏳ Đã chọn ${selectedRoute.name}, đang chuyển nội dung...`,
              reply_markup: { inline_keyboard: [] },
            }, 'supplier ack');
          }

          void (async () => {
          const supplyText = `💬 *YÊU CẦU CUNG CẤP VẬT TƯ*\n\nNội dung: ${log.original_text || '[Media]'}\n\nVui lòng lựa chọn phương án:`;
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

          const sendMethod: 'forwardMessage' | 'copyMessage' = selectedRoute.messageMode === 'copy' ? 'copyMessage' : 'forwardMessage';
          const contentPromise = sendTelegramMethodWithFallback(baseUrl, sendMethod, {
            chat_id: selectedRoute.groupId,
            message_thread_id: selectedRoute.threadId || undefined,
            from_chat_id: log.original_chat_id,
            message_id: log.original_msg_id,
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
            if (callbackChatId && callbackMessageId) {
              await editTelegramMessageWithFallback(baseUrl, {
                chat_id: callbackChatId,
                message_id: callbackMessageId,
                text: `${originalCleanText}\n\n❌ Không gửi được prompt đến ${selectedRoute.name}.${promptHint ? `\n${promptHint}` : ''}`,
                reply_markup: { inline_keyboard: [] },
              }, 'supplier prompt fail');
            }
            return;
          }

          await p.query(
            `UPDATE workflow_logs
             SET status = 'supply_sent',
                 supply_msg_id = $1,
                 supplier_route_id = $2,
                 selected_supplier_group_id = $3,
                 selected_supplier_thread_id = $4
             WHERE id = $5`,
            [
              promptData.result.message_id,
              selectedRoute.id,
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
            if (callbackChatId && callbackMessageId) {
              await editTelegramMessageWithFallback(baseUrl, {
                chat_id: callbackChatId,
                message_id: callbackMessageId,
                text: `${originalCleanText}\n\n⚠️ Đã chọn ${selectedRoute.name}, nhưng chưa chuyển được nội dung.${contentHint ? `\n${contentHint}` : ''}`,
                reply_markup: { inline_keyboard: [] },
              }, 'supplier content fail');
            }
            return;
          }

          if (callbackChatId && callbackMessageId) {
            await editTelegramMessageWithFallback(baseUrl, {
              chat_id: callbackChatId,
              message_id: callbackMessageId,
              text: `${originalCleanText}\n\n✅ *ĐÃ CHỌN NHÀ CUNG ỨNG:* ${selectedRoute.name}`,
              reply_markup: { inline_keyboard: [] },
            }, 'supplier final ack');
          }
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
          await updateCallbackStatus('❌ Chưa cấu hình nhóm giao nhận.', 'callback missing delivery group');
          return;
        }
        const deliveryText = `📦 *THÔNG BÁO GIAO NHẬN VẬT TƯ*\n\nVật tư đang được vận chuyển đến công trình.\n👉 *YÊU CẦU:* Khi nhận được vật tư, vui lòng *REPLY* trực tiếp vào tin nhắn này để nghiệm thu.`;
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

        const changeRequestGroupId = autoSetup.supplyChangeGroupId || log.selected_supplier_group_id || autoSetup.supplyGroupId;
        const changeRequestThreadId = autoSetup.supplyChangeThreadId || log.selected_supplier_thread_id || autoSetup.supplyThreadId || undefined;
        if (isChange && !changeRequestGroupId) {
          console.warn(`[BotListener] Change request group is not configured for automation: ${log.automation_id}. Cannot send change request notice.`);
          await updateCallbackStatus('❌ Chưa cấu hình nhóm nhận thông báo thay đổi vật tư.', 'callback missing change group');
          return;
        }

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
        const rejectText = isChange
          ? `🔄 *THÔNG BÁO YÊU CẦU THAY ĐỔI VẬT TƯ*\n\nPhương án: Yêu cầu thay đổi vật tư bởi ${userFullName}\nNội dung ban đầu: ${log.original_text || '[Media]'}\n\n👉 *Hãy REPLY trực tiếp vào tin nhắn này.* Bot sẽ chuyển nội dung phản hồi sang group đã cấu hình để mọi người cùng biết nhà cung ứng muốn thay đổi gì.`
          : `❌ *THÔNG BÁO TỪ CHỐI CUNG CẤP VẬT TƯ*\n\nPhương án: Từ chối cung cấp vật tư bởi ${userFullName}\nNội dung ban đầu: ${log.original_text || '[Media]'}`;
        const rejectData = await sendTelegramMessageWithFallback(baseUrl, {
          chat_id: isChange ? changeRequestGroupId : rejectTarget.groupId,
          message_thread_id: isChange ? changeRequestThreadId : (rejectTarget.threadId || undefined),
          text: rejectText,
        }, 'reject/change notice');
        if (isChange && rejectData.ok) {
          await p.query("UPDATE workflow_logs SET supply_change_msg_id = $1 WHERE id = $2", [rejectData.result.message_id, logId]);
        }
      }
      } finally {
        global.__processingCallbackActions!.delete(actionKey);
      }
    }

    // 2. New message trigger handler
    if (update.message) {
      await handleBotMessageTrigger(update.message, p, token);
    }

    // 3. Reply to delivery message handler
    if (update.message && update.message.reply_to_message) {
      const msg = update.message;
      const replyToMsgId = msg.reply_to_message.message_id;
      const chatId = msg.chat.id.toString();

      emitListenerLog('info', `Nhận reply trong group ${chatId} tới message #${replyToMsgId}.`, {
        step: 'delivery-reply',
      });

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
          const normLogGroup = normalizeComparableChatId(log.delivery_group_id || autoSetup.deliveryGroupId);
          const normChatId = normalizeComparableChatId(chatId);
          if (normLogGroup !== normChatId) {
            emitListenerLog('warn', `Bỏ qua reply delivery do chat không khớp. Reply chat=${chatId}, config=${autoSetup.deliveryGroupId}.`, {
              automationId: log.automation_id,
              step: 'delivery-reply',
            });
            continue;
          }

          await p.query("UPDATE workflow_logs SET status = 'completed' WHERE id = $1", [log.id]);

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

          await sendTelegramMessageWithFallback(baseUrl, {
            chat_id: msg.chat.id,
            message_thread_id: msg.message_thread_id || undefined,
            reply_to_message_id: msg.message_id,
            text: '✅ Bot đã nhận phản hồi nghiệm thu và đang chuyển đến nhóm tổng hợp.',
          }, 'delivery reply ack');

          const finalHeader = `✅ *NGHIỆM THU VẬT TƯ HOÀN TẤT*\n\nYêu cầu: "${log.original_text || '[Media]'}"\n\nĐã được nghiệm thu thành công bởi *${senderFullName}*\nPhản hồi sẽ được chuyển tiếp bên dưới bằng chế độ *${autoSetup.finalMessageMode === 'copy' ? 'COPY' : 'FORWARD'}*.`;
          await sendTelegramMessageWithFallback(baseUrl, {
            chat_id: autoSetup.finalGroupId,
            message_thread_id: autoSetup.finalThreadId || undefined,
            text: finalHeader,
          }, 'final header');

          const finalContentMethod: 'copyMessage' | 'forwardMessage' = autoSetup.finalMessageMode === 'copy' ? 'copyMessage' : 'forwardMessage';
          await sendTelegramMethodWithFallback(baseUrl, finalContentMethod, {
            chat_id: autoSetup.finalGroupId,
            message_thread_id: autoSetup.finalThreadId || undefined,
            from_chat_id: msg.chat.id,
            message_id: msg.message_id,
          }, 'final relay content');

          console.log(`[BotListener] Workflow log ${log.id} successfully completed & notified!`);
        }
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

          const sourceGroupIds = Array.from(new Set([
            autoSetup.supplyListenGroupId,
            autoSetup.supplyChangeGroupId,
            log.selected_supplier_group_id,
            autoSetup.supplyGroupId,
          ].map((item) => normalizeComparableChatId(item)).filter(Boolean)));
          const sourceGroupId = sourceGroupIds[0] || '';
          if (!sourceGroupId) {
            emitListenerLog('warn', `Không có group nguồn để relay reply thay đổi cho automation ${log.automation_id}.`, {
              automationId: log.automation_id,
              step: 'supply-change-reply',
            });
            continue;
          }

          const expectedThreadIds = Array.from(new Set([
            ...(Array.isArray(autoSetup.supplyListenThreadIds) ? normalizeThreadIds(autoSetup.supplyListenThreadIds) : []),
            autoSetup.supplyListenThreadId,
            autoSetup.supplyChangeThreadId,
            log.selected_supplier_thread_id,
            autoSetup.supplyThreadId,
          ].map((item) => normalizeThreadId(item)).filter((item): item is number => item !== null)));
          const normChatId = normalizeComparableChatId(chatId);
          if (!sourceGroupIds.includes(normChatId)) {
            emitListenerLog('warn', `Bỏ qua reply change do chat không khớp. Reply chat=${chatId}, config=${sourceGroupIds.join(', ')}.`, {
              automationId: log.automation_id,
              step: 'supply-change-reply',
            });
            continue;
          }
          if (expectedThreadIds.length > 0 && (replyThreadId === null || !expectedThreadIds.includes(replyThreadId))) {
            emitListenerLog('warn', `Bỏ qua reply change do topic không khớp. Reply topic=${replyThreadId ?? 'general'}, config=${expectedThreadIds.join(', ')}.`, {
              automationId: log.automation_id,
              step: 'supply-change-reply',
            });
            continue;
          }

          const senderFullName = [msg.from?.first_name, msg.from?.last_name].filter(Boolean).join(' ') || msg.from?.username || 'Thành viên';
          const replyText = msg.text || msg.caption || '';
          const relayHeader = `🔄 *NHÀ CUNG ỨNG YÊU CẦU THAY ĐỔI VẬT TƯ*\n\n*Người phản hồi:* ${senderFullName}\n*Nội dung phản hồi:* ${replyText || '[Media]'}\n\nNội dung chi tiết bên dưới được bot chuyển tiếp từ tin nhắn reply.`;
          const relayMode: 'copyMessage' | 'forwardMessage' = autoSetup.supplyChangeMessageMode === 'copy' ? 'copyMessage' : 'forwardMessage';
          const relayThreadId = autoSetup.supplyChangeThreadId || autoSetup.supplyThreadId || undefined;

          const relayData = await sendTelegramMessageWithFallback(baseUrl, {
            chat_id: targetGroupId,
            message_thread_id: relayThreadId,
            text: relayHeader,
          }, 'supply change relay header');

          if (relayData.ok) {
            await sendTelegramMethodWithFallback(baseUrl, relayMode, {
              chat_id: targetGroupId,
              message_thread_id: relayThreadId,
              from_chat_id: msg.chat.id,
              message_id: msg.message_id,
            }, 'supply change relay content');
          }
        }
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
  botToken: string
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

    const originalText = messageText;
    console.log(`[BotListener] Trigger stage: writing workflow log for ${listener.automationId}`);
    emitListenerLog('info', 'Đang ghi workflow log...', { automationId: listener.automationId, step: 'db' });
    const logRes = await p.query(
      `INSERT INTO workflow_logs (automation_id, original_chat_id, original_msg_id, original_text, status)
       VALUES ($1, $2, $3, $4, 'pending') RETURNING id`,
      [listener.automationId, listener.sourceGroupId, sourceMessageId, originalText]
    );
    const logId = logRes.rows[0].id;
    emitListenerLog('info', `Đã tạo workflow log #${logId}.`, { automationId: listener.automationId, step: 'db' });

    let senderName = 'Unknown';
    try {
      senderName = [sender?.first_name, sender?.last_name].filter(Boolean).join(' ')
        || sender?.username
        || msg?.sender_chat?.title
        || 'Unknown';
    } catch {}

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

    const approvalText = formatApprovalCustomMessage(
      listener.approvalCustomMessage,
      senderName,
      originalText
    );

    console.log(`[BotListener] Trigger stage: sending approval prompt for log ${logId}`);
    emitListenerLog('info', `Đang gửi prompt phê duyệt vào nhóm ${listener.approvalGroupId}...`, {
      automationId: listener.automationId,
      step: 'approval',
    });
    const apprData = await sendTelegramMessageWithFallback(activeBaseUrl, {
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
    emitListenerLog(
      apprData.ok ? 'info' : 'error',
      apprData.ok
        ? `Đã gửi prompt phê duyệt #${logId} thành công.`
        : `Gửi prompt phê duyệt thất bại: ${apprData.description || 'unknown error'}`,
      { automationId: listener.automationId, step: 'approval' }
    );
    if (apprData.ok) {
      await p.query("UPDATE workflow_logs SET approval_msg_id = $1 WHERE id = $2", [apprData.result.message_id, logId]);
    }

    const contentMethod = listener.approvalMessageMode === 'copy' ? 'copyMessage' : 'forwardMessage';
    const contentLabel = listener.approvalMessageMode === 'copy' ? 'approval copy' : 'approval forward';
    emitListenerLog(
      'info',
      listener.approvalMessageMode === 'copy'
        ? 'Đang copy full nội dung gốc sang nhóm phê duyệt...'
        : 'Đang forward nội dung gốc sang nhóm phê duyệt...',
      { automationId: listener.automationId, step: 'content' }
    );
    const contentData = await sendTelegramMethodWithFallback(activeBaseUrl, contentMethod, {
      chat_id: listener.approvalGroupId,
      message_thread_id: listener.approvalThreadId || undefined,
      from_chat_id: listener.sourceGroupId,
      message_id: sourceMessageId,
    }, contentLabel);
    emitListenerLog(
      contentData.ok ? 'info' : 'error',
      contentData.ok
        ? `Đã ${listener.approvalMessageMode === 'copy' ? 'copy' : 'forward'} nội dung gốc thành công.`
        : `Không thể ${listener.approvalMessageMode === 'copy' ? 'copy' : 'forward'} nội dung gốc: ${contentData.description || 'unknown error'}`,
      { automationId: listener.automationId, step: 'content' }
    );

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
    normalizedSourceId: normalized,
    approvalGroupId: setup.approvalGroupId,
    approvalThreadId: setup.approvalThreadId,
    approvalMessageMode: setup.approvalMessageMode,
    approvalCustomMessage: setup.approvalCustomMessage,
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

function formatApprovalCustomMessage(
  template: string,
  senderName: string,
  originalText: string
): string {
  const base = (template || DEFAULT_APPROVAL_CUSTOM_MESSAGE).trim() || DEFAULT_APPROVAL_CUSTOM_MESSAGE;
  return base
    .replaceAll('{{senderName}}', senderName)
    .replaceAll('{{originalText}}', originalText || '[Hình ảnh/Tài liệu]');
}

type SupplierRoutingMatch = {
  isMatch: boolean;
  reason: string;
};

function parseSupplierRoutingMessage(text: string): SupplierRoutingMatch {
  const normalized = (text || '').replace(/\r\n/g, '\n').trim();
  if (!normalized) {
    return { isMatch: false, reason: 'Thiếu nội dung tin nhắn' };
  }

  const lines = normalized
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const firstLine = lines[0] || '';
  if (!/^CT\s*:/i.test(firstLine)) {
    return { isMatch: false, reason: 'Thiếu: CT ở đầu tin nhắn' };
  }

  const hasHmLine = lines.slice(1).some((line) => /^HM\s*:/i.test(line));
  if (!hasHmLine) {
    return { isMatch: false, reason: 'Thiếu dòng HM' };
  }

  const numberedItemCount = lines.slice(1).filter((line) => /^\d+\s*[.)]/.test(line)).length;
  if (numberedItemCount === 0) {
    return { isMatch: false, reason: 'Thiếu danh sách vật tư đánh số' };
  }

  return { isMatch: true, reason: 'Đủ điều kiện CT' };
}

function isSupplierRoutingMessage(text: string): boolean {
  return parseSupplierRoutingMessage(text).isMatch;
}

function explainSupplierRoutingMatch(text: string): string {
  return parseSupplierRoutingMessage(text).reason;
}

function normalizeComparableChatId(chatId: string | number | null | undefined): string {
  if (chatId === null || chatId === undefined) return '';
  return String(chatId).replace(/^-100/, '').replace(/^-/, '');
}

function resolveSupplyListenTarget(autoSetup: any, log: any): {
  groupIds: string[];
  threadIds: number[];
  groupId: string;
  threadId: number | null;
} {
  const groupIds = Array.from(new Set([
    autoSetup.supplyListenGroupId,
    log.selected_supplier_group_id,
    autoSetup.supplyGroupId,
  ].map((item) => normalizeComparableChatId(item)).filter(Boolean)));

  const threadIds = Array.from(new Set([
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

async function sendTelegramMethodWithFallback(
  baseUrl: string,
  method: 'forwardMessage' | 'copyMessage',
  payload: Record<string, unknown>,
  label: string
): Promise<{ ok: boolean; result?: any; description?: string }> {
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

// ---------------------------------------------------------------------------
// Escape special chars for Telegram MarkdownV2 (unused now since we use default text parsing, but kept for helper logic if needed)
// ---------------------------------------------------------------------------
function escapeMd(text: string): string {
  return text.replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, '\\$&');
}
