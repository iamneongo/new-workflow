'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import styles from '@/app/page.module.css';

type CommandMode = 'text' | 'hex' | 'json';

type LightState = {
  power: boolean;
  brightness: number;
  color: string;
};

type ModelOption = {
  id: string;
  label: string;
};

type AiAction =
  | 'turn_on'
  | 'turn_off'
  | 'toggle'
  | 'set_brightness'
  | 'set_color'
  | 'status'
  | 'none';

type AiResult = {
  action: AiAction;
  brightness?: number | null;
  color?: string | null;
  reply: string;
  confidence?: number | null;
};

type LogEntry = {
  id: string;
  level: 'info' | 'success' | 'warn' | 'error';
  title: string;
  detail: string;
  ts: number;
};

type Settings = {
  deviceName: string;
  serviceUuid: string;
  characteristicUuid: string;
  model: string;
  commandMode: CommandMode;
  powerOnTemplate: string;
  powerOffTemplate: string;
  brightnessTemplate: string;
  colorTemplate: string;
};

const STORAGE_KEY = 'smart-light-ai-settings-v1';

const PHOTOOLEX_PRESET: Pick<
  Settings,
  'deviceName' | 'serviceUuid' | 'characteristicUuid' | 'commandMode'
> = {
  deviceName: 'Photoolex',
  serviceUuid: '0000ffe0-0000-1000-8000-00805f9b34fb',
  characteristicUuid: '0000ffe1-0000-1000-8000-00805f9b34fb',
  commandMode: 'text',
};

const DEFAULT_SETTINGS: Settings = {
  deviceName: PHOTOOLEX_PRESET.deviceName,
  serviceUuid: PHOTOOLEX_PRESET.serviceUuid,
  characteristicUuid: PHOTOOLEX_PRESET.characteristicUuid,
  model: '',
  commandMode: PHOTOOLEX_PRESET.commandMode,
  powerOnTemplate: 'ON',
  powerOffTemplate: 'OFF',
  brightnessTemplate: 'BRIGHTNESS {value}',
  colorTemplate: 'COLOR {hex}',
};

