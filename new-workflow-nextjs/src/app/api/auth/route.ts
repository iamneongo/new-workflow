import { NextRequest, NextResponse } from 'next/server';
import { resolveAuthInput, getTelegramClient, syncTelegramData, isSyncing, logoutTelegramClient } from '@/lib/telegram';

export const dynamic = 'force-dynamic';

/**
 * POST /api/auth
 * Body: { action: 'connect' | 'logout' | 'phone' | 'code' | 'password', value?: string }
 *
 * - 'connect': Starts the Telegram client (triggers auth flow if no session)
 * - 'logout': Destroys the current Telegram session and clears local state
 * - 'phone' | 'code' | 'password': Provides the requested auth value
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action, value } = body;

    if (action === 'connect') {
      // Start Telegram client in background
      getTelegramClient()
        .then(() => {
          if (!isSyncing()) {
            syncTelegramData();
          }
        })
        .catch((err) => {
          console.error('[Auth] Connect error:', err);
        });

      return NextResponse.json({ success: true, message: 'Đang kết nối Telegram...' });
    }

    if (action === 'logout') {
      await logoutTelegramClient();
      return NextResponse.json({ success: true, message: 'Đã đăng xuất Telegram.' });
    }

    if (action === 'phone' || action === 'code' || action === 'password') {
      if (!value) {
        return NextResponse.json({ error: 'Thiếu giá trị value' }, { status: 400 });
      }
      const resolved = resolveAuthInput(action, value);
      if (!resolved) {
        return NextResponse.json(
          { error: `Không có yêu cầu ${action} đang chờ` },
          { status: 400 }
        );
      }
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: 'Action không hợp lệ' }, { status: 400 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
