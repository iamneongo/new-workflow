import { NextRequest, NextResponse } from 'next/server';
import {
  loadGlobalBotToken,
  saveGlobalBotToken,
  loadGlobalSetting,
  saveGlobalSetting,
} from '@/lib/database';

export const dynamic = 'force-dynamic';

const MESSAGE_DIVIDER_SETTING_KEY = 'message_divider_text';
const DEFAULT_MESSAGE_DIVIDER_TEXT = '💠 ─────────────────────── 💠';

/**
 * GET /api/bot-config
 * Returns the masked global bot token and the shared divider text.
 */
export async function GET() {
  try {
    const token = await loadGlobalBotToken();
    const dividerText = await loadGlobalSetting(MESSAGE_DIVIDER_SETTING_KEY);

    return NextResponse.json({
      hasToken: !!token,
      token: token ? `****${token.slice(-6)}` : '',
      dividerText: typeof dividerText === 'string' ? dividerText : DEFAULT_MESSAGE_DIVIDER_TEXT,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

/**
 * POST /api/bot-config
 * Body: { token?, dividerText? }
 * Saves the global bot token and divider text.
 */
export async function POST(req: NextRequest) {
  try {
    const { token, dividerText } = await req.json();
    if (!token && dividerText === undefined) {
      return NextResponse.json({ error: 'Thiếu dữ liệu cần lưu' }, { status: 400 });
    }

    let currentToken = await loadGlobalBotToken();
    if (typeof token === 'string' && token.trim()) {
      if (!token.startsWith('****')) {
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
    }

    const existingDividerText = await loadGlobalSetting(MESSAGE_DIVIDER_SETTING_KEY);
    const normalizedDividerText = typeof dividerText === 'string'
      ? dividerText
      : (typeof existingDividerText === 'string' ? existingDividerText : DEFAULT_MESSAGE_DIVIDER_TEXT);
    await saveGlobalSetting(MESSAGE_DIVIDER_SETTING_KEY, normalizedDividerText);

    return NextResponse.json({
      success: true,
      token: currentToken ? `****${currentToken.slice(-6)}` : '',
      dividerText: normalizedDividerText,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
