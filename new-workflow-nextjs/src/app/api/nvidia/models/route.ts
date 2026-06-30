import { NextResponse } from 'next/server';
import { NVIDIA_API_KEY, NVIDIA_BASE_URL } from '@/lib/nvidia';

export const dynamic = 'force-dynamic';

export async function GET() {
  if (!NVIDIA_API_KEY) {
    return NextResponse.json(
      { error: 'Thiếu NVIDIA_API_KEY trong .env.local.' },
      { status: 500 }
    );
  }

  const response = await fetch(`${NVIDIA_BASE_URL}/models`, {
    headers: {
      Authorization: `Bearer ${NVIDIA_API_KEY}`,
      Accept: 'application/json',
    },
    cache: 'no-store',
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    return NextResponse.json(
      {
        error:
          payload?.error?.message ||
          payload?.message ||
          'Không lấy được danh sách model từ NVIDIA.',
      },
      { status: response.status }
    );
  }

  const rawModels = Array.isArray(payload.data) ? payload.data : [];
  const models = rawModels
    .map((item: any) => {
      const id = String(item.id || item.name || item.model_id || '').trim();
      if (!id) return null;
      return {
        id,
        label: String(item.name || item.id || item.model_id || id),
      };
    })
    .filter(Boolean);

  return NextResponse.json({ models });
}
