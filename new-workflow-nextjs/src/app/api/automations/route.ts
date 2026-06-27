import { NextRequest, NextResponse } from 'next/server';
import { loadAutomationSetup, loadAutomationSetups, saveAutomationSetup, AutomationSetup, saveGlobalBotToken, normalizeThreadId } from '@/lib/database';
import { startListenerForAutomation, stopListenerForAutomation } from '@/lib/bot-listener';

export const dynamic = 'force-dynamic';

/**
 * GET /api/automations
 * Returns all custom automation setups (with masked tokens mapped from global token).
 */
export async function GET() {
  try {
    const setups = await loadAutomationSetups();
    const masked = setups.map((s) => ({
      ...s,
      botToken: s.botToken ? `****${s.botToken.slice(-6)}` : '',
      hasToken: !!s.botToken,
    }));
    return NextResponse.json(masked);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

/**
 * POST /api/automations
 * Body: { id, name?, botToken?, sourceGroupId?, destGroupId? }
 * Creates or updates an automation setup. If botToken is provided, updates the global bot token.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      id, name, botToken, sourceGroupId, sourceThreadId, sourceThreadIds,
      approvalGroupId, approvalThreadId, approvalMessageMode, approvalCustomMessage,
      supplyGroupId, supplyThreadId, supplyListenGroupId, supplyListenThreadId, supplyChangeGroupId, supplyChangeThreadId, supplyChangeMessageMode, supplierRoutes,
      deliveryGroupId, deliveryThreadId,
      finalMessageMode,
      finalGroupId, finalThreadId,
      rejectGroupId, rejectThreadId,
      restartIfListening = true,
    } = body;

    if (!id) {
      return NextResponse.json({ error: 'Thiếu tham số id' }, { status: 400 });
    }

    // Update global bot token if provided
    if (botToken !== undefined && botToken !== '') {
      if (botToken.startsWith('****')) {
        // Masked token, user did not change it. Ignore.
      } else {
        // Validate token format before saving
        if (!/^\d+:[A-Za-z0-9_-]{35,}$/.test(botToken)) {
          return NextResponse.json(
            { error: 'Token không đúng định dạng. Ví dụ: 123456789:ABCdefGHI...' },
            { status: 400 }
          );
        }
        await saveGlobalBotToken(botToken);
        // Sync RAM cache immediately
        global.__globalBotToken = botToken;
      }
    }

    const updates: Partial<AutomationSetup> & { id: string } = { id };
    if (name !== undefined) updates.name = name;
    if (sourceGroupId !== undefined) updates.sourceGroupId = sourceGroupId;
    if (sourceThreadIds !== undefined) {
      updates.sourceThreadIds = sourceThreadIds;
    } else if (sourceThreadId !== undefined) {
      updates.sourceThreadId = normalizeThreadId(sourceThreadId);
    }
    if (approvalGroupId !== undefined) updates.approvalGroupId = approvalGroupId;
    if (approvalThreadId !== undefined) updates.approvalThreadId = normalizeThreadId(approvalThreadId);
    if (approvalMessageMode !== undefined) updates.approvalMessageMode = approvalMessageMode;
    if (approvalCustomMessage !== undefined) updates.approvalCustomMessage = approvalCustomMessage;
    if (supplyGroupId !== undefined) updates.supplyGroupId = supplyGroupId;
    if (supplyThreadId !== undefined) updates.supplyThreadId = normalizeThreadId(supplyThreadId);
    if (supplyListenGroupId !== undefined) updates.supplyListenGroupId = supplyListenGroupId;
    if (supplyListenThreadId !== undefined) updates.supplyListenThreadId = normalizeThreadId(supplyListenThreadId);
    if (supplyChangeGroupId !== undefined) updates.supplyChangeGroupId = supplyChangeGroupId;
    if (supplyChangeThreadId !== undefined) updates.supplyChangeThreadId = normalizeThreadId(supplyChangeThreadId);
    if (supplyChangeMessageMode !== undefined) updates.supplyChangeMessageMode = supplyChangeMessageMode;
    if (supplierRoutes !== undefined) updates.supplierRoutes = supplierRoutes;
    if (deliveryGroupId !== undefined) updates.deliveryGroupId = deliveryGroupId;
    if (deliveryThreadId !== undefined) updates.deliveryThreadId = normalizeThreadId(deliveryThreadId);
    if (finalMessageMode !== undefined) updates.finalMessageMode = finalMessageMode;
    if (finalGroupId !== undefined) updates.finalGroupId = finalGroupId;
    if (finalThreadId !== undefined) updates.finalThreadId = normalizeThreadId(finalThreadId);
    if (rejectGroupId !== undefined) updates.rejectGroupId = rejectGroupId;
    if (rejectThreadId !== undefined) updates.rejectThreadId = normalizeThreadId(rejectThreadId);
    
    // Maintain destGroupId for compatibility
    if (supplyGroupId !== undefined) updates.destGroupId = supplyGroupId;

    const current = await loadAutomationSetup(id);
    const wasListening = current?.isListening ?? false;
    const updated = await saveAutomationSetup(updates);

    if (wasListening && restartIfListening) {
      await stopListenerForAutomation(id);
      await startListenerForAutomation(id);
    }

    return NextResponse.json({
      success: true,
      restarted: wasListening && restartIfListening,
      setup: {
        ...updated,
        botToken: updated.botToken ? `****${updated.botToken.slice(-6)}` : '',
        hasToken: !!updated.botToken,
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
