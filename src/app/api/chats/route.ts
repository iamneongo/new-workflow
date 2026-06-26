import { NextResponse } from 'next/server';
import { loadDatabase } from '@/lib/database';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const db = await loadDatabase();
    return NextResponse.json(db.chats);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
