'use client';

import React, { useEffect, useState } from 'react';

interface BotConfigPanelProps {
  isOpen: boolean;
  onClose: () => void;
  onSaveSuccess?: () => void;
}

export default function BotConfigPanel({
  isOpen,
  onClose,
  onSaveSuccess,
}: BotConfigPanelProps) {
  const [tokenInput, setTokenInput] = useState('');
  const [hasSavedToken, setHasSavedToken] = useState(false);
  const [savedTokenLabel, setSavedTokenLabel] = useState('');
  const [tokenStatus, setTokenStatus] = useState<'idle' | 'testing' | 'ok' | 'fail'>('idle');
  const [tokenBotName, setTokenBotName] = useState('');
  const [isSavingToken, setIsSavingToken] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');

  // Load current global token on open
  useEffect(() => {
    if (!isOpen) return;

    let cancelled = false;

    const loadConfig = async () => {
      try {
        const res = await fetch('/api/bot-config');
        const data = await res.json();

        if (cancelled) return;

        setHasSavedToken(!!data.hasToken);
        setSavedTokenLabel(data.token || '');
        setTokenInput('');
        setTokenStatus('idle');
        setTokenBotName('');
        setStatusMessage('');
      } catch (err) {
        if (!cancelled) {
          console.error(err);
        }
      }
    };

    void loadConfig();

    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  const handleTestToken = async () => {
    const token = tokenInput.trim();
    if (!token) return;
    setTokenStatus('testing');
    setTokenBotName('');
    try {
      const res = await fetch('/api/bot-config/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      const data = await res.json();
      if (data.ok) {
        setTokenStatus('ok');
        setTokenBotName(data.username);
      } else {
        setTokenStatus('fail');
        setTokenBotName(data.error || 'Token không hợp lệ');
      }
    } catch {
      setTokenStatus('fail');
      setTokenBotName('Không thể kết nối');
    }
  };

  const handleSaveToken = async () => {
    const token = tokenInput.trim();
    if (!token) {
      if (hasSavedToken) {
        showStatus(
          savedTokenLabel
            ? `ℹ️ Token bot hiện đã được lưu trong database (${savedTokenLabel}).`
            : 'ℹ️ Token bot hiện đã được lưu trong database.'
        );
        setTimeout(onClose, 1000);
      }
      return;
    }
    setIsSavingToken(true);
    try {
      const res = await fetch('/api/bot-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      const data = await res.json();
      if (data.success) {
        setHasSavedToken(true);
        setSavedTokenLabel(data.token || '');
        setTokenInput('');
        setTokenStatus('idle');
        showStatus('✅ Đã lưu Bot Token thành công!');
        if (onSaveSuccess) onSaveSuccess();
        setTimeout(onClose, 1000);
      } else {
        showStatus('❌ ' + (data.error || 'Lỗi lưu token'));
      }
    } catch {
      showStatus('❌ Lỗi kết nối server');
    } finally {
      setIsSavingToken(false);
    }
  };

  function showStatus(msg: string) {
    setStatusMessage(msg);
    setTimeout(() => setStatusMessage(''), 3000);
  }

  if (!isOpen) return null;

  return (
    <div className="bot-panel-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }} style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(0,0,0,0.4)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1000,
    }}>
      <div className="bot-panel" style={{
        background: 'var(--bg-secondary)',
        border: '1px solid var(--border-color)',
        borderRadius: '8px',
        width: '450px',
        boxShadow: '0 8px 30px rgba(0,0,0,0.12)',
        overflow: 'hidden',
      }}>
        {/* Panel Header */}
        <div className="bot-panel-header" style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '16px',
          borderBottom: '1px solid var(--border-color)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '18px' }}>🤖</span>
            <div>
              <h2 style={{ fontSize: '14px', margin: 0, fontWeight: '700' }}>Cấu hình Telegram Bot</h2>
              <p style={{ fontSize: '10px', margin: 0, color: 'var(--color-text-muted)' }}>Cài đặt token bot toàn cục cho hệ thống</p>
            </div>
          </div>
          <button onClick={onClose} style={{
            background: 'none',
            border: 'none',
            color: 'var(--color-text-muted)',
            cursor: 'pointer',
            fontSize: '16px',
          }}><i className="fa-solid fa-xmark" /></button>
        </div>

        {/* Panel Body */}
        <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {statusMessage && (
            <div style={{
              background: 'var(--bg-primary)',
              border: '1px solid var(--border-color)',
              padding: '8px',
              borderRadius: '4px',
              fontSize: '11px',
              textAlign: 'center',
            }}>{statusMessage}</div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label style={{ fontSize: '11px', fontWeight: '600' }}>Token Bot từ @BotFather:</label>
            <div style={{ display: 'flex', gap: '8px' }}>
              <input
                type="password"
                className="bot-input"
                placeholder="Nhập Token Bot..."
                value={tokenInput}
                onChange={(e) => {
                  setTokenInput(e.target.value);
                  setTokenStatus('idle');
                  setTokenBotName('');
                }}
                style={{
                  flex: 1,
                  background: 'var(--bg-primary)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '4px',
                  padding: '6px 10px',
                  color: 'var(--color-text)',
                  fontSize: '12px',
                }}
              />
              <button
                className="btn btn-secondary"
                onClick={handleTestToken}
                disabled={!tokenInput.trim() || tokenStatus === 'testing'}
                style={{
                  fontSize: '11px',
                  padding: '6px 10px',
                  borderRadius: '4px',
                }}
              >
                {tokenStatus === 'testing' ? 'Test...' : 'Test'}
              </button>
            </div>
            {hasSavedToken && !tokenInput.trim() && (
              <div style={{
                fontSize: '10px',
                color: 'var(--color-text-muted)',
                lineHeight: 1.4,
              }}>
                Token hiện tại đã được lưu trong database{savedTokenLabel ? ` (${savedTokenLabel})` : ''}. Nhập token mới nếu muốn thay đổi.
              </div>
            )}
          </div>

          <span style={{ fontSize: '10px', color: 'var(--color-text-muted)' }}>
            * Thay đổi ở đây sẽ cập nhật Token Bot toàn cục dùng cho tất cả Automation.
          </span>

          {tokenStatus === 'ok' && (
            <div style={{ fontSize: '11px', color: '#10b981', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <i className="fa-solid fa-circle-check" /> Bot hợp lệ: @{tokenBotName}
            </div>
          )}
          {tokenStatus === 'fail' && (
            <div style={{ fontSize: '11px', color: '#ef4444', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <i className="fa-solid fa-circle-xmark" /> {tokenBotName}
            </div>
          )}

          {/* Action buttons */}
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', borderTop: '1px solid var(--border-color)', paddingTop: '12px', marginTop: '4px' }}>
            <button className="btn btn-secondary" onClick={onClose} style={{ fontSize: '11px', padding: '6px 12px', borderRadius: '4px' }}>Đóng</button>
            <button
              className="btn btn-primary"
              onClick={handleSaveToken}
              disabled={(!tokenInput.trim() && !hasSavedToken) || isSavingToken}
              style={{
                fontSize: '11px',
                padding: '6px 12px',
                borderRadius: '4px',
                background: 'var(--accent-blue)',
                color: '#fff',
                border: 'none',
              }}
            >
              {isSavingToken ? 'Đang lưu...' : 'Lưu'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
