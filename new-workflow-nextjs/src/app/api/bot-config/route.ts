import { NextRequest, NextResponse } from 'next/server';
import {
  loadGlobalBotToken,
  saveGlobalBotToken,
  loadGlobalSetting,
  saveGlobalSetting,
} from '@/lib/database';

export const dynamic = 'force-dynamic';

const MESSAGE_DIVIDER_START_SETTING_KEY = 'message_divider_start_text';
const MESSAGE_DIVIDER_END_SETTING_KEY = 'message_divider_end_text';
const DEFAULT_MESSAGE_DIVIDER_START_TEXT = '┄┄┄┄┄┄┄┄┄┄ 🔹 START 🔹 ┄┄┄┄┄┄┄┄┄┄';
const DEFAULT_MESSAGE_DIVIDER_END_TEXT = '┄┄┄┄┄┄┄┄┄┄ 🔸 END 🔸 ┄┄┄┄┄┄┄┄┄┄';

/**
 * GET /api/bot-config
 * Returns the masked global bot token and the shared start/end divider text.
 */
export async function GET() {
  try {
    const token = await loadGlobalBotToken();
    const dividerStartText = await loadGlobalSetting(MESSAGE_DIVIDER_START_SETTING_KEY);
    const dividerEndText = await loadGlobalSetting(MESSAGE_DIVIDER_END_SETTING_KEY);

    return NextResponse.json({
      hasToken: !!token,
      token: token ? `****${token.slice(-6)}` : '',
      dividerStartText: typeof dividerStartText === 'string' ? dividerStartText : DEFAULT_MESSAGE_DIVIDER_START_TEXT,
      dividerEndText: typeof dividerEndText === 'string' ? dividerEndText : DEFAULT_MESSAGE_DIVIDER_END_TEXT,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

/**
 * POST /api/bot-config
 * Body: { token?, dividerStartText?, dividerEndText? }
 * Saves the global bot token and start/end divider text.
 */
export async function POST(req: NextRequest) {
  try {
    const { token, dividerStartText, dividerEndText } = await req.json();
    if (!token && dividerStartText === undefined && dividerEndText === undefined) {
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

    const existingStartText = await loadGlobalSetting(MESSAGE_DIVIDER_START_SETTING_KEY);
    const normalizedStartText = typeof dividerStartText === 'string'
      ? dividerStartText
      : (typeof existingStartText === 'string' ? existingStartText : DEFAULT_MESSAGE_DIVIDER_START_TEXT);
    await saveGlobalSetting(MESSAGE_DIVIDER_START_SETTING_KEY, normalizedStartText);

    const existingEndText = await loadGlobalSetting(MESSAGE_DIVIDER_END_SETTING_KEY);
    const normalizedEndText = typeof dividerEndText === 'string'
      ? dividerEndText
      : (typeof existingEndText === 'string' ? existingEndText : DEFAULT_MESSAGE_DIVIDER_END_TEXT);
    await saveGlobalSetting(MESSAGE_DIVIDER_END_SETTING_KEY, normalizedEndText);

    return NextResponse.json({
      success: true,
      token: currentToken ? `****${currentToken.slice(-6)}` : '',
      dividerStartText: normalizedStartText,
      dividerEndText: normalizedEndText,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
