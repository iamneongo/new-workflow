import { NextRequest, NextResponse } from 'next/server';
import { loadDatabase, saveDatabase } from '@/lib/database';
import { sendSseUpdate } from '@/lib/telegram';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { chatId, threadId, newName } = body;

    if (!chatId || threadId === undefined || !newName) {
      return NextResponse.json(
        { error: 'Thiếu thông tin chatId, threadId hoặc newName' },
        { status: 400 }
      );
    }

    const db = await loadDatabase();

    if (db.chats[chatId] && db.chats[chatId].topics[threadId]) {
      db.chats[chatId].topics[threadId].topicName = newName;
      db.chats[chatId].topics[threadId].lastUpdated = Date.now();
      await saveDatabase(db);

      sendSseUpdate({ type: 'syncComplete' });
      return NextResponse.json({ success: true });
    }

    return NextResponse.json(
      { error: 'Không tìm thấy Group hoặc Topic tương ứng' },
      { status: 404 }
    );
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
