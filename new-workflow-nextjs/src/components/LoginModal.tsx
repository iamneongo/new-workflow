'use client';

import React, { useState } from 'react';

interface LoginModalProps {
  isOpen: boolean;
  onSuccess: () => void;
}

export default function LoginModal({ isOpen, onSuccess }: LoginModalProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    if (!username || !password) {
      setError('Vui lòng nhập đầy đủ thông tin.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/auth-web', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'login', username, password }),
      });
      if (res.ok) {
        setUsername('');
        setPassword('');
        onSuccess();
      } else {
        const data = await res.json();
        setError(data.error || 'Đăng nhập thất bại.');
      }
    } catch {
      setError('Lỗi kết nối. Vui lòng thử lại.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={`modal-overlay${isOpen ? ' active' : ''}`}>
      <div className="modal-content">
        <div className="modal-header">
          <h3>
            <i className="fa-solid fa-lock" style={{ marginRight: 8, color: 'var(--accent-blue)' }} />
            Đăng nhập
          </h3>
        </div>
        <div className="modal-body">
          <p style={{ color: 'var(--color-text-muted)', fontSize: '13px', marginBottom: '4px' }}>
            Nhập thông tin đăng nhập để truy cập hệ thống.
          </p>
          <div className="input-group">
            <label htmlFor="loginUsername">Tên đăng nhập:</label>
            <input
              type="text"
              id="loginUsername"
              placeholder="admin"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleLogin(); }}
              autoFocus
              autoComplete="username"
            />
          </div>
          <div className="input-group" style={{ marginTop: '10px' }}>
            <label htmlFor="loginPassword">Mật khẩu:</label>
            <input
              type="password"
              id="loginPassword"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleLogin(); }}
              autoComplete="current-password"
            />
          </div>
          {error && (
            <p style={{ color: 'var(--status-offline)', fontSize: '12px', marginTop: '8px' }}>
              <i className="fa-solid fa-circle-exclamation" style={{ marginRight: 4 }} />
              {error}
            </p>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn btn-primary" onClick={handleLogin} disabled={loading}>
            {loading
              ? <><i className="fa-solid fa-spinner fa-spin" /> Đang đăng nhập...</>
              : <><i className="fa-solid fa-right-to-bracket" /> Đăng nhập</>
            }
          </button>
        </div>
      </div>
    </div>
  );
}
