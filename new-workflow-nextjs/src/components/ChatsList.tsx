'use client';

import React from 'react';
import type { ChatEntry, AutomationSetup } from '@/lib/automation-types';

interface ChatsListProps {
  automations: AutomationSetup[];
  selectedAutomationId: string | null;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onSelectAutomation: (id: string) => void;
  onCreateAutomation: () => void;
  chats: Record<string, ChatEntry>;
}

export default function ChatsList({
  automations,
  selectedAutomationId,
  searchQuery,
  onSearchChange,
  onSelectAutomation,
  onCreateAutomation,
  chats,
}: ChatsListProps) {

  const filtered = automations.filter((auto) => {
    const q = searchQuery.toLowerCase();
    const sourceTitle = chats[auto.sourceGroupId]?.chatTitle.toLowerCase() || '';
    const destTitle = chats[auto.destGroupId]?.chatTitle.toLowerCase() || auto.destGroupId.toLowerCase() || '';
    return (
      auto.name.toLowerCase().includes(q) ||
      sourceTitle.includes(q) ||
      destTitle.includes(q)
    );
  });

  return (
    <>
      <div style={{ padding: '0 0 16px 0' }}>
        <button 
          className="btn btn-primary" 
          onClick={onCreateAutomation}
          id="createAutomationButton"
          style={{ 
            width: '100%', 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'center', 
            gap: '8px',
            background: 'var(--accent-blue)',
            color: '#fff',
            border: 'none',
            padding: '10px',
            borderRadius: '6px',
            fontWeight: '600',
            cursor: 'pointer'
          }}
        >
          <i className="fa-solid fa-plus" />
          Tạo Automation mới
        </button>
      </div>

      <div className="search-box">
        <i className="fa-solid fa-magnifying-glass search-icon" />
        <input
          type="text"
          id="searchInput"
          placeholder="Tìm kiếm automation..."
          autoComplete="off"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
        />
      </div>

      <div className="section-title">
        <h2>Danh sách Automation</h2>
      </div>

      <div className="chats-list" id="automationList">
        {filtered.length === 0 ? (
          <div className="no-results">Chưa có cấu hình automation nào</div>
        ) : (
          filtered.map((auto) => {
            const isListening = auto.isListening;
            const sourceTitle = chats[auto.sourceGroupId]?.chatTitle || 'Chưa cấu hình';
            const destTitle = chats[auto.destGroupId]?.chatTitle || auto.destGroupId || 'Chưa cấu hình';

            return (
              <div
                key={auto.id}
                id={`automation-item-${auto.id}`}
                className={`chat-item${selectedAutomationId === auto.id ? ' active' : ''}`}
                onClick={() => onSelectAutomation(auto.id)}
              >
                <div
                  className="chat-avatar"
                  style={{
                    background: isListening
                      ? 'linear-gradient(135deg, #10b981 0%, #059669 100%)'
                      : 'linear-gradient(135deg, #9ca3af 0%, #4b5563 100%)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#fff',
                  }}
                >
                  <i className={`fa-solid fa-robot ${isListening ? 'fa-pulse' : ''}`} />
                </div>

                <div className="chat-info">
                  <div className="chat-title-row">
                    <span className="chat-name" style={{ display: 'flex', alignItems: 'center', gap: '5px', fontWeight: '600' }}>
                      {auto.name}
                    </span>
                    <span 
                      className={`chat-type ${isListening ? 'supergroup' : 'channel'}`}
                      style={{ 
                        background: isListening ? 'rgba(16, 185, 129, 0.1)' : 'rgba(107, 114, 128, 0.1)', 
                        color: isListening ? '#10b981' : '#6b7280',
                        fontSize: '9px',
                        padding: '2px 6px',
                        borderRadius: '4px'
                      }}
                    >
                      {isListening ? 'Đang chạy' : 'Đã dừng'}
                    </span>
                  </div>
                  <div className="chat-sub" style={{ fontSize: '11px', marginTop: '2px' }}>
                    <span className="chat-username" style={{ textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap', maxWidth: '220px' }}>
                      {sourceTitle} ➔ {destTitle}
                    </span>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </>
  );
}
