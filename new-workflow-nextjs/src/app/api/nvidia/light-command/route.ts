import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  NVIDIA_API_KEY,
  NVIDIA_BASE_URL,
  buildSystemPrompt,
  extractFirstJsonObject,
} from '@/lib/nvidia';

export const dynamic = 'force-dynamic';

const RequestSchema = z.object({
  prompt: z.string().min(1),
  model: z.string().optional(),
  context: z
    .object({
      deviceName: z.string().optional(),
      serviceUuid: z.string().optional(),
      characteristicUuid: z.string().optional(),
      commandMode: z.enum(['text', 'hex', 'json']).optional(),
      lightState: z
        .object({
          power: z.boolean(),
          brightness: z.number(),
          color: z.string(),
        })
        .optional(),
    })
    .optional(),
});

const AiResultSchema = z.object({
  action: z.enum(['turn_on', 'turn_off', 'toggle', 'set_brightness', 'set_color', 'status', 'none']),
  brightness: z.number().int().min(1).max(100).nullable().optional(),
  color: z.string().regex(/^#[0-9A-F]{6}$/i).nullable().optional(),
  reply: z.string().min(1),
  confidence: z.number().min(0).max(1).nullable().optional(),
});

async function resolveModel(requestedModel?: string) {
  if (requestedModel?.trim()) {
    return requestedModel.trim();
  }

  const fallbackModel = process.env.NVIDIA_MODEL?.trim();
  if (fallbackModel) {
    return fallbackModel;
  }

  const modelsResponse = await fetch(`${NVIDIA_BASE_URL}/models`, {
    headers: {
      Authorization: `Bearer ${NVIDIA_API_KEY}`,
      Accept: 'application/json',
    },
    cache: 'no-store',
  });

  const payload = await modelsResponse.json().catch(() => ({}));
  if (!modelsResponse.ok) {
    throw new Error(
      payload?.error?.message ||
        payload?.message ||
        'Không thể lấy model mặc định từ NVIDIA.'
    );
  }

  const firstModel = Array.isArray(payload.data) ? payload.data[0] : null;
  const resolved = String(firstModel?.id || firstModel?.name || '').trim();
  if (!resolved) {
    throw new Error('NVIDIA không trả về model khả dụng nào.');
  }

  return resolved;
}

export async function POST(req: NextRequest) {
  if (!NVIDIA_API_KEY) {
    return NextResponse.json(
      { error: 'Thiếu NVIDIA_API_KEY trong .env.local.' },
      { status: 500 }
    );
  }

  const body = await req.json().catch(() => ({}));
  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Payload không hợp lệ.' }, { status: 400 });
  }

  const model = await resolveModel(parsed.data.model);
  const systemPrompt = buildSystemPrompt(parsed.data.context || {}, model);

  const response = await fetch(`${NVIDIA_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${NVIDIA_API_KEY}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      model,
      temperature: 0.1,
      max_tokens: 256,
      messages: [
        {
          role: 'system',
          content: systemPrompt,
        },
        {
          role: 'user',
          content: parsed.data.prompt,
        },
      ],
    }),
    cache: 'no-store',
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    return NextResponse.json(
      {
        error:
          payload?.error?.message ||
          payload?.message ||
          'NVIDIA API trả về lỗi.',
      },
      { status: response.status }
    );
  }

  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content !== 'string') {
    return NextResponse.json(
      { error: 'NVIDIA không trả về nội dung hợp lệ.' },
      { status: 502 }
    );
  }

  const jsonText = extractFirstJsonObject(content);
  const resultParse = AiResultSchema.safeParse(JSON.parse(jsonText));
  if (!resultParse.success) {
    return NextResponse.json(
      {
        error: 'Không đọc được JSON điều khiển từ AI.',
        raw: content,
      },
      { status: 502 }
    );
  }

  return NextResponse.json(resultParse.data);
}
