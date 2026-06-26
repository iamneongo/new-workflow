import { NextResponse } from 'next/server';
import { ensureDatabase, getPool } from '@/lib/database';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(
  _request: Request,
  context: any
) {
  try {
    const params = await Promise.resolve(context?.params);
    const chatId = decodeURIComponent(String(params?.chatId || ''));
    await ensureDatabase();
    const pool = getPool();
    const result = await pool.query(
      'SELECT photo_data, photo_mime FROM chats WHERE chat_id = $1 LIMIT 1',
      [chatId]
    );

    const row = result.rows[0];
    const rawPhotoData = row?.photo_data;
    let buffer: Buffer | null = null;

    if (Buffer.isBuffer(rawPhotoData)) {
      buffer = rawPhotoData;
    } else if (typeof rawPhotoData === 'string' && rawPhotoData.length > 0) {
      buffer = Buffer.from(rawPhotoData, 'base64');
    } else if (rawPhotoData instanceof Uint8Array && rawPhotoData.length > 0) {
      buffer = Buffer.from(rawPhotoData);
    }

    if (!buffer || buffer.length === 0) {
      return NextResponse.json({ error: 'Photo not found' }, { status: 404 });
    }

    const photoMime =
      typeof row?.photo_mime === 'string' && row.photo_mime.trim()
        ? row.photo_mime.trim()
        : 'image/jpeg';

    return new Response(new Uint8Array(buffer), {
      headers: {
        'Content-Type': photoMime,
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
