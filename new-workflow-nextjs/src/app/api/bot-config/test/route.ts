import { NextRequest, NextResponse } from 'next/server';
import { testBotToken } from '@/lib/bot-listener';

export const dynamic = 'force-dynamic';

/**
 * POST /api/bot-config/test
 * Body: { token: string }
 * Tests whether the given bot token is valid via Telegram's getMe API.
 */
export async function POST(req: NextRequest) {
  try {
    const { token } = await req.json();
    if (!token) {
      return NextResponse.json({ error: 'Thiếu token' }, { status: 400 });
    }

    const result = await testBotToken(token);
    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
