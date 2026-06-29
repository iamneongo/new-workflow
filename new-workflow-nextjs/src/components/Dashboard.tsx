'use client';

import React, { useCallback, useEffect, useState } from 'react';
import type { ChatEntry, AutomationSetup } from '@/lib/automation-types';
import ChatsList from './ChatsList';
import ChatDetails from './ChatDetails';
import RenameModal from './RenameModal';
import AuthModal from './AuthModal';
import BotConfigPanel from './BotConfigPanel';
import AppTour from './AppTour';

type ConnectionStatus = 'connecting' | 'online' | 'offline';

type LogLevel = 'info' | 'warn' | 'error' | 'success';

interface RuntimeLogEntry {
  id: string;
  ts: number;
  level: LogLevel;
  source: string;
  message: string;
  step?: string;
  automationId?: string;
}

interface ListenerState {
  active: boolean;
  count: number;
  lastTime: number | null;
  lastPreview: string | null;
}

type WorkflowNodeKey = 'source' | 'approval' | 'reject' | 'supply' | 'supplyChange' | 'delivery' | 'final';

function reorderAutomationsList(items: AutomationSetup[], draggedId: string, targetId: string): AutomationSetup[] {
  const draggedIndex = items.findIndex((item) => item.id === draggedId);
  const targetIndex = items.findIndex((item) => item.id === targetId);
  if (draggedIndex < 0 || targetIndex < 0 || draggedIndex === targetIndex) {
    return items;
  }

  const next = [...items];
  const [draggedItem] = next.splice(draggedIndex, 1);
  next.splice(targetIndex, 0, draggedItem);
  return next.map((item, index) => ({
    ...item,
    sortOrder: index,
  }));
}

