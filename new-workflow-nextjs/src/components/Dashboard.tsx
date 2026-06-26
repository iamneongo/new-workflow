'use client';

import React, { useCallback, useEffect, useState } from 'react';
import type { ChatEntry, AutomationSetup } from '@/lib/automation-types';
import ChatsList from './ChatsList';
import ChatDetails from './ChatDetails';
import RenameModal from './RenameModal';
import AuthModal from './AuthModal';
import BotConfigPanel from './BotConfigPanel';

type ConnectionStatus = 'connecting' | 'online' | 'offline';

interface ListenerState {
  active: boolean;
  count: number;
  lastTime: number | null;
  lastPreview: string | null;
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

  const [isBotConfigOpen, setIsBotConfigOpen] = useState(false);

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

    source.onopen = () => setConnectionStatus('online');
    source.onerror = () => setConnectionStatus('offline');

    source.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        if (data.type === 'syncStart') {
          setIsSyncing(true);
        } else if (data.type === 'syncComplete') {
          setIsSyncing(false);
          fetchChats();
        } else if (data.type === 'syncError') {
          setIsSyncing(false);
          alert(`Lỗi đồng bộ: ${data.error}`);
        } else if (data.type === 'update') {
          setChats((prev) => ({ ...prev, [data.chat.chatId]: data.chat }));
        } else if (data.type === 'authRequired') {
          setAuthModal({ isOpen: true, field: data.field });
        } else if (data.type === 'connected') {
          setConnectionStatus('online');
          setAuthModal({ isOpen: false, field: null });
        } else if (data.type === 'authError') {
          alert(`Lỗi xác thực: ${data.message}`);
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
          }
        } else if (data.type === 'forwardError') {
          console.error('[SSE] Forward error:', data.error);
        }
      } catch (e) {
        // ignore parse errors
      }
    };

    return () => source.close();
  }, [fetchChats, fetchAutomations]);

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
  const handleCreateAutomation = async () => {
    const newId = `auto_${Date.now()}`;
    try {
      const res = await fetch('/api/automations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: newId,
          name: 'Automation mới ' + (automations.length + 1),
        }),
      });
      if (res.ok) {
        await fetchAutomations();
        setSelectedAutomationId(newId);
        setDetailsTab('config');
      } else {
        alert('Tạo automation mới thất bại');
      }
    } catch {
      alert('Lỗi kết nối khi tạo automation');
    }
  };

  // Save automation settings
  const handleSaveAutomation = async (setup: Partial<AutomationSetup> & { id: string }) => {
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

  // Click "Cấu hình Bot" button in header
  const handleHeaderBotConfigClick = () => {
    setIsBotConfigOpen(true);
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
        <div className="logo-area">
          <div className="logo-icon">
            <i className="fa-brands fa-telegram" />
          </div>
          <div className="logo-text">
            <h1>Telegram Userbot Tracker</h1>
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

          <button
            className="btn btn-primary"
            id="btnSync"
            onClick={handleSync}
            disabled={isSyncing}
          >
            <i className={`fa-solid fa-rotate${isSyncing ? ' fa-spin' : ''}`} />
            {isSyncing ? ' Đang đồng bộ...' : ' Đồng bộ ngay'}
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
              onCreateAutomation={handleCreateAutomation}
              chats={chats}
            />
          )}
        </section>

        {/* Right details */}
        <section className="details-section" id="detailsSection">
          <ChatDetails
            automation={selectedAutomation}
            onDeleteAutomation={handleDeleteAutomation}
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
          />
        </section>
      </main>

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
