'use client';

import React, { useState, useEffect, useRef } from 'react';
import { ChatEntry, AutomationSetup, TopicEntry } from '@/lib/database';

interface ChatDetailsProps {
  automation: AutomationSetup | null;
  onDeleteAutomation: (id: string) => void;
  onSaveAutomation: (setup: Partial<AutomationSetup> & { id: string }) => Promise<void>;
  chats: Record<string, ChatEntry>;
  activeTab: 'config' | 'diagram'; // kept for prop compatibility
  setActiveTab: (tab: 'config' | 'diagram') => void;
  // Stats and control
  listenerActive: boolean;
  forwardCount: number;
  lastForwardTime: number | null;
  lastPreview: string | null;
  onListenerToggle: (active: boolean) => void;
  onListenerChange?: () => void;
  onRename: (chatId: string, threadId: number, currentName: string) => void;
}

function formatTime(ts: number | null): string {
  if (!ts) return 'Chưa có';
  const d = new Date(ts);
  return d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    + ' ' + d.toLocaleDateString('vi-VN');
}

export default function ChatDetails({
  automation,
  onDeleteAutomation,
  onSaveAutomation,
  chats,
  listenerActive,
  forwardCount,
  lastForwardTime,
  lastPreview,
  onListenerToggle,
  onListenerChange,
}: ChatDetailsProps) {

  // Drag-to-scroll state for the workflow diagram
  const containerRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [startX, setStartX] = useState(0);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [startY, setStartY] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);

  // Card editing state
  const [editCard, setEditCard] = useState<'source' | 'bot' | 'approval' | 'supply' | 'delivery' | 'final' | 'reject' | null>(null);

  // Inputs state
  const [nameInput, setNameInput] = useState('');
  const [tokenInput, setTokenInput] = useState('');
  
  const [sourceGroupIdInput, setSourceGroupIdInput] = useState('');
  const [sourceThreadIdsInput, setSourceThreadIdsInput] = useState<number[]>([]);

  const [approvalGroupIdInput, setApprovalGroupIdInput] = useState('');
  const [approvalThreadIdInput, setApprovalThreadIdInput] = useState<number | ''>('');

  const [supplyGroupIdInput, setSupplyGroupIdInput] = useState('');
  const [supplyThreadIdInput, setSupplyThreadIdInput] = useState<number | ''>('');

  const [deliveryGroupIdInput, setDeliveryGroupIdInput] = useState('');
  const [deliveryThreadIdInput, setDeliveryThreadIdInput] = useState<number | ''>('');

  const [finalGroupIdInput, setFinalGroupIdInput] = useState('');
  const [finalThreadIdInput, setFinalThreadIdInput] = useState<number | ''>('');

  const [rejectGroupIdInput, setRejectGroupIdInput] = useState('');
  const [rejectThreadIdInput, setRejectThreadIdInput] = useState<number | ''>('');

  // Bot test status
  const [tokenStatus, setTokenStatus] = useState<'idle' | 'testing' | 'ok' | 'fail'>('idle');
  const [tokenBotName, setTokenBotName] = useState('');

  const [isSaving, setIsSaving] = useState(false);
  const [isToggling, setIsToggling] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');

  // Searchable group selector state
  const [groupSearch, setGroupSearch] = useState('');
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Reset dropdown search states on editing card changes
  useEffect(() => {
    setGroupSearch('');
    setIsDropdownOpen(false);
  }, [editCard]);

  // Click outside to dismiss group selector dropdown
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);


  // Sync inputs with selected automation
  useEffect(() => {
    if (automation) {
      setNameInput(automation.name);
      setTokenInput(automation.botToken);
      
      setSourceGroupIdInput(automation.sourceGroupId || '');
      setSourceThreadIdsInput(Array.isArray(automation.sourceThreadIds)
        ? automation.sourceThreadIds
        : automation.sourceThreadId !== null && automation.sourceThreadId !== undefined
          ? [automation.sourceThreadId]
          : []);

      setApprovalGroupIdInput(automation.approvalGroupId || '');
      setApprovalThreadIdInput(automation.approvalThreadId !== null && automation.approvalThreadId !== undefined ? automation.approvalThreadId : '');

      setSupplyGroupIdInput(automation.supplyGroupId || '');
      setSupplyThreadIdInput(automation.supplyThreadId !== null && automation.supplyThreadId !== undefined ? automation.supplyThreadId : '');

      setDeliveryGroupIdInput(automation.deliveryGroupId || '');
      setDeliveryThreadIdInput(automation.deliveryThreadId !== null && automation.deliveryThreadId !== undefined ? automation.deliveryThreadId : '');

      setFinalGroupIdInput(automation.finalGroupId || '');
      setFinalThreadIdInput(automation.finalThreadId !== null && automation.finalThreadId !== undefined ? automation.finalThreadId : '');

      setRejectGroupIdInput(automation.rejectGroupId || '');
      setRejectThreadIdInput(automation.rejectThreadId !== null && automation.rejectThreadId !== undefined ? automation.rejectThreadId : '');

      setTokenStatus('idle');
      setTokenBotName('');
      setEditCard(null);
    }
  }, [automation]);

  // Drag-to-scroll event handlers
  const handleMouseDown = (e: React.MouseEvent) => {
    if (!containerRef.current) return;
    const target = e.target as HTMLElement;
    // Don't drag if clicking buttons, inputs, links, or selects
    if (target.closest('button') || target.closest('a') || target.closest('input') || target.closest('select')) {
      return;
    }
    setIsDragging(true);
    setStartX(e.pageX - containerRef.current.offsetLeft);
    setStartY(e.pageY - containerRef.current.offsetTop);
    setScrollLeft(containerRef.current.scrollLeft);
    setScrollTop(containerRef.current.scrollTop);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging || !containerRef.current) return;
    e.preventDefault();
    const x = e.pageX - containerRef.current.offsetLeft;
    const y = e.pageY - containerRef.current.offsetTop;
    const walkX = (x - startX) * 1.5;
    const walkY = (y - startY) * 1.5;
    containerRef.current.scrollLeft = scrollLeft - walkX;
    containerRef.current.scrollTop = scrollTop - walkY;
  };

  const handleMouseUpOrLeave = () => {
    setIsDragging(false);
  };

  // Rename automation
  const handleRenameSave = async (newName: string) => {
    try {
      await onSaveAutomation({
        id: automation!.id,
        name: newName.trim() || 'Automation mới',
      });
      showStatus('✅ Đã cập nhật tên Automation!');
    } catch (err: any) {
      showStatus('❌ Lỗi: ' + err.message);
    }
  };

  // Test token
  const handleTestToken = async (e: React.MouseEvent) => {
    e.stopPropagation();
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

  // Save config for card
  const handleSaveCard = async (field: 'source' | 'bot' | 'approval' | 'supply' | 'delivery' | 'final' | 'reject') => {
    setIsSaving(true);
    try {
      const updates: Partial<AutomationSetup> & { id: string } = { id: automation!.id };
      if (field === 'source') {
        updates.sourceGroupId = sourceGroupIdInput;
        updates.sourceThreadIds = sourceThreadIdsInput;
        updates.sourceThreadId = sourceThreadIdsInput[0] ?? null;
      }
      if (field === 'bot') {
        updates.botToken = tokenInput.trim();
      }
      if (field === 'approval') {
        updates.approvalGroupId = approvalGroupIdInput;
        updates.approvalThreadId = approvalThreadIdInput === '' ? null : Number(approvalThreadIdInput);
      }
      if (field === 'supply') {
        updates.supplyGroupId = supplyGroupIdInput;
        updates.supplyThreadId = supplyThreadIdInput === '' ? null : Number(supplyThreadIdInput);
      }
      if (field === 'delivery') {
        updates.deliveryGroupId = deliveryGroupIdInput;
        updates.deliveryThreadId = deliveryThreadIdInput === '' ? null : Number(deliveryThreadIdInput);
      }
      if (field === 'final') {
        updates.finalGroupId = finalGroupIdInput;
        updates.finalThreadId = finalThreadIdInput === '' ? null : Number(finalThreadIdInput);
      }
      if (field === 'reject') {
        updates.rejectGroupId = rejectGroupIdInput;
        updates.rejectThreadId = rejectThreadIdInput === '' ? null : Number(rejectThreadIdInput);
      }

      await onSaveAutomation(updates);
      setEditCard(null);
      showStatus('✅ Đã lưu cấu hình bước thành công!');
    } catch (err: any) {
      showStatus('❌ Lỗi: ' + err.message);
    } finally {
      setIsSaving(false);
    }
  };

  // Toggle listener
  const handleToggleListener = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsToggling(true);
    try {
      const action = listenerActive ? 'stop' : 'start';
      const res = await fetch('/api/listener', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, automationId: automation!.id }),
      });
      const data = await res.json();
      if (data.error) {
        showStatus('❌ ' + data.error);
      } else {
        onListenerToggle(data.active);
        if (onListenerChange) onListenerChange();
        showStatus(data.active ? '✅ Đã kích hoạt chuyển tiếp tin nhắn!' : '⏹ Đã dừng chuyển tiếp.');
      }
    } catch {
      showStatus('❌ Lỗi kết nối tới server');
    } finally {
      setIsToggling(false);
    }
  };

  function showStatus(msg: string) {
    setStatusMessage(msg);
    setTimeout(() => setStatusMessage(''), 4000);
  }

  const chatList = Object.values(chats).sort((a, b) => a.chatTitle.localeCompare(b.chatTitle));

  const renderSourceGroupTopicBadge = (groupId: string, threadIds: number[]) => {
    const chat = chats[groupId];
    if (!chat) {
      return groupId ? <span style={{ color: 'var(--color-text-muted)', fontSize: '11px' }}>🟢 ID: {groupId}</span> : null;
    }

    const selectedTopics = threadIds
      .map((threadId) => chat.topics[threadId])
      .filter((topic): topic is TopicEntry => Boolean(topic));
    const chatTypeIcon = chat.chatType === 'supergroup' ? '🏛' : chat.chatType === 'channel' ? '📢' : '👥';

    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', flexWrap: 'wrap', gap: '4px', verticalAlign: 'middle' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', background: 'var(--bg-secondary)', padding: '2px 6px', borderRadius: '4px', border: '1px solid var(--border-color)' }}>
          {chat.photoPath ? (
            <img
              src={chat.photoPath}
              alt=""
              style={{ width: '16px', height: '16px', borderRadius: '50%', objectFit: 'cover' }}
              onError={(e) => {
                (e.target as HTMLElement).style.display = 'none';
                const parent = (e.target as HTMLElement).parentElement;
                if (parent && !parent.querySelector('.fallback-icon')) {
                  const fallback = document.createElement('span');
                  fallback.className = 'fallback-icon';
                  fallback.textContent = chatTypeIcon;
                  parent.insertBefore(fallback, e.target as HTMLElement);
                }
              }}
            />
          ) : (
            <span>{chatTypeIcon}</span>
          )}
          <span style={{ color: 'var(--color-text)', fontWeight: '600', fontSize: '11px' }}>{chat.chatTitle}</span>
        </span>
        {threadIds.length === 0 ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', background: 'rgba(34, 158, 217, 0.08)', padding: '2px 6px', borderRadius: '4px', border: '1px solid rgba(34, 158, 217, 0.2)' }}>
            <span>💬</span>
            <span style={{ color: 'var(--color-text)', fontWeight: '600', fontSize: '11px' }}>Tất cả topic</span>
          </span>
        ) : (
          <>
            <span style={{ color: 'var(--color-text-muted)', fontSize: '9px' }}>➔</span>
            <span style={{ display: 'inline-flex', alignItems: 'center', flexWrap: 'wrap', gap: '4px' }}>
              {selectedTopics.map((topic) => (
                <span key={topic.threadId} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', background: 'rgba(16, 185, 129, 0.08)', padding: '2px 6px', borderRadius: '4px', border: '1px solid rgba(16, 185, 129, 0.2)' }}>
                  <span>{topic.topicIcon || '💬'}</span>
                  <span style={{ color: 'var(--color-text)', fontWeight: '600', fontSize: '11px' }}>{topic.topicName}</span>
                </span>
              ))}
              {threadIds.filter((threadId) => !chat.topics[threadId]).map((threadId) => (
                <span key={threadId} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', background: 'rgba(245, 158, 11, 0.08)', padding: '2px 6px', borderRadius: '4px', border: '1px solid rgba(245, 158, 11, 0.2)' }}>
                  <span>💬</span>
                  <span style={{ color: 'var(--color-text)', fontWeight: '600', fontSize: '11px' }}>Topic #{threadId}</span>
                </span>
              ))}
            </span>
          </>
        )}
      </span>
    );
  };

  const renderGroupTopicBadge = (groupId: string, threadId: number | null) => {
    const chat = chats[groupId];
    if (!chat) return groupId ? <span style={{ color: 'var(--color-text-muted)', fontSize: '11px' }}>🟢 ID: {groupId}</span> : null;
    const topic = threadId !== null ? chat.topics[threadId] : null;
    const chatTypeIcon = chat.chatType === 'supergroup' ? '🏛' : chat.chatType === 'channel' ? '📢' : '👥';

    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', flexWrap: 'wrap', gap: '4px', verticalAlign: 'middle' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', background: 'var(--bg-secondary)', padding: '2px 6px', borderRadius: '4px', border: '1px solid var(--border-color)' }}>
          {chat.photoPath ? (
            <img 
              src={chat.photoPath} 
              alt="" 
              style={{ width: '16px', height: '16px', borderRadius: '50%', objectFit: 'cover' }}
              onError={(e) => {
                (e.target as HTMLElement).style.display = 'none';
                const parent = (e.target as HTMLElement).parentElement;
                if (parent && !parent.querySelector('.fallback-icon')) {
                  const fallback = document.createElement('span');
                  fallback.className = 'fallback-icon';
                  fallback.textContent = chatTypeIcon;
                  parent.insertBefore(fallback, e.target as HTMLElement);
                }
              }}
            />
          ) : (
            <span>{chatTypeIcon}</span>
          )}
          <span style={{ color: 'var(--color-text)', fontWeight: '600', fontSize: '11px' }}>{chat.chatTitle}</span>
        </span>
        {topic && (
          <>
            <span style={{ color: 'var(--color-text-muted)', fontSize: '9px' }}>➔</span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', background: 'rgba(16, 185, 129, 0.08)', padding: '2px 6px', borderRadius: '4px', border: '1px solid rgba(16, 185, 129, 0.2)' }}>
              <span>{topic.topicIcon || '💬'}</span>
              <span style={{ color: 'var(--color-text)', fontWeight: '600', fontSize: '11px' }}>{topic.topicName}</span>
            </span>
          </>
        )}
      </span>
    );
  };

  const renderGroupTopicSelector = (
    groupIdVal: string,
    setGroupId: any,
    threadIdVal: number | '' | number[],
    setThreadId: any,
    onCancel: () => void,
    onSave: () => void
  ) => {
    const selectedChat = chats[groupIdVal];
    const topicsList = selectedChat ? Object.values(selectedChat.topics || {}).sort((a, b) => a.topicName.localeCompare(b.topicName)) : [];
    const isMultiSelect = Array.isArray(threadIdVal);
    const selectedThreadIds = isMultiSelect ? threadIdVal : [];

    const filteredChats = chatList.filter(c => 
      c.chatTitle.toLowerCase().includes(groupSearch.toLowerCase()) ||
      c.chatId.includes(groupSearch) ||
      (c.username && c.username.toLowerCase().includes(groupSearch.toLowerCase()))
    );

    const chatTypeIcon = (type: string) => type === 'supergroup' ? '🏛' : type === 'channel' ? '📢' : '👥';

    return (
      <div onClick={(e) => e.stopPropagation()} style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '8px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', position: 'relative' }}>
          <label style={{ fontSize: '10px', color: 'var(--color-text-muted)', fontWeight: '600' }}>Chọn Nhóm/Kênh:</label>
          
          {/* Custom Select Box */}
          <div 
            onClick={() => setIsDropdownOpen(!isDropdownOpen)}
            style={{
              background: 'var(--bg-primary)',
              border: '1px solid var(--border-color)',
              borderRadius: '4px',
              padding: '6px 10px',
              color: 'var(--color-text)',
              fontSize: '12px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              minHeight: '34px',
              userSelect: 'none'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              {selectedChat ? (
                <>
                  {selectedChat.photoPath ? (
                    <img 
                      src={selectedChat.photoPath} 
                      alt="" 
                      style={{ width: '18px', height: '18px', borderRadius: '50%', objectFit: 'cover' }}
                      onError={(e) => {
                        (e.target as HTMLElement).style.display = 'none';
                        const parent = (e.target as HTMLElement).parentElement;
                        if (parent && !parent.querySelector('.fallback-select-icon')) {
                          const fallback = document.createElement('span');
                          fallback.className = 'fallback-select-icon';
                          fallback.textContent = chatTypeIcon(selectedChat.chatType);
                          parent.insertBefore(fallback, e.target as HTMLElement);
                        }
                      }}
                    />
                  ) : (
                    <span>{chatTypeIcon(selectedChat.chatType)}</span>
                  )}
                  <span style={{ fontWeight: '500' }}>{selectedChat.chatTitle}</span>
                </>
              ) : (
                <span style={{ color: 'var(--color-text-muted)' }}>— Chọn nhóm Telegram —</span>
              )}
            </div>
            <i className={`fa-solid fa-chevron-${isDropdownOpen ? 'up' : 'down'}`} style={{ fontSize: '10px', opacity: 0.6 }} />
          </div>

          {/* Search Dropdown list overlay */}
          {isDropdownOpen && (
            <div 
              ref={dropdownRef}
              style={{
                position: 'absolute',
                top: '100%',
                left: 0,
                right: 0,
                background: 'var(--bg-primary)',
                border: '1px solid var(--border-color)',
                borderRadius: '4px',
                marginTop: '4px',
                zIndex: 1000,
                boxShadow: '0 8px 24px rgba(0, 0, 0, 0.12)',
                maxHeight: '260px',
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden'
              }}
            >
              <div style={{ padding: '6px', borderBottom: '1px solid var(--border-color)', background: 'var(--bg-secondary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <i className="fa-solid fa-magnifying-glass" style={{ fontSize: '10px', color: 'var(--color-text-muted)', marginLeft: '4px' }} />
                <input 
                  type="text"
                  placeholder="Tìm kiếm nhóm..."
                  value={groupSearch}
                  onChange={(e) => setGroupSearch(e.target.value)}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    outline: 'none',
                    color: 'var(--color-text)',
                    fontSize: '11px',
                    width: '100%',
                    padding: '2px 0'
                  }}
                  autoFocus
                />
                {groupSearch && (
                  <button 
                    onClick={() => setGroupSearch('')}
                    style={{ background: 'none', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer', padding: '0 4px' }}
                  >
                    <i className="fa-solid fa-xmark" style={{ fontSize: '10px' }} />
                  </button>
                )}
              </div>

              <div style={{ overflowY: 'auto', flex: 1, padding: '4px' }}>
                {filteredChats.length === 0 ? (
                  <div style={{ padding: '12px', fontSize: '11px', color: 'var(--color-text-muted)', textAlign: 'center' }}>
                    Không tìm thấy nhóm nào
                  </div>
                ) : (
                  filteredChats.map((c) => {
                    const isSelected = c.chatId === groupIdVal;
                    return (
                      <div
                        key={c.chatId}
                        onClick={() => {
                          setGroupId(c.chatId);
                          setThreadId(isMultiSelect ? [] : '');
                          setIsDropdownOpen(false);
                          setGroupSearch('');
                        }}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px',
                          padding: '6px 8px',
                          borderRadius: '3px',
                          cursor: 'pointer',
                          background: isSelected ? 'rgba(34, 158, 217, 0.08)' : 'transparent',
                          transition: 'background 0.15s ease'
                        }}
                        onMouseEnter={(e) => {
                          if (!isSelected) e.currentTarget.style.background = 'var(--bg-secondary)';
                        }}
                        onMouseLeave={(e) => {
                          if (!isSelected) e.currentTarget.style.background = 'transparent';
                        }}
                      >
                        {c.photoPath ? (
                          <img 
                            src={c.photoPath} 
                            alt="" 
                            style={{ width: '18px', height: '18px', borderRadius: '50%', objectFit: 'cover' }}
                            onError={(e) => {
                              (e.target as HTMLElement).style.display = 'none';
                              const parent = (e.target as HTMLElement).parentElement;
                              if (parent && !parent.querySelector('.fallback-list-icon')) {
                                const fallback = document.createElement('span');
                                fallback.className = 'fallback-list-icon';
                                fallback.textContent = chatTypeIcon(c.chatType);
                                parent.insertBefore(fallback, e.target as HTMLElement);
                              }
                            }}
                          />
                        ) : (
                          <span>{chatTypeIcon(c.chatType)}</span>
                        )}
                        <span style={{ fontSize: '11px', fontWeight: isSelected ? '600' : '400', color: 'var(--color-text)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {c.chatTitle}
                        </span>
                        {isSelected && (
                          <i className="fa-solid fa-check" style={{ fontSize: '10px', color: 'var(--accent-blue)' }} />
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}
        </div>

        {/* Topic Selector - supports single or multi topic selection */}
        {!isMultiSelect && topicsList.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <label style={{ fontSize: '10px', color: 'var(--color-text-muted)', fontWeight: '600' }}>Chọn Topic/Chủ đề:</label>
            <select
              className="bot-select"
              value={threadIdVal}
              onChange={(e) => setThreadId(e.target.value ? Number(e.target.value) : '')}
              style={{ background: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: '4px', padding: '6px', color: 'var(--color-text)', width: '100%', fontSize: '12px' }}
            >
              <option value="">— Tất cả (General) —</option>
              {topicsList.map((t) => (
                <option key={t.threadId} value={t.threadId}>
                  {t.topicIcon} {t.topicName}
                </option>
              ))}
            </select>
          </div>
        )}

        {isMultiSelect && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
              <label style={{ fontSize: '10px', color: 'var(--color-text-muted)', fontWeight: '600' }}>Chọn Topic/Chủ đề:</label>
              <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  onClick={() => setThreadId(topicsList.map((t) => t.threadId))}
                  style={{ border: '1px solid var(--border-color)', background: 'var(--bg-secondary)', color: 'var(--color-text)', borderRadius: '4px', padding: '2px 6px', fontSize: '10px', cursor: 'pointer' }}
                >
                  Chọn tất cả
                </button>
                <button
                  type="button"
                  onClick={() => setThreadId([])}
                  style={{ border: '1px solid var(--border-color)', background: 'var(--bg-secondary)', color: 'var(--color-text)', borderRadius: '4px', padding: '2px 6px', fontSize: '10px', cursor: 'pointer' }}
                >
                  Bỏ chọn
                </button>
              </div>
            </div>

            <div style={{ fontSize: '10px', color: 'var(--color-text-muted)', lineHeight: 1.4 }}>
              Để trống = lắng nghe toàn bộ topic trong nhóm, bao gồm cả General.
            </div>

            {topicsList.length > 0 ? (
              <div style={{ maxHeight: '180px', overflowY: 'auto', border: '1px solid var(--border-color)', borderRadius: '4px', background: 'var(--bg-primary)', padding: '6px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                {topicsList.map((t) => {
                  const checked = selectedThreadIds.includes(t.threadId);
                  return (
                    <label
                      key={t.threadId}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        padding: '6px 8px',
                        borderRadius: '4px',
                        cursor: 'pointer',
                        background: checked ? 'rgba(34, 158, 217, 0.08)' : 'transparent',
                        border: checked ? '1px solid rgba(34, 158, 217, 0.2)' : '1px solid transparent',
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => {
                          const next = checked
                            ? selectedThreadIds.filter((threadId) => threadId !== t.threadId)
                            : [...selectedThreadIds, t.threadId];
                          setThreadId(next);
                        }}
                        style={{ accentColor: 'var(--accent-blue)' }}
                      />
                      <span style={{ fontSize: '11px' }}>{t.topicIcon || '💬'}</span>
                      <span style={{ fontSize: '11px', color: 'var(--color-text)', fontWeight: checked ? '600' : '400', flex: 1 }}>
                        {t.topicName}
                      </span>
                    </label>
                  );
                })}
              </div>
            ) : (
              <div style={{ padding: '10px', fontSize: '11px', color: 'var(--color-text-muted)', border: '1px dashed var(--border-color)', borderRadius: '4px', background: 'var(--bg-secondary)' }}>
                Nhóm này chưa có topic. Để trống selection để lắng nghe tất cả tin nhắn trong nhóm.
              </div>
            )}
          </div>
        )}

        <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end', marginTop: '4px' }}>
          <button className="btn btn-secondary" onClick={onCancel} style={{ padding: '4px 8px', fontSize: '10px', borderRadius: '4px' }}>Hủy</button>
          <button className="btn btn-primary" onClick={onSave} disabled={isSaving} style={{ padding: '4px 8px', fontSize: '10px', borderRadius: '4px', background: 'var(--accent-blue)' }}>Lưu</button>
        </div>
      </div>
    );
  };

  // ---------------------------------------------------------------------------
  // Render Read-Only Diagram (Default screen when no automation selected)
  // ---------------------------------------------------------------------------
  if (!automation) {
    return (
      <div
        ref={containerRef}
        className={`workflow-diagram-container${isDragging ? ' dragging' : ''}`}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUpOrLeave}
        onMouseLeave={handleMouseUpOrLeave}
        style={{ cursor: isDragging ? 'grabbing' : 'grab', height: '100%', overflow: 'auto' }}
      >
        <div className="workflow-header-info">
          <h4 className="workflow-sub-title">SƠ ĐỒ QUY TRÌNH AUTOMATION CÔNG TRÌNH</h4>
          <p className="workflow-desc">
            Mô hình hóa luồng xử lý tin nhắn và phê duyệt vật tư tự động. Chọn hoặc tạo một Automation ở bên trái để thiết lập cấu hình.
          </p>
        </div>

        <div className="workflow-tree" style={{ paddingBottom: '40px' }}>
          {/* Node 1: Start */}
          <div className="workflow-node start-node">
            <div className="node-icon">📡</div>
            <div className="node-content">
              <span className="node-tag">Bước 1: Trigger</span>
              <h5 className="node-title">Lắng nghe nhóm nguồn</h5>
              <p className="node-text">Userbot theo dõi mọi tin nhắn mới trong nhóm công trình và các topic đã chọn.</p>
            </div>
          </div>

          <div className="workflow-arrow-v">
            <svg width="2" height="30" viewBox="0 0 2 30" fill="none">
              <line x1="1" y1="0" x2="1" y2="30" stroke="var(--border-color)" strokeWidth="2" strokeDasharray="3 3" />
            </svg>
          </div>

          {/* Node 2: Bot Agent */}
          <div className="workflow-node action-node">
            <div className="node-icon">🤖</div>
            <div className="node-content">
              <span className="node-tag">Bước 2: Phê duyệt sơ bộ</span>
              <h5 className="node-title">Bot forward &amp; Hỏi ý kiến</h5>
              <p className="node-text">Bot gửi tin nhắn tới nhóm đích kèm 2 nút tương tác.</p>
              <div className="node-options-inline" style={{ marginTop: '6px' }}>
                <span className="opt-badge opt-agree"><i className="fa-solid fa-check" /> Đồng ý</span>
                <span className="opt-badge opt-disagree"><i className="fa-solid fa-xmark" /> Không đồng ý</span>
              </div>
            </div>
          </div>

          <div className="workflow-arrow-v">
            <svg width="2" height="30" viewBox="0 0 2 30" fill="none">
              <line x1="1" y1="0" x2="1" y2="30" stroke="var(--border-color)" strokeWidth="2" strokeDasharray="3 3" />
            </svg>
          </div>

          {/* Split Container */}
          <div className="workflow-split-container">
            <div className="workflow-split-line">
              <div className="split-horizontal-line"></div>
            </div>

            <div className="workflow-branches">
              {/* Branch Left: Disagree */}
              <div className="workflow-branch branch-left">
                <span className="branch-label label-disagree">Không đồng ý</span>
                <div className="workflow-arrow-v">
                  <svg width="2" height="20" viewBox="0 0 2 20" fill="none">
                    <line x1="1" y1="0" x2="1" y2="20" stroke="var(--border-color)" strokeWidth="2" />
                  </svg>
                </div>
                <div className="workflow-node end-node">
                  <div className="node-icon">❌</div>
                  <div className="node-content">
                    <h5 className="node-title">Thông báo từ chối</h5>
                    <p className="node-text">Gửi thông báo huỷ/từ chối vào nhóm được chỉ định.</p>
                  </div>
                </div>
              </div>

              {/* Branch Right: Agree */}
              <div className="workflow-branch branch-right">
                <span className="branch-label label-agree">Đồng ý</span>
                <div className="workflow-arrow-v">
                  <svg width="2" height="20" viewBox="0 0 2 20" fill="none">
                    <line x1="1" y1="0" x2="1" y2="20" stroke="var(--border-color)" strokeWidth="2" />
                  </svg>
                </div>

                {/* Node 3: Ask Supply */}
                <div className="workflow-node action-node">
                  <div className="node-icon">📝</div>
                  <div className="node-content">
                    <span className="node-tag">Bước 3: Lựa chọn vật tư</span>
                    <h5 className="node-title">Hỏi phương án cung cấp</h5>
                    <p className="node-text">Hỏi ý kiến nhóm đích với 3 phương án phản hồi.</p>
                  </div>
                </div>

                <div className="workflow-arrow-v">
                  <svg width="2" height="30" viewBox="0 0 2 30" fill="none">
                    <line x1="1" y1="0" x2="1" y2="30" stroke="var(--border-color)" strokeWidth="2" strokeDasharray="3 3" />
                  </svg>
                </div>

                {/* Sub-split */}
                <div className="workflow-split-container">
                  <div className="workflow-split-line">
                    <div className="split-horizontal-line"></div>
                  </div>

                  <div className="workflow-branches">
                    {/* Sub-branch Left: Disagree/Change */}
                    <div className="workflow-branch branch-left">
                      <span className="branch-label label-neutral">Từ chối / Thay đổi</span>
                      <div className="workflow-arrow-v">
                        <svg width="2" height="20" viewBox="0 0 2 20" fill="none">
                          <line x1="1" y1="0" x2="1" y2="20" stroke="var(--border-color)" strokeWidth="2" />
                        </svg>
                      </div>
                      <div className="workflow-node end-node">
                        <div className="node-icon">📢</div>
                        <div className="node-content">
                          <h5 className="node-title">Thông báo trạng thái</h5>
                          <p className="node-text">Cập nhật tin nhắn báo lỗi hoặc yêu cầu chỉnh sửa vật tư.</p>
                        </div>
                      </div>
                    </div>

                    {/* Sub-branch Right: Agree Supply */}
                    <div className="workflow-branch branch-right">
                      <span className="branch-label label-agree">Đồng ý cấp</span>
                      <div className="workflow-arrow-v">
                        <svg width="2" height="20" viewBox="0 0 2 20" fill="none">
                          <line x1="1" y1="0" x2="1" y2="20" stroke="var(--border-color)" strokeWidth="2" />
                        </svg>
                      </div>

                      {/* Node 4: Send Notification */}
                      <div className="workflow-node action-node">
                        <div className="node-icon">📦</div>
                        <div className="node-content">
                          <span className="node-tag">Bước 4: Giao nhận</span>
                          <h5 className="node-title">Yêu cầu phản hồi khi nhận</h5>
                          <p className="node-text">Thông báo vật tư đang đến và yêu cầu reply khi nhận.</p>
                        </div>
                      </div>

                      <div className="workflow-arrow-v">
                        <svg width="2" height="30" viewBox="0 0 2 30" fill="none">
                          <line x1="1" y1="0" x2="1" y2="30" stroke="var(--border-color)" strokeWidth="2" strokeDasharray="3 3" />
                        </svg>
                      </div>

                      {/* Node 5: Success */}
                      <div className="workflow-node success-node">
                        <div className="node-icon">✅</div>
                        <div className="node-content">
                          <span className="node-tag">Bước 5: Nghiệm thu</span>
                          <h5 className="node-title">Nghiệm thu vật tư hoàn tất</h5>
                          <p className="node-text">Hệ thống tự động thông báo đã nghiệm thu vật tư.</p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Render Interactive Configuration Mode (When an automation is selected)
  // ---------------------------------------------------------------------------
  const isCardUnconfigured = (field: 'source' | 'bot' | 'approval' | 'supply' | 'delivery' | 'final' | 'reject') => {
    if (field === 'source') return !automation.sourceGroupId;
    if (field === 'bot') return !automation.botToken;
    if (field === 'approval') return !automation.approvalGroupId;
    if (field === 'supply') return !automation.supplyGroupId;
    if (field === 'delivery') return !automation.deliveryGroupId;
    if (field === 'final') return !automation.finalGroupId;
    if (field === 'reject') return !automation.rejectGroupId;
    return false;
  };

  const isListenerStartable = !!(
    automation.botToken &&
    automation.sourceGroupId
  );

  return (
    <div className="chat-details-view" id="chatDetailsView" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* CSS style injection */}
      <style dangerouslySetInnerHTML={{__html: `
        .interactive-node {
          cursor: pointer !important;
          transition: all 0.2s ease-in-out;
        }
        .interactive-node:hover {
          transform: translateY(-2px);
          border-color: var(--accent-blue) !important;
          box-shadow: 0 4px 14px rgba(0, 0, 0, 0.05);
        }
        .interactive-node.unconfigured {
          border-color: #f59e0b !important;
          animation: pulseBorder 2s infinite;
        }
        @keyframes pulseBorder {
          0% { box-shadow: 0 0 0 0 rgba(245, 158, 11, 0.3); }
          70% { box-shadow: 0 0 0 6px rgba(245, 158, 11, 0); }
          100% { box-shadow: 0 0 0 0 rgba(245, 158, 11, 0); }
        }
        .interactive-node.editing {
          border-color: var(--accent-blue) !important;
          cursor: default !important;
          transform: none !important;
          box-shadow: 0 4px 16px rgba(34, 158, 217, 0.08) !important;
        }
        .workflow-diagram-container {
          user-select: none;
        }
      `}} />

      {/* Header Banner */}
      <div className="chat-banner" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 24px', borderBottom: '1px solid var(--border-color)', background: 'transparent' }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <label className="bot-label" style={{ fontSize: '9px', opacity: 0.7 }}>Tên cấu hình Automation:</label>
          <input 
            type="text" 
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
            onBlur={() => handleRenameSave(nameInput)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleRenameSave(nameInput); }}
            style={{
              background: 'transparent',
              border: 'none',
              fontSize: '18px',
              fontWeight: '700',
              color: 'var(--color-text)',
              padding: '2px 0',
              borderBottom: '1px dashed transparent',
              outline: 'none',
              width: '100%',
              maxWidth: '450px'
            }}
            onFocus={(e) => e.target.style.borderBottom = '1px dashed var(--accent-blue)'}
            placeholder="Nhập tên Automation..."
          />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {/* Global Play/Stop Button */}
          <button
            className={`btn ${listenerActive ? 'btn-danger' : 'btn-start'} bot-toggle-btn`}
            onClick={handleToggleListener}
            disabled={isToggling || !isListenerStartable}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '6px 12px',
              fontSize: '11px',
              fontWeight: '600',
              borderRadius: '4px',
              cursor: !isListenerStartable ? 'not-allowed' : 'pointer',
              opacity: !isListenerStartable ? 0.5 : 1,
              background: listenerActive ? '#ef4444' : '#10b981',
              color: '#ffffff',
              border: 'none',
              transition: 'all 0.15s ease'
            }}
            title={!isListenerStartable ? 'Yêu cầu cấu hình Token Bot toàn cục và Nhóm nguồn (Bước 1) để bắt đầu.' : ''}
          >
            {isToggling ? (
              <><i className="fa-solid fa-circle-notch fa-spin" /> ...</>
            ) : listenerActive ? (
              <><i className="fa-solid fa-stop" /> Dừng hoạt động</>
            ) : (
              <><i className="fa-solid fa-play" /> Bật chuyển tiếp</>
            )}
          </button>

          <button
            className="btn btn-danger"
            onClick={() => {
              if (confirm('Bạn có chắc chắn muốn xóa Automation này?')) {
                onDeleteAutomation(automation.id);
              }
            }}
            style={{ 
              display: 'flex', 
              alignItems: 'center', 
              gap: '6px',
              padding: '6px 12px',
              fontSize: '11px',
              borderRadius: '4px'
            }}
          >
            <i className="fa-solid fa-trash-can" />
            Xóa
          </button>
        </div>
      </div>

      {/* Interactive Workflow Diagram Tree (with Grab-to-Scroll) */}
      <div
        ref={containerRef}
        className={`workflow-diagram-container${isDragging ? ' dragging' : ''}`}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUpOrLeave}
        onMouseLeave={handleMouseUpOrLeave}
        style={{ cursor: isDragging ? 'grabbing' : 'grab', flex: 1, overflow: 'auto', padding: '24px 10px' }}
      >
        <div className="workflow-header-info" style={{ marginBottom: '24px' }}>
          <h4 className="workflow-sub-title" style={{ fontSize: '11px' }}>SƠ ĐỒ CẤU HÌNH QUY TRÌNH AUTOMATION CÔNG TRÌNH</h4>
          <p className="workflow-desc" style={{ fontSize: '11px' }}>
            Nhấp vào từng thẻ quy trình viền vàng để cài đặt. Bật chuyển tiếp ở góc trên bên phải khi hoàn tất.
          </p>
        </div>

        {statusMessage && (
          <div className="bot-status-toast" style={{ position: 'relative', top: 0, left: 0, right: 0, margin: '0 auto 20px auto', width: '100%', maxWidth: '560px', transform: 'none' }}>
            {statusMessage}
          </div>
        )}

        <div className="workflow-tree" style={{ paddingBottom: '40px' }}>
          
          {/* ── NODE 1: SOURCE GROUP CONFIG ── */}
          <div 
            className={`workflow-node start-node interactive-node${editCard === 'source' ? ' editing' : ''}${isCardUnconfigured('source') ? ' unconfigured' : ''}`}
            onClick={() => { if (editCard !== 'source') setEditCard('source'); }}
          >
            <div className="node-icon">📡</div>
            <div className="node-content">
              <span className="node-tag">Bước 1: Trigger</span>
              <h5 className="node-title">Lắng nghe nhóm nguồn và nhiều topic</h5>
              
              {editCard === 'source' ? (
                renderGroupTopicSelector(
                  sourceGroupIdInput,
                  setSourceGroupIdInput,
                  sourceThreadIdsInput,
                  (v: number | '' | number[]) => setSourceThreadIdsInput(Array.isArray(v) ? v : []),
                  () => setEditCard(null),
                  () => handleSaveCard('source')
                )
              ) : (
                <p className="node-text" style={{ fontWeight: '500' }}>
                  {automation.sourceGroupId ? (
                    renderSourceGroupTopicBadge(automation.sourceGroupId, automation.sourceThreadIds)
                  ) : (
                    <span style={{ color: '#f59e0b' }}>⚠️ Nhấp vào đây để chọn nhóm nguồn Telegram.</span>
                  )}
                </p>
              )}
            </div>
          </div>
 
          <div className="workflow-arrow-v">
            <svg width="2" height="30" viewBox="0 0 2 30" fill="none">
              <line x1="1" y1="0" x2="1" y2="30" stroke="var(--border-color)" strokeWidth="2" strokeDasharray="3 3" />
            </svg>
          </div>
 
          {/* ── NODE 2: APPROVAL GROUP CONFIG ── */}
          <div 
            className={`workflow-node action-node interactive-node${editCard === 'approval' ? ' editing' : ''}${isCardUnconfigured('approval') ? ' unconfigured' : ''}`}
            onClick={() => { if (editCard !== 'approval') setEditCard('approval'); }}
          >
            <div className="node-icon">🤖</div>
            <div className="node-content">
              <span className="node-tag">Bước 2: Phê duyệt sơ bộ (Hỏi ý kiến)</span>
              <h5 className="node-title">Bot forward &amp; Hỏi ý kiến</h5>
              
              {editCard === 'approval' ? (
                renderGroupTopicSelector(
                  approvalGroupIdInput,
                  setApprovalGroupIdInput,
                  approvalThreadIdInput,
                  setApprovalThreadIdInput,
                  () => setEditCard(null),
                  () => handleSaveCard('approval')
                )
              ) : (
                <div className="node-text" style={{ fontWeight: '500', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  {automation.approvalGroupId ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                      <span style={{ fontSize: '11px', color: 'var(--color-text-muted)' }}>Phê duyệt:</span>
                      {renderGroupTopicBadge(automation.approvalGroupId, automation.approvalThreadId)}
                    </div>
                  ) : (
                    <span style={{ color: '#f59e0b' }}>⚠️ Chưa cấu hình nhóm Phê duyệt.</span>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="workflow-arrow-v">
            <svg width="2" height="30" viewBox="0 0 2 30" fill="none">
              <line x1="1" y1="0" x2="1" y2="30" stroke="var(--border-color)" strokeWidth="2" strokeDasharray="3 3" />
            </svg>
          </div>

          {/* Split Container */}
          <div className="workflow-split-container">
            <div className="workflow-split-line">
              <div className="split-horizontal-line"></div>
            </div>

            <div className="workflow-branches">
              
              {/* Branch Left: Disagree / Reject */}
              <div className="workflow-branch branch-left">
                <span className="branch-label label-disagree">Không đồng ý</span>
                <div className="workflow-arrow-v">
                  <svg width="2" height="20" viewBox="0 0 2 20" fill="none">
                    <line x1="1" y1="0" x2="1" y2="20" stroke="var(--border-color)" strokeWidth="2" />
                  </svg>
                </div>
                <div 
                  className={`workflow-node end-node interactive-node${editCard === 'reject' ? ' editing' : ''}${isCardUnconfigured('reject') ? ' unconfigured' : ''}`}
                  onClick={() => { if (editCard !== 'reject') setEditCard('reject'); }}
                  style={{ opacity: 0.95 }}
                >
                  <div className="node-icon">❌</div>
                  <div className="node-content">
                    <h5 className="node-title">Thông báo từ chối / Thay đổi</h5>
                    
                    {editCard === 'reject' ? (
                      renderGroupTopicSelector(
                        rejectGroupIdInput,
                        setRejectGroupIdInput,
                        rejectThreadIdInput,
                        setRejectThreadIdInput,
                        () => setEditCard(null),
                        () => handleSaveCard('reject')
                      )
                    ) : (
                      <p className="node-text" style={{ fontWeight: '500' }}>
                        {automation.rejectGroupId ? (
                          renderGroupTopicBadge(automation.rejectGroupId, automation.rejectThreadId)
                        ) : (
                          <span style={{ color: '#f59e0b' }}>⚠️ Nhấp để cấu hình nhóm nhận tin từ chối.</span>
                        )}
                      </p>
                    )}
                  </div>
                </div>
              </div>

              {/* Branch Right: Agree */}
              <div className="workflow-branch branch-right">
                <span className="branch-label label-agree">Đồng ý</span>
                <div className="workflow-arrow-v">
                  <svg width="2" height="20" viewBox="0 0 2 20" fill="none">
                    <line x1="1" y1="0" x2="1" y2="20" stroke="var(--border-color)" strokeWidth="2" />
                  </svg>
                </div>

                {/* ── NODE 3: SUPPLY GROUP CONFIG ── */}
                <div 
                  className={`workflow-node action-node interactive-node${editCard === 'supply' ? ' editing' : ''}${isCardUnconfigured('supply') ? ' unconfigured' : ''}`}
                  onClick={() => { if (editCard !== 'supply') setEditCard('supply'); }}
                >
                  <div className="node-icon">📝</div>
                  <div className="node-content">
                    <span className="node-tag">Bước 3: Lựa chọn vật tư</span>
                    <h5 className="node-title">Hỏi phương án cung cấp</h5>
                    
                    {editCard === 'supply' ? (
                      renderGroupTopicSelector(
                        supplyGroupIdInput,
                        setSupplyGroupIdInput,
                        supplyThreadIdInput,
                        setSupplyThreadIdInput,
                        () => setEditCard(null),
                        () => handleSaveCard('supply')
                      )
                    ) : (
                      <p className="node-text" style={{ fontWeight: '500' }}>
                        {automation.supplyGroupId ? (
                          renderGroupTopicBadge(automation.supplyGroupId, automation.supplyThreadId)
                        ) : (
                          <span style={{ color: '#f59e0b' }}>⚠️ Nhấp để chọn nhóm lựa chọn vật tư.</span>
                        )}
                      </p>
                    )}
                  </div>
                </div>

                <div className="workflow-arrow-v">
                  <svg width="2" height="30" viewBox="0 0 2 30" fill="none">
                    <line x1="1" y1="0" x2="1" y2="30" stroke="var(--border-color)" strokeWidth="2" strokeDasharray="3 3" />
                  </svg>
                </div>

                {/* Sub-split */}
                <div className="workflow-split-container">
                  <div className="workflow-split-line">
                    <div className="split-horizontal-line"></div>
                  </div>

                  <div className="workflow-branches">
                    {/* Sub-branch Left: Disagree/Change */}
                    <div className="workflow-branch branch-left">
                      <span className="branch-label label-neutral">Từ chối / Thay đổi</span>
                      <div className="workflow-arrow-v">
                        <svg width="2" height="20" viewBox="0 0 2 20" fill="none">
                          <line x1="1" y1="0" x2="1" y2="20" stroke="var(--border-color)" strokeWidth="2" />
                        </svg>
                      </div>
                      
                      <div className="workflow-node end-node" style={{ opacity: 0.9 }}>
                        <div className="node-icon">📢</div>
                        <div className="node-content">
                          <h5 className="node-title">Thông báo trạng thái</h5>
                          <div className="node-text" style={{ fontSize: '10px' }}>
                            {automation.rejectGroupId ? (
                              <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexWrap: 'wrap' }}>
                                <span style={{ color: 'var(--color-text-muted)' }}>Gửi đến:</span>
                                {renderGroupTopicBadge(automation.rejectGroupId, automation.rejectThreadId)}
                              </div>
                            ) : (
                              <span>Gửi thông báo huỷ/từ chối/yêu cầu thay đổi.</span>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Sub-branch Right: Agree Supply */}
                    <div className="workflow-branch branch-right">
                      <span className="branch-label label-agree">Đồng ý cấp</span>
                      <div className="workflow-arrow-v">
                        <svg width="2" height="20" viewBox="0 0 2 20" fill="none">
                          <line x1="1" y1="0" x2="1" y2="20" stroke="var(--border-color)" strokeWidth="2" />
                        </svg>
                      </div>

                      {/* ── NODE 4: DELIVERY GROUP CONFIG ── */}
                      <div 
                        className={`workflow-node action-node interactive-node${editCard === 'delivery' ? ' editing' : ''}${isCardUnconfigured('delivery') ? ' unconfigured' : ''}`}
                        onClick={() => { if (editCard !== 'delivery') setEditCard('delivery'); }}
                      >
                        <div className="node-icon">📦</div>
                        <div className="node-content">
                          <span className="node-tag">Bước 4: Giao nhận</span>
                          <h5 className="node-title">Yêu cầu phản hồi khi nhận</h5>
                          
                          {editCard === 'delivery' ? (
                            renderGroupTopicSelector(
                              deliveryGroupIdInput,
                              setDeliveryGroupIdInput,
                              deliveryThreadIdInput,
                              setDeliveryThreadIdInput,
                              () => setEditCard(null),
                              () => handleSaveCard('delivery')
                            )
                          ) : (
                            <p className="node-text" style={{ fontWeight: '500' }}>
                              {automation.deliveryGroupId ? (
                                renderGroupTopicBadge(automation.deliveryGroupId, automation.deliveryThreadId)
                              ) : (
                                <span style={{ color: '#f59e0b' }}>⚠️ Nhấp để chọn nhóm giao nhận.</span>
                              )}
                            </p>
                          )}
                        </div>
                      </div>

                      <div className="workflow-arrow-v">
                        <svg width="2" height="30" viewBox="0 0 2 30" fill="none">
                          <line x1="1" y1="0" x2="1" y2="30" stroke="var(--border-color)" strokeWidth="2" strokeDasharray="3 3" />
                        </svg>
                      </div>

                      {/* ── NODE 5: CONTROL SWITCH & STATS & FINAL GROUP ── */}
                      <div 
                        className={`workflow-node success-node interactive-node${editCard === 'final' ? ' editing' : ''}${isCardUnconfigured('final') ? ' unconfigured' : ''}`}
                        onClick={() => { if (editCard !== 'final') setEditCard('final'); }}
                        style={{
                          borderColor: listenerActive ? 'rgba(16, 185, 129, 0.4)' : 'var(--border-color)',
                        }}
                      >
                        <div className="node-icon">{listenerActive ? '⚡' : '✅'}</div>
                        <div className="node-content" style={{ width: '100%' }}>
                          <span className="node-tag">Bước 5: Nghiệm thu</span>
                          <h5 className="node-title">Nghiệm thu vật tư &amp; Chạy forwarder</h5>
                          
                          {editCard === 'final' ? (
                            renderGroupTopicSelector(
                              finalGroupIdInput,
                              setFinalGroupIdInput,
                              finalThreadIdInput,
                              setFinalThreadIdInput,
                              () => setEditCard(null),
                              () => handleSaveCard('final')
                            )
                          ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '6px', textAlign: 'left' }}>
                              <div style={{ fontWeight: '500', fontSize: '11px' }}>
                                {automation.finalGroupId ? (
                                  renderGroupTopicBadge(automation.finalGroupId, automation.finalThreadId)
                                ) : (
                                  <span style={{ color: '#f59e0b' }}>⚠️ Nhấp để cấu hình nhóm nghiệm thu.</span>
                                )}
                              </div>

                              {/* Stats */}
                              <div style={{ display: 'flex', gap: '8px', fontSize: '11px', color: 'var(--color-text-muted)' }}>
                                <span>Forward: <strong>{forwardCount} tin</strong></span>
                                <span>•</span>
                                <span>Gần nhất: <strong>{formatTime(lastForwardTime)}</strong></span>
                              </div>
                              
                              {/* Preview */}
                              {lastPreview && (
                                <div style={{ background: 'var(--bg-primary)', border: '1px solid var(--border-color)', padding: '4px 8px', borderRadius: '4px', fontSize: '10px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--color-text-muted)', width: '100%', maxWidth: '280px' }}>
                                  <i className="fa-solid fa-message" /> {lastPreview}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </div>

                    </div>
                  </div>
                </div>

              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
