import { NextResponse } from 'next/server';
import { ensureDatabase, getPool } from '@/lib/database';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(
  _request: Request,
  { params }: any
) {
  try {
    const chatId = decodeURIComponent(params.chatId);
    await ensureDatabase();
    const pool = getPool();
    const result = await pool.query(
      'SELECT photo_data, photo_mime FROM chats WHERE chat_id = $1 LIMIT 1',
      [chatId]
    );

    const row = result.rows[0];
    const photoData = typeof row?.photo_data === 'string' && row.photo_data.length > 0 ? row.photo_data : null;
    if (!photoData) {
      return NextResponse.json({ error: 'Photo not found' }, { status: 404 });
    }

    const photoMime =
      typeof row?.photo_mime === 'string' && row.photo_mime.trim()
        ? row.photo_mime.trim()
        : 'image/jpeg';
    const buffer = Buffer.from(photoData, 'base64');

    return new Response(buffer, {
      headers: {
        'Content-Type': photoMime,
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
