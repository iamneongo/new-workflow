'use client';

import React from 'react';

interface RenameModalProps {
  isOpen: boolean;
  currentName: string;
  onClose: () => void;
  onSave: (newName: string) => void;
}

export default function RenameModal({ isOpen, currentName, onClose, onSave }: RenameModalProps) {
  const [value, setValue] = React.useState(currentName);

  React.useEffect(() => {
    setValue(currentName);
  }, [currentName, isOpen]);

  // ESC key closes modal
  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [isOpen, onClose]);

  const handleSave = () => {
    const trimmed = value.trim();
    if (!trimmed) {
      alert('Vui lòng nhập tên chủ đề');
      return;
    }
    onSave(trimmed);
  };

  return (
    <div
      className={`modal-overlay${isOpen ? ' active' : ''}`}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="modal-content">
        <div className="modal-header">
          <h3>Đổi tên chủ đề</h3>
          <button className="close-btn" onClick={onClose} aria-label="Đóng">
            <i className="fa-solid fa-xmark" />
          </button>
        </div>
        <div className="modal-body">
          <p>Bạn có thể đặt tên gợi nhớ cho chủ đề này để dễ quản lý (chỉ lưu tại máy cục bộ này):</p>
          <div className="input-group">
            <label htmlFor="topicNameInput">Tên chủ đề mới:</label>
            <input
              type="text"
              id="topicNameInput"
              placeholder="Ví dụ: Kênh thông báo, Hỗ trợ..."
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); }}
              autoFocus
            />
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>Hủy</button>
          <button className="btn btn-primary" onClick={handleSave}>Lưu thay đổi</button>
        </div>
      </div>
    </div>
  );
}
