export type NvidiaModel = {
  id: string;
  label: string;
};

export type LightAiResult = {
  action: 'turn_on' | 'turn_off' | 'toggle' | 'set_brightness' | 'set_color' | 'status' | 'none';
  brightness?: number | null;
  color?: string | null;
  reply: string;
  confidence?: number | null;
};

export type LightAiContext = {
  deviceName?: string;
  serviceUuid?: string;
  characteristicUuid?: string;
  commandMode?: 'text' | 'hex' | 'json';
  lightState?: {
    power: boolean;
    brightness: number;
    color: string;
  };
};

export const NVIDIA_BASE_URL = (process.env.NVIDIA_BASE_URL || 'https://integrate.api.nvidia.com/v1').replace(/\/$/, '');
export const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY?.trim() || '';

export function buildSystemPrompt(context: LightAiContext, modelHint?: string) {
  const state = context.lightState
    ? `Current light state: power=${context.lightState.power ? 'on' : 'off'}, brightness=${context.lightState.brightness}, color=${context.lightState.color}.`
    : 'Current light state is unknown.';

  return [
    'You are a Vietnamese smart-light assistant.',
    'Your job is to convert the user request into one JSON object only.',
    'Allowed action values: turn_on, turn_off, toggle, set_brightness, set_color, status, none.',
    'If the user asks for brightness, return brightness as an integer from 1 to 100.',
    'If the user asks for color, return color as a hex string like #00FF88.',
    'Always include a short Vietnamese reply in the reply field.',
    'Do not wrap the JSON in markdown code fences.',
    `Device context: ${JSON.stringify(context)}.`,
    state,
    modelHint ? `Model hint: ${modelHint}.` : '',
  ]
    .filter(Boolean)
    .join(' ');
}

export function extractFirstJsonObject(content: string) {
  const trimmed = content.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1]?.trim() || trimmed;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('Không tìm thấy JSON hợp lệ trong phản hồi của AI.');
  }
  return candidate.slice(start, end + 1);
}
