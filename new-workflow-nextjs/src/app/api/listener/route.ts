import { NextRequest, NextResponse } from 'next/server';
import { loadAutomationSetup } from '@/lib/database';
import {
  startListenerForAutomation,
  stopListenerForAutomation,
  isListenerActiveForAutomation,
  getListenerStatsForAutomation,
} from '@/lib/bot-listener';

export const dynamic = 'force-dynamic';

/**
 * GET /api/listener?automationId=...
 * Returns listener status and stats for a specific automation ID.
 * If automationId is omitted, returns a list of all active automation IDs.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const automationId = searchParams.get('automationId');

  if (!automationId) {
    // Return all active automation IDs
    const activeList = Array.from(global.__activeListeners?.keys() || []);
    return NextResponse.json({ activeListeners: activeList });
  }

  const setup = await loadAutomationSetup(automationId);
  if (!setup) {
    return NextResponse.json({ error: 'Không tìm thấy automation setup' }, { status: 404 });
  }

  const stats = getListenerStatsForAutomation(automationId);

  return NextResponse.json({
    active: isListenerActiveForAutomation(automationId),
    automationId: setup.id,
    name: setup.name,
    sourceGroupId: setup.sourceGroupId,
    destGroupId: setup.destGroupId,
    hasToken: !!setup.botToken,
    forwardCount: stats.count,
    lastForwardTime: stats.lastTime,
  });
}

/**
 * POST /api/listener
 * Body: { action: 'start' | 'stop', automationId }
 */
export async function POST(req: NextRequest) {
  try {
    const { action, automationId } = await req.json();

    if (!automationId) {
      return NextResponse.json({ error: 'Thiếu tham số automationId' }, { status: 400 });
    }

    if (action === 'stop') {
      await stopListenerForAutomation(automationId);
      return NextResponse.json({ success: true, active: false });
    }

    if (action === 'start') {
      const setup = await loadAutomationSetup(automationId);
      if (!setup) {
        return NextResponse.json({ error: 'Không tìm thấy cấu hình' }, { status: 404 });
      }

      if (!setup.botToken) {
        return NextResponse.json(
          { error: 'Chưa cấu hình Bot Token cho Automation này.' },
          { status: 400 }
        );
      }
      if (!setup.sourceGroupId) {
        return NextResponse.json(
          { error: 'Chưa chọn nhóm nguồn (Source) cho Automation này.' },
          { status: 400 }
        );
      }

      await startListenerForAutomation(automationId);

      return NextResponse.json({ success: true, active: true });
    }

    return NextResponse.json({ error: 'Action không hợp lệ (start | stop)' }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
