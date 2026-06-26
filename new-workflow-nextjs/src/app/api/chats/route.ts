import { NextResponse } from 'next/server';
import { loadDatabase } from '@/lib/database';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const db = await loadDatabase(false);
    const publicChats = Object.fromEntries(
      Object.entries(db.chats).map(([chatId, chat]) => {
        const { photoData, photoMime, ...publicChat } = chat;
        return [chatId, publicChat];
      })
    );
    return NextResponse.json(publicChats);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
