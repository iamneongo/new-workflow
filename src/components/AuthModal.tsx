'use client';

import React, { useState } from 'react';

interface AuthModalProps {
  isOpen: boolean;
  field: 'phone' | 'code' | 'password' | null;
  onSubmit: (value: string) => void;
}

const fieldConfig = {
  phone: {
    label: 'Số điện thoại Telegram',
    placeholder: '+84912345678',
    description: 'Nhập số điện thoại đăng nhập Telegram (kèm mã quốc gia)',
    icon: 'fa-mobile-screen',
    type: 'tel',
  },
  code: {
    label: 'Mã OTP xác thực',
    placeholder: '12345',
    description: 'Nhập mã OTP được gửi về ứng dụng Telegram của bạn',
    icon: 'fa-key',
    type: 'text',
  },
  password: {
    label: 'Mật khẩu 2FA',
    placeholder: '••••••••',
    description: 'Nhập mật khẩu xác thực 2 lớp (bỏ trống nếu không cài đặt)',
    icon: 'fa-lock',
    type: 'password',
  },
};

export default function AuthModal({ isOpen, field, onSubmit }: AuthModalProps) {
  const [value, setValue] = useState('');

  if (!field) return null;

  const config = fieldConfig[field];

  const handleSubmit = () => {
    onSubmit(value);
    setValue('');
  };

  return (
    <div className={`modal-overlay${isOpen ? ' active' : ''}`}>
      <div className="modal-content">
        <div className="modal-header">
          <h3>
            <i className={`fa-solid ${config.icon}`} style={{ marginRight: 8, color: 'var(--accent-blue)' }} />
            Xác thực Telegram
          </h3>
        </div>
        <div className="modal-body">
          <p>{config.description}</p>
          <div className="input-group">
            <label htmlFor="authInput">{config.label}:</label>
            <input
              type={config.type}
              id="authInput"
              placeholder={config.placeholder}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSubmit(); }}
              autoFocus
            />
          </div>
        </div>
        <div className="modal-footer">
          {field === 'password' && (
            <button className="btn btn-secondary" onClick={() => onSubmit('')}>
              Bỏ qua (không có 2FA)
            </button>
          )}
          <button className="btn btn-primary" onClick={handleSubmit}>
            <i className="fa-solid fa-paper-plane" /> Gửi
          </button>
        </div>
      </div>
    </div>
  );
}