const INITIAL_LIGHT_STATE: LightState = {
  power: false,
  brightness: 60,
  color: '#ffb347',
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function normalizeHexColor(input: string) {
  const hex = input.trim().replace(/^#/, '').toUpperCase();
  if (!/^[0-9A-F]{6}$/.test(hex)) {
    throw new Error('Mã màu phải là dạng #RRGGBB.');
  }
  return `#${hex}`;
}

function hexToRgb(hex: string) {
  const clean = normalizeHexColor(hex).slice(1);
  return {
    r: Number.parseInt(clean.slice(0, 2), 16),
    g: Number.parseInt(clean.slice(2, 4), 16),
    b: Number.parseInt(clean.slice(4, 6), 16),
  };
}

function encodeHexString(hex: string) {
  const clean = hex
    .replace(/^0x/i, '')
    .replace(/[^0-9a-fA-F]/g, '')
    .toUpperCase();

  if (!clean || clean.length % 2 !== 0) {
    throw new Error('Chuỗi hex không hợp lệ.');
  }

  const bytes = new Uint8Array(clean.length / 2);
  for (let index = 0; index < clean.length; index += 2) {
    bytes[index / 2] = Number.parseInt(clean.slice(index, index + 2), 16);
  }
  return bytes;
}

function applyTemplate(template: string, values: Record<string, string | number>) {
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (_, key: string) => {
    const value = values[key];
    return value === undefined || value === null ? '' : String(value);
  });
}

function pickActionColor(level: LogEntry['level']) {
  switch (level) {
    case 'success':
      return '#34d399';
    case 'warn':
      return '#fbbf24';
    case 'error':
      return '#fb7185';
    default:
      return '#7dd3fc';
  }
}

function isBluetoothChooserCancelled(error: unknown) {
  return (
    error instanceof DOMException &&
    (error.name === 'NotFoundError' || error.name === 'AbortError')
  );
}

export default function SmartLightApp() {
  const deviceRef = useRef<any>(null);
  const characteristicRef = useRef<any>(null);

  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [lightState, setLightState] = useState<LightState>(INITIAL_LIGHT_STATE);
  const [models, setModels] = useState<ModelOption[]>([]);
  const [isLoadingModels, setIsLoadingModels] = useState(false);
  const [nvidiaStatus, setNvidiaStatus] = useState<'idle' | 'ready' | 'error'>('idle');
  const [connectionState, setConnectionState] = useState<'disconnected' | 'connecting' | 'connected' | 'error'>('disconnected');
  const [connectionLabel, setConnectionLabel] = useState('Chưa kết nối');
  const [selectedDeviceLabel, setSelectedDeviceLabel] = useState('Chưa quét thiết bị');
  const [prompt, setPrompt] = useState('');
  const [aiReply, setAiReply] = useState('Hãy mô tả ý định bằng tiếng Việt, ví dụ: "bật đèn 70% sang màu xanh".');
  const [isAskingAi, setIsAskingAi] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [isHydrated, setIsHydrated] = useState(false);
  const [pendingBrightness, setPendingBrightness] = useState(lightState.brightness);
  const [pendingColor, setPendingColor] = useState(lightState.color);

  const canUseBluetooth = useMemo(() => {
    if (typeof window === 'undefined') return false;
    return 'bluetooth' in navigator;
  }, []);

  const selectedModelLabel = useMemo(
    () => models.find((model) => model.id === settings.model)?.label || settings.model || 'Tự chọn',
    [models, settings.model]
  );

  const pushLog = (entry: Omit<LogEntry, 'id' | 'ts'>) => {
    setLogs((current) => [
      {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        ts: Date.now(),
        ...entry,
      },
      ...current,
    ].slice(0, 12));
  };

  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored) {
      try {
        const parsed = JSON.parse(stored) as Partial<Settings> & Partial<LightState>;
        setSettings((current) => ({
          ...current,
          deviceName: parsed.deviceName?.trim() ? parsed.deviceName : current.deviceName,
          serviceUuid: parsed.serviceUuid?.trim() ? parsed.serviceUuid : current.serviceUuid,
          characteristicUuid: parsed.characteristicUuid?.trim()
            ? parsed.characteristicUuid
            : current.characteristicUuid,
          model: parsed.model?.trim() ? parsed.model : current.model,
          commandMode: parsed.commandMode || current.commandMode,
          powerOnTemplate: parsed.powerOnTemplate?.trim() ? parsed.powerOnTemplate : current.powerOnTemplate,
          powerOffTemplate: parsed.powerOffTemplate?.trim()
            ? parsed.powerOffTemplate
            : current.powerOffTemplate,
          brightnessTemplate: parsed.brightnessTemplate?.trim()
            ? parsed.brightnessTemplate
            : current.brightnessTemplate,
          colorTemplate: parsed.colorTemplate?.trim() ? parsed.colorTemplate : current.colorTemplate,
        }));
        if (typeof parsed.brightness === 'number') {
          setPendingBrightness(clamp(parsed.brightness, 1, 100));
          setLightState((current) => ({ ...current, brightness: clamp(parsed.brightness ?? current.brightness, 1, 100) }));
        }
        if (typeof parsed.color === 'string') {
          const color = normalizeHexColor(parsed.color);
          setPendingColor(color);
          setLightState((current) => ({ ...current, color }));
        }
        if (typeof parsed.power === 'boolean') {
          setLightState((current) => ({ ...current, power: parsed.power ?? current.power }));
        }
      } catch {
        window.localStorage.removeItem(STORAGE_KEY);
      }
    }
    setIsHydrated(true);
  }, []);

  useEffect(() => {
    if (!isHydrated) return;
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        ...settings,
        ...lightState,
      })
    );
  }, [isHydrated, lightState, settings]);

  useEffect(() => {
    if (!isHydrated) return;
    setPendingBrightness(lightState.brightness);
    setPendingColor(lightState.color);
  }, [isHydrated, lightState.brightness, lightState.color]);

  useEffect(() => {
    let active = true;

    const loadModels = async () => {
      setIsLoadingModels(true);
      try {
        const response = await fetch('/api/nvidia/models');
        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
          throw new Error(data.error || 'Không tải được danh sách model NVIDIA.');
        }

        const nextModels = Array.isArray(data.models) ? data.models : [];
        if (!active) return;

        setModels(nextModels);
        setNvidiaStatus('ready');

        if (!settings.model && nextModels.length > 0) {
          setSettings((current) => ({ ...current, model: nextModels[0].id }));
        }

        pushLog({
          level: 'success',
          title: 'NVIDIA',
          detail: `Đã nạp ${nextModels.length} model khả dụng.`,
        });
      } catch (error) {
        if (!active) return;
        setNvidiaStatus('error');
        pushLog({
          level: 'warn',
          title: 'NVIDIA',
          detail: error instanceof Error ? error.message : 'Không tải được model NVIDIA.',
        });
      } finally {
        if (active) {
          setIsLoadingModels(false);
        }
      }
    };

    void loadModels();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const device = deviceRef.current;
    if (!device) return;

    const handleDisconnect = () => {
      characteristicRef.current = null;
      deviceRef.current = null;
      setConnectionState('disconnected');
      setConnectionLabel('Thiết bị đã ngắt kết nối');
      pushLog({
        level: 'warn',
        title: 'Bluetooth',
        detail: 'Thiết bị BLE đã ngắt kết nối.',
      });
    };

    device.addEventListener?.('gattserverdisconnected', handleDisconnect);
    return () => {
      device.removeEventListener?.('gattserverdisconnected', handleDisconnect);
    };
  }, [connectionState]);

  const updateSettings = <K extends keyof Settings>(key: K, value: Settings[K]) => {
    setSettings((current) => ({ ...current, [key]: value }));
  };

  const applyPhotolexPreset = () => {
    setSettings((current) => ({
      ...current,
      ...PHOTOOLEX_PRESET,
    }));
    setSelectedDeviceLabel('Photolex preset');
    pushLog({
      level: 'success',
      title: 'Preset',
      detail: 'Đã áp dụng cấu hình Photolex khuyến nghị.',
    });
  };

  const getCharacteristic = async () => {
    const device = deviceRef.current;
    if (!device?.gatt?.connected) {
      throw new Error('Bluetooth chưa kết nối.');
    }
    if (!settings.serviceUuid.trim() || !settings.characteristicUuid.trim()) {
      throw new Error('Thiếu service UUID hoặc characteristic UUID.');
    }

    const service = await device.gatt.getPrimaryService(settings.serviceUuid.trim());
    const characteristic = await service.getCharacteristic(settings.characteristicUuid.trim());
    characteristicRef.current = characteristic;
    return characteristic;
  };

  const writePayload = async (payload: string) => {
    const characteristic = characteristicRef.current || (await getCharacteristic());

    if (!characteristic) {
      throw new Error('Không tìm thấy characteristic để ghi.');
    }

    const bytes = settings.commandMode === 'hex' ? encodeHexString(payload) : new TextEncoder().encode(payload);

    if (typeof characteristic.writeValueWithResponse === 'function') {
      await characteristic.writeValueWithResponse(bytes);
      return;
    }

    await characteristic.writeValue(bytes);
  };

  const sendTemplate = async (
    template: string,
    values: Record<string, string | number>,
    successMessage: string
  ) => {
    const payload = applyTemplate(template, values);
    await writePayload(payload);
    pushLog({
      level: 'success',
      title: 'BLE',
      detail: successMessage,
    });
  };

  const buildBluetoothRequestOptions = () => {
    const serviceUuid = settings.serviceUuid.trim();
    const filters: Array<{ namePrefix?: string; services?: string[] }> = [];

    if (settings.deviceName.trim()) {
      filters.push({ namePrefix: settings.deviceName.trim() });
    }

    if (serviceUuid) {
      filters.push({ services: [serviceUuid] });
      return {
        filters,
        optionalServices: [serviceUuid],
      };
    }

    return { acceptAllDevices: true };
  };

  const scanBluetoothDevice = async () => {
    if (!canUseBluetooth) {
      throw new Error('Trình duyệt hiện tại không hỗ trợ Web Bluetooth.');
    }

    const bluetooth = (navigator as Navigator & { bluetooth?: any }).bluetooth;
    if (!bluetooth) {
      throw new Error('Trình duyệt hiện tại không hỗ trợ Web Bluetooth.');
    }

    setConnectionState('connecting');
    setConnectionLabel('Đang quét thiết bị...');

    try {
      const device = await bluetooth.requestDevice(buildBluetoothRequestOptions());
      deviceRef.current = device;
      setSelectedDeviceLabel(`${device.name || 'Thiết bị BLE'} (${device.id || 'unknown'})`);
      setConnectionState('disconnected');
      setConnectionLabel(`Đã chọn ${device.name || 'thiết bị BLE'}`);
      pushLog({
        level: 'success',
        title: 'Quét BLE',
        detail: `Đã chọn thiết bị ${device.name || 'thiết bị BLE'}.`,
      });
    } catch (error) {
      setConnectionState('disconnected');
      setConnectionLabel('Chưa kết nối');
      if (!isBluetoothChooserCancelled(error)) {
        pushLog({
          level: 'error',
          title: 'Quét BLE',
          detail: error instanceof Error ? error.message : 'Không quét được thiết bị BLE.',
        });
      }
    }

    return deviceRef.current;
  };

  const connectBluetooth = async () => {
    if (!canUseBluetooth) {
      setConnectionState('error');
      setConnectionLabel('Trình duyệt không hỗ trợ Web Bluetooth');
      pushLog({
        level: 'error',
        title: 'Bluetooth',
        detail: 'Chỉ Chrome, Edge hoặc trình duyệt hỗ trợ Web Bluetooth mới dùng được.',
      });
      return;
    }

    if (!settings.serviceUuid.trim() || !settings.characteristicUuid.trim()) {
      pushLog({
        level: 'warn',
        title: 'Bluetooth',
        detail: 'Hãy nhập service UUID và characteristic UUID trước khi kết nối.',
      });
      return;
    }

    setConnectionState('connecting');
    setConnectionLabel('Đang chọn thiết bị...');

    try {
      const bluetooth = (navigator as Navigator & { bluetooth?: any }).bluetooth;
      if (!bluetooth) {
        throw new Error('Trình duyệt hiện tại không hỗ trợ Web Bluetooth.');
      }
      let device = deviceRef.current;
      if (!device) {
        try {
          device = await bluetooth.requestDevice(buildBluetoothRequestOptions());
          deviceRef.current = device;
          setSelectedDeviceLabel(`${device.name || 'Thiết bị BLE'} (${device.id || 'unknown'})`);
        } catch (error) {
          if (isBluetoothChooserCancelled(error)) {
            setConnectionState('disconnected');
            setConnectionLabel('Chưa kết nối');
            return;
          }
          throw error;
        }
      }
      deviceRef.current = device;
      setConnectionLabel(`Đang kết nối ${device.name || 'thiết bị BLE'}...`);

      const server = await device.gatt?.connect();
      if (!server) {
        throw new Error('Không thể mở GATT server.');
      }

      await getCharacteristic();

      setConnectionState('connected');
      setConnectionLabel(`Đã kết nối ${device.name || 'thiết bị BLE'}`);
      pushLog({
        level: 'success',
        title: 'Bluetooth',
        detail: `Kết nối thành công với ${device.name || 'thiết bị BLE'}.`,
      });
    } catch (error) {
      setConnectionState('error');
      setConnectionLabel('Kết nối Bluetooth thất bại');
      pushLog({
        level: 'error',
        title: 'Bluetooth',
        detail: error instanceof Error ? error.message : 'Không kết nối được với thiết bị.',
      });
    }
  };

  const disconnectBluetooth = () => {
    const device = deviceRef.current;
    if (device?.gatt?.connected) {
      device.gatt.disconnect();
    }
    characteristicRef.current = null;
    deviceRef.current = null;
    setConnectionState('disconnected');
    setConnectionLabel('Đã ngắt kết nối');
    pushLog({
      level: 'info',
      title: 'Bluetooth',
      detail: 'Đã ngắt kết nối khỏi thiết bị.',
    });
  };

  const handlePower = async (nextPower: boolean) => {
    const template = nextPower ? settings.powerOnTemplate : settings.powerOffTemplate;
    await sendTemplate(
      template,
      { value: nextPower ? 1 : 0, state: nextPower ? 'ON' : 'OFF' },
      nextPower ? 'Đã gửi lệnh bật đèn.' : 'Đã gửi lệnh tắt đèn.'
    );
    setLightState((current) => ({ ...current, power: nextPower }));
  };

  const handleBrightnessApply = async (value: number) => {
    const brightness = clamp(value, 1, 100);
    await sendTemplate(
      settings.brightnessTemplate,
      { value: brightness, percent: brightness, hex: brightness.toString(16).toUpperCase().padStart(2, '0') },
      `Đã đặt độ sáng ${brightness}%.`
    );
    setLightState((current) => ({ ...current, brightness }));
  };

  const handleColorApply = async (color: string) => {
    const normalizedColor = normalizeHexColor(color);
    const { r, g, b } = hexToRgb(normalizedColor);
    await sendTemplate(
      settings.colorTemplate,
      { hex: normalizedColor, color: normalizedColor, r, g, b },
      `Đã gửi màu ${normalizedColor}.`
    );
    setLightState((current) => ({ ...current, color: normalizedColor }));
  };

  const toggleLight = async () => {
    await handlePower(!lightState.power);
  };

  const handleAiRequest = async () => {
    const cleanedPrompt = prompt.trim();
    if (!cleanedPrompt) {
      pushLog({
        level: 'warn',
        title: 'AI',
        detail: 'Hãy nhập một câu lệnh trước.',
      });
      return;
    }

    setIsAskingAi(true);
    try {
      const response = await fetch('/api/nvidia/light-command', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          prompt: cleanedPrompt,
          model: settings.model || undefined,
          context: {
            deviceName: settings.deviceName,
            serviceUuid: settings.serviceUuid,
            characteristicUuid: settings.characteristicUuid,
            commandMode: settings.commandMode,
            lightState,
          },
        }),
      });

      const data = (await response.json().catch(() => ({}))) as Partial<AiResult> & { error?: string };

      if (!response.ok) {
        throw new Error(data.error || 'Không gọi được NVIDIA API.');
      }

      const result = data as AiResult;
      setAiReply(result.reply);
      pushLog({
        level: 'info',
        title: 'AI',
        detail: `${result.reply} | action: ${result.action}`,
      });

      if (result.action === 'turn_on') {
        await handlePower(true);
      } else if (result.action === 'turn_off') {
        await handlePower(false);
      } else if (result.action === 'toggle') {
        await toggleLight();
      } else if (result.action === 'set_brightness' && typeof result.brightness === 'number') {
        await handleBrightnessApply(result.brightness);
      } else if (result.action === 'set_color' && typeof result.color === 'string') {
        await handleColorApply(result.color);
      }
    } catch (error) {
      pushLog({
        level: 'error',
        title: 'AI',
        detail: error instanceof Error ? error.message : 'AI xử lý thất bại.',
      });
      setAiReply(error instanceof Error ? error.message : 'AI xử lý thất bại.');
    } finally {
      setIsAskingAi(false);
    }
  };

  return (
    <div className={styles.shell}>
      <section className={styles.hero}>
        <div className={styles.heroCopy}>
          <div className={styles.pillRow}>
            <span className={styles.pill}>Web Bluetooth</span>
            <span className={styles.pill}>NVIDIA AI</span>
            <span className={styles.pill}>{selectedModelLabel}</span>
          </div>
          <h1>Điều khiển đèn Bluetooth bằng giọng văn tự nhiên, không cần bấm từng nút.</h1>
          <p>
            Ứng dụng này gửi lệnh BLE trực tiếp tới đèn của bạn và dùng NVIDIA API để hiểu câu
            lệnh như “bật đèn 70% sang màu xanh ấm”.
          </p>
          <div className={styles.heroStats}>
            <div className={styles.statCard}>
              <span>Bluetooth</span>
              <strong className={connectionState === 'connected' ? styles.good : styles.dim}>
                {connectionLabel}
              </strong>
            </div>
            <div className={styles.statCard}>
              <span>NVIDIA</span>
              <strong className={nvidiaStatus === 'ready' ? styles.good : styles.dim}>
                {isLoadingModels ? 'Đang tải model...' : nvidiaStatus === 'ready' ? 'Sẵn sàng' : 'Chờ cấu hình'}
              </strong>
            </div>
            <div className={styles.statCard}>
              <span>Thiết bị</span>
              <strong>{settings.deviceName || 'Bất kỳ thiết bị phù hợp'}</strong>
            </div>
          </div>
        </div>

        <div className={styles.glowCard}>
          <div className={styles.lightOrb} style={{ background: lightState.color }} />
          <div className={styles.glowMeta}>
            <span>Trạng thái hiện tại</span>
            <strong>{lightState.power ? 'Đang bật' : 'Đang tắt'}</strong>
            <small>{lightState.brightness}% · {lightState.color}</small>
          </div>
          <div className={styles.miniButtons}>
            <button type="button" className={styles.ghostButton} onClick={() => void handlePower(true)}>
              Bật
            </button>
            <button type="button" className={styles.ghostButton} onClick={() => void handlePower(false)}>
              Tắt
            </button>
            <button type="button" className={styles.ghostButton} onClick={() => void toggleLight()}>
              Đảo trạng thái
            </button>
          </div>
        </div>
      </section>

      <main className={styles.grid}>
        <section className={styles.panel}>
          <div className={styles.panelHeader}>
            <div>
              <span className={styles.panelKicker}>Kết nối</span>
              <h2>Bluetooth + template lệnh</h2>
            </div>
            <span className={styles.statusBadge}>
              {connectionState === 'connected'
                ? 'Đã kết nối'
                : connectionState === 'connecting'
                ? 'Đang kết nối'
                : connectionState === 'error'
                ? 'Có lỗi'
                : 'Chưa kết nối'}
            </span>
          </div>

          <div className={styles.hintBox}>
            <strong>Photolex:</strong> Bật Bluetooth và Location/GPS trên điện thoại trước khi quét.
            Nếu app không thấy đèn, bấm preset bên dưới rồi quét lại.
          </div>

          <div className={styles.fieldGrid}>
            <label className={styles.field}>
              <span>Tên thiết bị / prefix</span>
              <input
                value={settings.deviceName}
                onChange={(event) => updateSettings('deviceName', event.target.value)}
                placeholder="VD: MiLight, Bulb, LED"
              />
            </label>
            <label className={styles.field}>
              <span>Service UUID</span>
              <input
                value={settings.serviceUuid}
                onChange={(event) => updateSettings('serviceUuid', event.target.value)}
                placeholder="VD: 0000ffe5-0000-1000-8000-00805f9b34fb"
              />
            </label>
            <label className={styles.field}>
              <span>Characteristic UUID</span>
              <input
                value={settings.characteristicUuid}
                onChange={(event) => updateSettings('characteristicUuid', event.target.value)}
                placeholder="VD: 0000ffe9-0000-1000-8000-00805f9b34fb"
              />
            </label>
            <label className={styles.field}>
              <span>Model NVIDIA</span>
              <input
                list="nvidia-models"
                value={settings.model}
                onChange={(event) => updateSettings('model', event.target.value)}
                placeholder="Chọn model từ NVIDIA"
              />
              <datalist id="nvidia-models">
                {models.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.label}
                  </option>
                ))}
              </datalist>
            </label>
          </div>

          <div className={styles.buttonRow}>
            <button type="button" className={styles.secondaryButton} onClick={applyPhotolexPreset}>
              Preset Photolex
            </button>
            <button type="button" className={styles.secondaryButton} onClick={() => void scanBluetoothDevice()}>
              Quét thiết bị
            </button>
            <button type="button" className={styles.primaryButton} onClick={() => void connectBluetooth()}>
              Kết nối đèn
            </button>
            <button type="button" className={styles.secondaryButton} onClick={disconnectBluetooth}>
              Ngắt kết nối
            </button>
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={() => void window.location.reload()}
            >
              Tải lại
            </button>
          </div>

          <div className={styles.hintBox}>
            <strong>Gợi ý:</strong> Web Bluetooth chỉ chạy trên Chrome/Edge và thường cần mở app qua
            <code>localhost</code> hoặc <code>https</code>.
          </div>
          <div className={styles.hintBox}>
            <strong>Thiết bị đã chọn:</strong> {selectedDeviceLabel}
          </div>
        </section>

        <section className={styles.panel}>
          <div className={styles.panelHeader}>
            <div>
              <span className={styles.panelKicker}>Điều khiển</span>
              <h2>Manual control</h2>
            </div>
            <span className={styles.statusBadge}>{lightState.power ? 'Bật' : 'Tắt'}</span>
          </div>

          <div className={styles.actionGrid}>
            <button
              type="button"
              className={`${styles.actionButton} ${lightState.power ? styles.activeButton : ''}`}
              onClick={() => void handlePower(true)}
            >
              Bật đèn
            </button>
            <button type="button" className={styles.actionButton} onClick={() => void handlePower(false)}>
              Tắt đèn
            </button>
            <button type="button" className={styles.actionButton} onClick={() => void toggleLight()}>
              Đảo trạng thái
            </button>
          </div>

          <div className={styles.sliderBlock}>
            <div className={styles.sliderHeader}>
              <span>Độ sáng</span>
              <strong>{pendingBrightness}%</strong>
            </div>
            <input
              type="range"
              min={1}
              max={100}
              value={pendingBrightness}
              onChange={(event) => setPendingBrightness(Number(event.target.value))}
            />
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={() => void handleBrightnessApply(pendingBrightness)}
            >
              Áp dụng độ sáng
            </button>
          </div>

          <div className={styles.colorBlock}>
            <div className={styles.sliderHeader}>
              <span>Màu đèn</span>
              <strong>{pendingColor}</strong>
            </div>
            <div className={styles.colorRow}>
              <input
                type="color"
                value={pendingColor}
                onChange={(event) => setPendingColor(event.target.value)}
              />
              <button
                type="button"
                className={styles.secondaryButton}
                onClick={() => void handleColorApply(pendingColor)}
              >
                Áp dụng màu
              </button>
            </div>
          </div>
        </section>

        <section className={styles.panel}>
          <div className={styles.panelHeader}>
            <div>
              <span className={styles.panelKicker}>AI</span>
              <h2>Lệnh tự nhiên</h2>
            </div>
            <span className={styles.statusBadge}>{nvidiaStatus === 'ready' ? 'NVIDIA live' : 'Chưa sẵn sàng'}</span>
          </div>

          <textarea
            className={styles.promptBox}
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder='Ví dụ: "bật đèn 80%, đổi sang xanh dương, nếu đang quá sáng thì giảm xuống 55%"'
            rows={5}
          />

          <div className={styles.buttonRow}>
            <button type="button" className={styles.primaryButton} onClick={() => void handleAiRequest()} disabled={isAskingAi}>
              {isAskingAi ? 'Đang suy luận...' : 'Gửi cho AI'}
            </button>
            <button type="button" className={styles.secondaryButton} onClick={() => setPrompt('')}>
              Xoá nội dung
            </button>
          </div>

          <div className={styles.aiReply}>
            <span>Phản hồi</span>
            <p>{aiReply}</p>
          </div>

          <div className={styles.templateGrid}>
            <label className={styles.field}>
              <span>Bật template</span>
              <input
                value={settings.powerOnTemplate}
                onChange={(event) => updateSettings('powerOnTemplate', event.target.value)}
              />
            </label>
            <label className={styles.field}>
              <span>Tắt template</span>
              <input
                value={settings.powerOffTemplate}
                onChange={(event) => updateSettings('powerOffTemplate', event.target.value)}
              />
            </label>
            <label className={styles.field}>
              <span>Sáng template</span>
              <input
                value={settings.brightnessTemplate}
                onChange={(event) => updateSettings('brightnessTemplate', event.target.value)}
              />
            </label>
            <label className={styles.field}>
              <span>Màu template</span>
              <input
                value={settings.colorTemplate}
                onChange={(event) => updateSettings('colorTemplate', event.target.value)}
              />
            </label>
          </div>
        </section>

        <section className={styles.panel}>
          <div className={styles.panelHeader}>
            <div>
              <span className={styles.panelKicker}>Cấu hình</span>
              <h2>Ghi chú vận hành</h2>
            </div>
            <span className={styles.statusBadge}>{settings.commandMode}</span>
          </div>

          <label className={styles.field}>
            <span>Chế độ payload</span>
            <select
              value={settings.commandMode}
              onChange={(event) => updateSettings('commandMode', event.target.value as CommandMode)}
            >
              <option value="text">text</option>
              <option value="hex">hex</option>
              <option value="json">json</option>
            </select>
          </label>

          <div className={styles.noteList}>
            <div className={styles.noteCard}>
              <strong>1. Bluetooth</strong>
              <p>App sẽ ghi trực tiếp vào characteristic mà bạn khai báo. Nếu đèn dùng protocol riêng, chỉ cần sửa template.</p>
            </div>
            <div className={styles.noteCard}>
              <strong>2. AI</strong>
              <p>Backend gọi NVIDIA qua endpoint OpenAI-compatible, nên API key được giữ ở server bằng biến môi trường.</p>
            </div>
            <div className={styles.noteCard}>
              <strong>3. Lưu trạng thái</strong>
              <p>Thiết lập được lưu trong <code>localStorage</code> để lần mở sau khỏi nhập lại.</p>
            </div>
          </div>

          <div className={styles.logList}>
            {logs.map((entry) => (
              <article key={entry.id} className={styles.logCard}>
                <span
                  className={styles.logDot}
                  style={{ background: pickActionColor(entry.level) }}
                />
                <div>
                  <div className={styles.logTopRow}>
                    <strong>{entry.title}</strong>
                    <time>{new Date(entry.ts).toLocaleTimeString('vi-VN')}</time>
                  </div>
                  <p>{entry.detail}</p>
                </div>
              </article>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
