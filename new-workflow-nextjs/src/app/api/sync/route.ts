import { NextResponse } from 'next/server';
import { isSyncing, syncTelegramData } from '@/lib/telegram';

export const dynamic = 'force-dynamic';

export async function POST() {
  if (isSyncing()) {
    return NextResponse.json(
      { error: 'Tiến trình đồng bộ đang chạy...' },
      { status: 409 }
    );
  }

  // Run sync in background
  syncTelegramData().catch((err) => {
    console.error('[Sync API] Unhandled error:', err);
  });

  return NextResponse.json({ success: true, message: 'Bắt đầu đồng bộ hóa...' });
}
