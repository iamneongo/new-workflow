import { NextRequest, NextResponse } from 'next/server';
import {
  loadGlobalBotToken,
  saveGlobalBotToken,
} from '@/lib/database';

export const dynamic = 'force-dynamic';

/**
 * GET /api/bot-config
 * Returns the masked global bot token.
 */
export async function GET() {
  try {
    const token = await loadGlobalBotToken();

    return NextResponse.json({
      hasToken: !!token,
      token: token ? `****${token.slice(-6)}` : '',
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

/**
 * POST /api/bot-config
 * Body: { token }
 * Saves the global bot token.
 */
export async function POST(req: NextRequest) {
  try {
    const { token } = await req.json();
    if (!token) {
      return NextResponse.json({ error: 'Thiếu dữ liệu cần lưu' }, { status: 400 });
    }

    let currentToken = await loadGlobalBotToken();
    if (typeof token === 'string' && token.trim() && !token.startsWith('****')) {
      if (!/^\d+:[A-Za-z0-9_-]{35,}$/.test(token)) {
        return NextResponse.json(
          { error: 'Token không đúng định dạng. Ví dụ: 123456789:ABCdefGHI...' },
          { status: 400 }
        );
      }

      await saveGlobalBotToken(token);
      global.__globalBotToken = token;
      currentToken = token;
    }

    return NextResponse.json({
      success: true,
      token: currentToken ? `****${currentToken.slice(-6)}` : '',
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