export default function Dashboard() {
  const [chats, setChats] = useState<Record<string, ChatEntry>>({});
  const [automations, setAutomations] = useState<AutomationSetup[]>([]);
  const [selectedAutomationId, setSelectedAutomationId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('connecting');
  const [isSyncing, setIsSyncing] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  // Lifted tab state for ChatDetails (config or diagram)
  const [detailsTab, setDetailsTab] = useState<'config' | 'diagram'>('config');

  // Track listener states for each automation setup ID
  const [listenerStates, setListenerStates] = useState<Record<string, ListenerState>>({});
  const [runtimeLogs, setRuntimeLogs] = useState<RuntimeLogEntry[]>([]);

  // Rename modal state (legacy forum topic rename, can keep intact)
  const [renameModal, setRenameModal] = useState<{
    isOpen: boolean;
    chatId: string;
    threadId: number;
    currentName: string;
  }>({ isOpen: false, chatId: '', threadId: 0, currentName: '' });

  // Auth modal state
  const [authModal, setAuthModal] = useState<{
    isOpen: boolean;
    field: 'phone' | 'code' | 'password' | null;
  }>({ isOpen: false, field: null });

  const [createAutomationModal, setCreateAutomationModal] = useState<{
    isOpen: boolean;
    name: string;
  }>({ isOpen: false, name: '' });

  const [deleteConfirmModal, setDeleteConfirmModal] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    confirmText: string;
    onConfirm: (() => void | Promise<void>) | null;
  }>({
    isOpen: false,
    title: '',
    message: '',
    confirmText: 'Xóa',
    onConfirm: null,
  });

  const [isBotConfigOpen, setIsBotConfigOpen] = useState(false);
  const [isRuntimeLogOpen, setIsRuntimeLogOpen] = useState(false);
  const [activeWorkflowNode, setActiveWorkflowNode] = useState<WorkflowNodeKey | null>(null);

  const pushRuntimeLog = useCallback((entry: Omit<RuntimeLogEntry, 'id' | 'ts'> & { ts?: number }) => {
    setRuntimeLogs((prev) => {
      const next = [
        {
          id: `${entry.source}-${entry.step || 'general'}-${entry.ts || Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          ts: entry.ts || Date.now(),
          level: entry.level,
          source: entry.source,
          message: entry.message,
          step: entry.step,
          automationId: entry.automationId,
        },
        ...prev,
      ];
      return next.slice(0, 80);
    });
  }, []);

  const latestRuntimeLog = runtimeLogs[0] || null;
  const runtimeLogCount = runtimeLogs.length;

  // 1. Fetch all custom automations
  const fetchAutomations = useCallback(async () => {
    try {
      const res = await fetch('/api/automations');
      if (res.ok) {
        const data = await res.json();
        setAutomations(data);
      }
    } catch (err) {
      console.error('Error fetching automations:', err);
    }
  }, []);

  // 2. Fetch list of active listeners
  const fetchActiveListeners = useCallback(async () => {
    try {
      const res = await fetch('/api/listener');
      if (res.ok) {
        const data = await res.json();
        if (data.activeListeners) {
          setListenerStates((prev) => {
            const next = { ...prev };
            for (const id of data.activeListeners) {
              if (!next[id]) {
                next[id] = {
                  active: true,
                  count: 0,
                  lastTime: null,
                  lastPreview: null,
                };
              } else {
                next[id].active = true;
              }
            }
            return next;
          });
        }
      }
    } catch (err) {
      console.error('Error fetching active listeners list:', err);
    }
  }, []);

  // 3. Fetch single automation stats when selection changes
  useEffect(() => {
    if (!selectedAutomationId) return;

    const loadStats = async () => {
      try {
        const res = await fetch(`/api/listener?automationId=${selectedAutomationId}`);
        if (res.ok) {
          const data = await res.json();
          setListenerStates((prev) => ({
            ...prev,
            [selectedAutomationId]: {
              active: data.active,
              count: data.forwardCount || 0,
              lastTime: data.lastForwardTime || null,
              lastPreview: prev[selectedAutomationId]?.lastPreview || null, // preserve preview
            },
          }));
        }
      } catch (err) {
        console.error(`Error loading stats for automation ${selectedAutomationId}:`, err);
      }
    };
    loadStats();
  }, [selectedAutomationId]);

  // 4. Fetch raw Telegram chats (groups and channels)
  const fetchChats = useCallback(async () => {
    try {
      const res = await fetch('/api/chats');
      if (res.ok) {
        const data = await res.json();
        setChats(data);
        setIsLoading(false);
      }
    } catch (err) {
      console.error('Error fetching chats:', err);
      setIsLoading(false);
    }
  }, []);

  // 5. SSE: subscribe to real-time events
  useEffect(() => {
    const source = new EventSource('/api/stream');

    source.onopen = () => {
      setConnectionStatus('online');
      pushRuntimeLog({ level: 'success', source: 'sse', message: 'Kết nối stream real-time đã mở.' });
    };
    source.onerror = () => {
      setConnectionStatus('offline');
      pushRuntimeLog({ level: 'error', source: 'sse', message: 'Mất kết nối stream real-time.' });
    };

    source.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        if (data.type === 'syncStart') {
          setIsSyncing(true);
          pushRuntimeLog({ level: 'info', source: 'sync', message: 'Bắt đầu đồng bộ dữ liệu.' });
        } else if (data.type === 'syncComplete') {
          setIsSyncing(false);
          fetchChats();
          pushRuntimeLog({ level: 'success', source: 'sync', message: 'Đồng bộ dữ liệu hoàn tất.' });
        } else if (data.type === 'syncError') {
          setIsSyncing(false);
          alert(`Lỗi đồng bộ: ${data.error}`);
          pushRuntimeLog({ level: 'error', source: 'sync', message: data.error || 'Đồng bộ lỗi.' });
        } else if (data.type === 'update') {
          setChats((prev) => ({ ...prev, [data.chat.chatId]: data.chat }));
        } else if (data.type === 'authRequired') {
          setAuthModal({ isOpen: true, field: data.field });
          pushRuntimeLog({ level: 'warn', source: 'auth', message: `Cần xác thực bước ${data.field}.` });
        } else if (data.type === 'connected') {
          setConnectionStatus('online');
          setAuthModal({ isOpen: false, field: null });
          pushRuntimeLog({ level: 'success', source: 'telegram', message: 'Telegram client đã kết nối.' });
        } else if (data.type === 'authError') {
          alert(`Lỗi xác thực: ${data.message}`);
          pushRuntimeLog({ level: 'error', source: 'auth', message: data.message || 'Lỗi xác thực.' });
        } else if (data.type === 'listenerStarted') {
          const aid = data.automationId;
          if (aid) {
            setListenerStates((prev) => ({
              ...prev,
              [aid]: {
                ...(prev[aid] || { count: 0, lastTime: null, lastPreview: null }),
                active: true,
              },
            }));
            fetchAutomations();
            pushRuntimeLog({ level: 'success', source: 'listener', automationId: aid, message: 'Listener đã bật.' });
          }
        } else if (data.type === 'listenerStopped') {
          const aid = data.automationId;
          if (aid) {
            setListenerStates((prev) => ({
              ...prev,
              [aid]: {
                ...(prev[aid] || { count: 0, lastTime: null, lastPreview: null }),
                active: false,
              },
            }));
            fetchAutomations();
            pushRuntimeLog({ level: 'warn', source: 'listener', automationId: aid, message: 'Listener đã dừng.' });
          }
        } else if (data.type === 'messageForwarded') {
          const aid = data.automationId;
          if (aid) {
            setListenerStates((prev) => ({
              ...prev,
              [aid]: {
                active: true,
                count: data.count,
                lastTime: data.lastTime,
                lastPreview: data.preview,
              },
            }));
            pushRuntimeLog({
              level: 'success',
              source: 'bot',
              automationId: aid,
              message: `Đã xử lý tin nhắn. Tổng: ${data.count}.`,
            });
          }
        } else if (data.type === 'forwardError') {
          console.error('[SSE] Forward error:', data.error);
          pushRuntimeLog({ level: 'error', source: 'bot', message: data.error || 'Forward error.' });
        } else if (data.type === 'log') {
          pushRuntimeLog({
            level: data.level || 'info',
            source: data.source || 'runtime',
            automationId: data.automationId,
            step: data.step,
            message: data.message || JSON.stringify(data),
            ts: data.ts,
          });
        }
      } catch (e) {
        // ignore parse errors
      }
    };

    return () => source.close();
  }, [fetchChats, fetchAutomations, pushRuntimeLog]);

  // Initial load
  useEffect(() => {
    fetchChats();
    fetchAutomations();
    fetchActiveListeners();
  }, [fetchChats, fetchAutomations, fetchActiveListeners]);

  // Trigger connect on first load
  useEffect(() => {
    fetch('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'connect' }),
    }).catch(console.error);
  }, []);

  // Sync button
  const handleSync = async () => {
    try {
      const res = await fetch('/api/sync', { method: 'POST' });
      if (!res.ok) {
        const err = await res.json();
        alert(err.error || 'Lỗi bắt đầu đồng bộ');
      }
    } catch {
      alert('Không thể kết nối tới server để đồng bộ');
    }
  };

  // Create new automation setup
  const openCreateAutomationModal = () => {
    setCreateAutomationModal({
      isOpen: true,
      name: `Automation mới ${automations.length + 1}`,
    });
  };

  const handleCreateAutomation = async () => {
    const name = createAutomationModal.name.trim();
    if (!name) return;
    const newId = `auto_${Date.now()}`;
    try {
      const res = await fetch('/api/automations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: newId,
          name,
        }),
      });
      if (res.ok) {
        setCreateAutomationModal({ isOpen: false, name: '' });
        await fetchAutomations();
        setSelectedAutomationId(newId);
        setDetailsTab('config');
      } else {
        const err = await res.json().catch(() => ({}));
        alert(err.error || 'Tạo automation mới thất bại');
      }
    } catch {
      alert('Lỗi kết nối khi tạo automation');
    }
  };

  // Save automation settings
  const handleSaveAutomation = async (setup: Partial<AutomationSetup> & { id: string; restartIfListening?: boolean }) => {
    const res = await fetch('/api/automations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(setup),
    });
    if (res.ok) {
      await fetchAutomations();
    } else {
      const err = await res.json();
      throw new Error(err.error || 'Lỗi không xác định khi lưu cấu hình');
    }
  };

  const handleReorderAutomation = useCallback(async (draggedId: string, targetId: string) => {
    const nextAutomations = reorderAutomationsList(automations, draggedId, targetId);
    if (nextAutomations === automations) {
      return;
    }

    setAutomations(nextAutomations);

    try {
      const res = await fetch('/api/automations', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderedIds: nextAutomations.map((item) => item.id),
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Không thể lưu thứ tự automation');
      }
    } catch (error: any) {
      await fetchAutomations();
      alert(error?.message || 'Không thể lưu thứ tự automation');
    }
  }, [automations, fetchAutomations]);

  // Delete automation setup
  const handleDeleteAutomation = async (id: string) => {
    try {
      const res = await fetch(`/api/automations/${id}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        setSelectedAutomationId(null);
        await fetchAutomations();
        await fetchActiveListeners();
      } else {
        alert('Xóa automation thất bại');
      }
    } catch {
      alert('Lỗi kết nối khi xóa');
    }
  };

  const requestDeleteConfirm = (options: {
    title: string;
    message: string;
    confirmText?: string;
    onConfirm: () => void | Promise<void>;
  }) => {
    setDeleteConfirmModal({
      isOpen: true,
      title: options.title,
      message: options.message,
      confirmText: options.confirmText || 'Xóa',
      onConfirm: options.onConfirm,
    });
  };

  // Click "Cấu hình Bot" button in header
  const handleHeaderBotConfigClick = () => {
    setIsBotConfigOpen(true);
  };

  const handleLogout = async () => {
    const confirmed = window.confirm('Bạn có chắc chắn muốn đăng xuất Telegram account hiện tại?');
    if (!confirmed) return;

    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'logout' }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(err.error || 'Đăng xuất thất bại');
        return;
      }

      window.location.reload();
    } catch {
      alert('Lỗi kết nối khi đăng xuất');
    }
  };

  // Rename modal handlers (legacy topic rename)
  const openRenameModal = (chatId: string, threadId: number, currentName: string) => {
    setRenameModal({ isOpen: true, chatId, threadId, currentName });
  };

  const handleRenameSave = async (newName: string) => {
    try {
      const res = await fetch('/api/chats/rename-topic', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chatId: renameModal.chatId,
          threadId: renameModal.threadId,
          newName,
        }),
      });

      if (res.ok) {
        setRenameModal((prev) => ({ ...prev, isOpen: false }));
        await fetchChats();
      } else {
        const err = await res.json();
        alert('Đổi tên thất bại: ' + (err.error || 'Lỗi không xác định'));
      }
    } catch {
      alert('Lỗi kết nối khi gửi yêu cầu đổi tên');
    }
  };

  // Auth modal handlers
  const handleAuthSubmit = async (value: string) => {
    if (!authModal.field) return;
    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: authModal.field, value }),
      });
      if (!res.ok) {
        const err = await res.json();
        alert('Lỗi: ' + err.error);
      } else {
        setAuthModal({ isOpen: false, field: null });
      }
    } catch {
      alert('Lỗi kết nối khi gửi xác thực');
    }
  };

  const totalGroups = Object.keys(chats).length;
  const totalTopics = Object.values(chats).reduce(
    (acc, chat) => acc + (chat.topics ? Object.keys(chat.topics).length : 0),
    0
  );

  const statusText =
    connectionStatus === 'online'
      ? 'Đang trực tuyến'
      : connectionStatus === 'connecting'
      ? 'Đang kết nối...'
      : 'Mất kết nối';

  const selectedAutomation = selectedAutomationId
    ? automations.find((a) => a.id === selectedAutomationId) || null
    : null;

  // Selected automation's active states and stats
  const selectedState = selectedAutomationId
    ? listenerStates[selectedAutomationId] || { active: false, count: 0, lastTime: null, lastPreview: null }
    : { active: false, count: 0, lastTime: null, lastPreview: null };

  const activeListenerCount = Object.values(listenerStates).filter((s) => s.active).length;
  const anyListenerActive = activeListenerCount > 0;

  return (
    <div className="app-container">
      {/* Header */}
      <header className="app-header">
        <div className="logo-area" id="appBrand">
          <div className="logo-icon">
            <i className="fa-brands fa-telegram" />
          </div>
          <div className="logo-text">
            <h1>Telegram Bot Tracker</h1>
            <p>Giám sát nhóm &amp; chủ đề tự động 100%</p>
          </div>
        </div>

        <div className="header-widgets">
          <button
            className="btn btn-secondary"
            id="btnBotConfig"
            onClick={handleHeaderBotConfigClick}
            style={{ border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.03)' }}
          >
            <i className="fa-solid fa-robot" />
            Cấu hình Bot
          </button>

          <AppTour
            selectedAutomationId={selectedAutomationId}
            hasAutomations={automations.length > 0}
            activeWorkflowNode={activeWorkflowNode}
          />

          <button
            className="btn btn-primary"
            id="btnSync"
            onClick={handleSync}
            disabled={isSyncing}
          >
            <i className={`fa-solid fa-rotate${isSyncing ? ' fa-spin' : ''}`} />
            {isSyncing ? ' Đang đồng bộ...' : ' Đồng bộ ngay'}
          </button>

          <button
            className="btn btn-secondary"
            id="btnLogout"
            onClick={handleLogout}
            style={{ border: '1px solid rgba(239,68,68,0.22)', background: 'rgba(239,68,68,0.08)', color: '#b91c1c' }}
          >
            <i className="fa-solid fa-right-from-bracket" />
            Đăng xuất
          </button>

          {anyListenerActive && (
            <div className="stat-badge" style={{ borderColor: 'rgba(16, 185, 129, 0.4)', background: 'rgba(16, 185, 129, 0.08)' }}>
              <span className="stat-num" style={{ color: '#10b981', display: 'flex', alignItems: 'center', gap: '5px', fontSize: '13px' }}>
                <i className="fa-solid fa-satellite-dish fa-beat" style={{ fontSize: '11px' }} /> {activeListenerCount} Active
              </span>
              <span className="stat-label">Bot Forward</span>
            </div>
          )}

          <div className="stat-badge" id="statsGroups">
            <span className="stat-num">{totalGroups}</span>
            <span className="stat-label">Nhóm</span>
          </div>

          <div className="stat-badge" id="statsTopics">
            <span className="stat-num">{totalTopics}</span>
            <span className="stat-label">Chủ đề</span>
          </div>

          <div className={`status-indicator${connectionStatus === 'online' ? ' online' : ''}`} id="connectionStatus">
            <span className="status-dot" />
            <span className="status-text">{statusText}</span>
          </div>
        </div>
      </header>

      {/* Main */}
      {isRuntimeLogOpen ? (
        <section className="runtime-log-section" id="runtimeLogSection" style={{ padding: '0 24px 12px 24px' }}>
          <div
            style={{
              border: '1px solid #e7e1d8',
              borderRadius: '16px',
              background: '#fbfaf7',
              overflow: 'hidden',
              boxShadow: '0 8px 24px rgba(15, 23, 42, 0.04)',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '12px',
                padding: '12px 16px',
                borderBottom: '1px solid #e9e3da',
                background: 'linear-gradient(180deg, rgba(255,255,255,0.9), rgba(248,246,241,0.95))',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '28px', height: '28px', borderRadius: '999px', background: '#f3efe8', color: '#4b5563' }}>
                  <i className="fa-solid fa-wave-square" />
                </span>
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    <strong style={{ fontSize: '13px', color: '#1f2937' }}>Runtime Log</strong>
                    <span style={{ fontSize: '11px', color: '#6b7280' }}>Theo dõi bottleneck, lỗi và nhịp xử lý</span>
                  </div>
                  <div style={{ fontSize: '11px', color: '#9ca3af', marginTop: '2px' }}>
                    {runtimeLogCount === 0 ? 'Chưa có log mới' : `${runtimeLogCount} bản ghi gần nhất`}
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                <button
                  className="btn btn-secondary"
                  onClick={() => setIsRuntimeLogOpen(false)}
                  style={{ padding: '4px 10px', fontSize: '11px', background: '#fff', borderColor: '#ddd6cb', color: '#374151' }}
                >
                  Đóng
                </button>
                <button
                  className="btn btn-secondary"
                  onClick={() => setRuntimeLogs([])}
                  style={{ padding: '4px 10px', fontSize: '11px', background: '#fff', borderColor: '#ddd6cb', color: '#374151' }}
                >
                  Xóa log
                </button>
              </div>
            </div>

            <div style={{ maxHeight: '240px', overflowY: 'auto', padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: '8px', background: '#fbfaf7' }}>
              {runtimeLogs.length === 0 ? (
                <div style={{ fontSize: '12px', color: '#6b7280' }}>
                  Chưa có log mới. Khi bạn bấm lưu/bật listener/gửi tin nhắn, log sẽ hiện ở đây.
                </div>
              ) : (
                runtimeLogs.map((entry) => {
                  const tone =
                    entry.level === 'error'
                      ? { bg: '#fef2f2', border: '#fecaca', color: '#b91c1c', label: 'ERROR' }
                      : entry.level === 'warn'
                      ? { bg: '#fffbeb', border: '#fde68a', color: '#b45309', label: 'WARN' }
                      : entry.level === 'success'
                      ? { bg: '#ecfdf5', border: '#a7f3d0', color: '#047857', label: 'SUCCESS' }
                      : { bg: '#eff6ff', border: '#bfdbfe', color: '#2563eb', label: 'INFO' };
                  return (
                    <div
                      key={entry.id}
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '92px 76px 130px 1fr',
                        gap: '10px',
                        alignItems: 'start',
                        padding: '10px 12px',
                        border: `1px solid ${tone.border}`,
                        borderRadius: '12px',
                        background: tone.bg,
                      }}
                    >
                      <span style={{ color: '#6b7280', fontFamily: 'monospace', fontSize: '11px', whiteSpace: 'nowrap' }}>
                        {new Date(entry.ts).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                      </span>
                      <span style={{ display: 'inline-flex', justifyContent: 'center', padding: '4px 8px', borderRadius: '999px', background: '#fff', border: `1px solid ${tone.border}`, color: tone.color, fontWeight: 700, textTransform: 'uppercase', fontSize: '11px', letterSpacing: '0.03em' }}>
                        {tone.label}
                      </span>
                      <span style={{ color: '#6b7280', fontSize: '11px' }}>
                        {entry.source}{entry.step ? ` / ${entry.step}` : ''}
                      </span>
                      <span style={{ color: '#1f2937', fontSize: '12px', lineHeight: 1.5, wordBreak: 'break-word', whiteSpace: 'pre-wrap' }}>
                        {entry.message}
                      </span>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </section>
      ) : (
        <div style={{ padding: '0 24px 10px 24px' }}>
          <button
            type="button"
            id="runtimeLogToggle"
            className="btn btn-secondary"
            onClick={() => setIsRuntimeLogOpen(true)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
              padding: '6px 10px',
              borderRadius: '999px',
              border: '1px dashed #ddd6cb',
              background: '#fbfaf7',
              color: '#374151',
              fontSize: '12px',
              boxShadow: 'none',
              width: 'fit-content',
            }}
          >
            <i className="fa-solid fa-wave-square" />
            Mở runtime log
          </button>
        </div>
      )}

      <main className="app-main">
        {/* Left sidebar */}
        <section className="sidebar-section">
          {isLoading ? (
            <div className="loading-placeholder">
              <i className="fa-solid fa-circle-notch fa-spin" />
              <p>Đang tải dữ liệu...</p>
            </div>
          ) : (
            <ChatsList
              automations={automations}
              selectedAutomationId={selectedAutomationId}
              searchQuery={searchQuery}
              onSearchChange={setSearchQuery}
              onSelectAutomation={(id) => {
                setSelectedAutomationId(id);
                setDetailsTab('config');
              }}
              onCreateAutomation={openCreateAutomationModal}
              onReorderAutomation={handleReorderAutomation}
              chats={chats}
            />
          )}
        </section>

        {/* Right details */}
        <section className="details-section" id="detailsSection">
          <ChatDetails
            automation={selectedAutomation}
            onDeleteAutomation={handleDeleteAutomation}
            onRequestDeleteConfirm={requestDeleteConfirm}
            onSaveAutomation={handleSaveAutomation}
            chats={chats}
            activeTab={detailsTab}
            setActiveTab={setDetailsTab}
            listenerActive={selectedState.active}
            forwardCount={selectedState.count}
            lastForwardTime={selectedState.lastTime}
            lastPreview={selectedState.lastPreview}
            onListenerToggle={(active) => {
              setListenerStates((prev) => ({
                ...prev,
                [selectedAutomationId!]: {
                  ...(prev[selectedAutomationId!] || { lastPreview: null }),
                  active,
                },
              }));
            }}
            onListenerChange={fetchActiveListeners}
            onRename={openRenameModal}
            onActiveNodeChange={setActiveWorkflowNode}
          />
        </section>
      </main>

      {createAutomationModal.isOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 80, padding: '20px' }}>
          <div style={{ width: '100%', maxWidth: '420px', background: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: '14px', boxShadow: '0 20px 50px rgba(15, 23, 42, 0.18)', padding: '18px' }}>
            <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: 'var(--color-text)' }}>Tạo automation mới</h3>
            <p style={{ margin: '8px 0 14px', fontSize: '13px', lineHeight: 1.6, color: 'var(--color-text-muted)' }}>
              Nhập tên để tạo một luồng mới. Tên này sẽ hiện trong danh sách bên trái.
            </p>
            <input
              value={createAutomationModal.name}
              onChange={(e) => setCreateAutomationModal((prev) => ({ ...prev, name: e.target.value }))}
              placeholder="Ví dụ: Automation công trình A"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  void handleCreateAutomation();
                }
              }}
              style={{ width: '100%', border: '1px solid var(--border-color)', background: 'var(--bg-secondary)', color: 'var(--color-text)', borderRadius: '8px', padding: '10px 12px', fontSize: '14px', outline: 'none' }}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '16px' }}>
              <button type="button" onClick={() => setCreateAutomationModal({ isOpen: false, name: '' })} style={{ border: '1px solid var(--border-color)', background: 'var(--bg-secondary)', color: 'var(--color-text)', borderRadius: '8px', padding: '8px 12px', cursor: 'pointer' }}>
                Hủy
              </button>
              <button type="button" onClick={() => void handleCreateAutomation()} style={{ border: 'none', background: 'var(--accent-blue)', color: '#fff', borderRadius: '8px', padding: '8px 12px', cursor: 'pointer', fontWeight: 600 }}>
                Tạo
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteConfirmModal.isOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 85, padding: '20px' }}>
          <div style={{ width: '100%', maxWidth: '460px', background: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: '14px', boxShadow: '0 20px 50px rgba(15, 23, 42, 0.18)', padding: '18px' }}>
            <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: 'var(--color-text)' }}>{deleteConfirmModal.title}</h3>
            <p style={{ margin: '8px 0 0', fontSize: '13px', lineHeight: 1.6, color: 'var(--color-text-muted)' }}>{deleteConfirmModal.message}</p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '16px' }}>
              <button type="button" onClick={() => setDeleteConfirmModal({ isOpen: false, title: '', message: '', confirmText: 'Xóa', onConfirm: null })} style={{ border: '1px solid var(--border-color)', background: 'var(--bg-secondary)', color: 'var(--color-text)', borderRadius: '8px', padding: '8px 12px', cursor: 'pointer' }}>
                Hủy
              </button>
              <button
                type="button"
                onClick={async () => {
                  const action = deleteConfirmModal.onConfirm;
                  setDeleteConfirmModal({ isOpen: false, title: '', message: '', confirmText: 'Xóa', onConfirm: null });
                  if (action) {
                    await action();
                  }
                }}
                style={{ border: 'none', background: '#ef4444', color: '#fff', borderRadius: '8px', padding: '8px 12px', cursor: 'pointer', fontWeight: 600 }}
              >
                {deleteConfirmModal.confirmText}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Rename Modal */}
      <RenameModal
        isOpen={renameModal.isOpen}
        currentName={renameModal.currentName}
        onClose={() => setRenameModal((prev) => ({ ...prev, isOpen: false }))}
        onSave={handleRenameSave}
      />

      {/* Auth Modal */}
      <AuthModal
        isOpen={authModal.isOpen}
        field={authModal.field}
        onSubmit={handleAuthSubmit}
      />

      {/* Global Bot Config Modal */}
      <BotConfigPanel
        isOpen={isBotConfigOpen}
        onClose={() => setIsBotConfigOpen(false)}
        onSaveSuccess={fetchAutomations}
      />
    </div>
  );
}
