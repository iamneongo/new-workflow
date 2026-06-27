'use client';

import React, { useState, useEffect, useRef } from 'react';
import type { ChatEntry, AutomationSetup, TopicEntry, ApprovalMessageMode, SupplierRoute, SupplierRouteMode, FinalMessageMode, SupplyChangeMessageMode } from '@/lib/automation-types';
import { DEFAULT_APPROVAL_CUSTOM_MESSAGE } from '@/lib/automation-types';

type WorkflowNodeKey = 'source' | 'approval' | 'reject' | 'supply' | 'supplyChange' | 'delivery' | 'final';

interface ChatDetailsProps {
  automation: AutomationSetup | null;
  onDeleteAutomation: (id: string) => void;
  onSaveAutomation: (setup: Partial<AutomationSetup> & { id: string; restartIfListening?: boolean }) => Promise<void>;
  onRequestDeleteConfirm?: (options: {
    title: string;
    message: string;
    confirmText?: string;
    onConfirm: () => void | Promise<void>;
  }) => void;
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
  onActiveNodeChange?: (node: WorkflowNodeKey | null) => void;
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
  onRequestDeleteConfirm,
  chats,
  listenerActive,
  forwardCount,
  lastForwardTime,
  lastPreview,
  onListenerToggle,
  onListenerChange,
  onActiveNodeChange,
}: ChatDetailsProps) {

  // Pan/zoom state for the workflow diagram
  const containerRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef({ x: 0, y: 0, panX: 0, panY: 0 });
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);
  const [zoom, setZoom] = useState(1);
  const MIN_ZOOM = 0.55;
  const MAX_ZOOM = 1.6;

  // Card editing state
  const [editCard, setEditCard] = useState<'source' | 'bot' | 'approval' | 'supply' | 'supplyChange' | 'delivery' | 'final' | 'reject' | null>(null);

  // Inputs state
  const [nameInput, setNameInput] = useState('');
  const [tokenInput, setTokenInput] = useState('');
  
  const [sourceGroupIdInput, setSourceGroupIdInput] = useState('');
  const [sourceThreadIdsInput, setSourceThreadIdsInput] = useState<number[]>([]);

  const [approvalGroupIdInput, setApprovalGroupIdInput] = useState('');
  const [approvalThreadIdInput, setApprovalThreadIdInput] = useState<number | ''>('');
  const [approvalMessageModeInput, setApprovalMessageModeInput] = useState<ApprovalMessageMode>('forward');
  const [approvalCustomMessageInput, setApprovalCustomMessageInput] = useState(DEFAULT_APPROVAL_CUSTOM_MESSAGE);

  const [supplyGroupIdInput, setSupplyGroupIdInput] = useState('');
  const [supplyThreadIdsInput, setSupplyThreadIdsInput] = useState<number[]>([]);
  const [supplierRoutesInput, setSupplierRoutesInput] = useState<SupplierRoute[]>([]);
  const [supplyChangeGroupIdInput, setSupplyChangeGroupIdInput] = useState('');
  const [supplyChangeThreadIdInput, setSupplyChangeThreadIdInput] = useState<number | ''>('');
  const [supplyChangeMessageModeInput, setSupplyChangeMessageModeInput] = useState<SupplyChangeMessageMode>('forward');

  const [deliveryGroupIdInput, setDeliveryGroupIdInput] = useState('');
  const [deliveryThreadIdInput, setDeliveryThreadIdInput] = useState<number | ''>('');
  const [finalMessageModeInput, setFinalMessageModeInput] = useState<FinalMessageMode>('forward');

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
  const [openSelectorId, setOpenSelectorId] = useState<string | null>(null);
  const dropdownRefs = useRef<Record<string, HTMLDivElement | null>>({});

  // Reset dropdown search states on editing card changes
  useEffect(() => {
    setGroupSearch('');
    setOpenSelectorId(null);
  }, [editCard]);

  // Click outside to dismiss group selector dropdown
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      const activeRef = openSelectorId ? dropdownRefs.current[openSelectorId] : null;
      if (activeRef && !activeRef.contains(event.target as Node)) {
        setOpenSelectorId(null);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [openSelectorId]);


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
      setApprovalMessageModeInput(automation.approvalMessageMode || 'forward');
      setApprovalCustomMessageInput(automation.approvalCustomMessage || DEFAULT_APPROVAL_CUSTOM_MESSAGE);

      setSupplyGroupIdInput(automation.supplyGroupId || '');
      setSupplyThreadIdsInput(Array.isArray(automation.supplyThreadIds)
        ? automation.supplyThreadIds
        : automation.supplyThreadId !== null && automation.supplyThreadId !== undefined
          ? [automation.supplyThreadId]
          : []);
      setSupplierRoutesInput(Array.isArray(automation.supplierRoutes)
        ? automation.supplierRoutes
        : []);
      setSupplyChangeGroupIdInput(automation.supplyChangeGroupId || '');
      setSupplyChangeThreadIdInput(automation.supplyChangeThreadId !== null && automation.supplyChangeThreadId !== undefined ? automation.supplyChangeThreadId : '');
      setSupplyChangeMessageModeInput(automation.supplyChangeMessageMode || 'forward');

      setDeliveryGroupIdInput(automation.deliveryGroupId || '');
      setDeliveryThreadIdInput(automation.deliveryThreadId !== null && automation.deliveryThreadId !== undefined ? automation.deliveryThreadId : '');
      setFinalMessageModeInput(automation.finalMessageMode || 'forward');

      setFinalGroupIdInput(automation.finalGroupId || '');
      setFinalThreadIdInput(automation.finalThreadId !== null && automation.finalThreadId !== undefined ? automation.finalThreadId : '');

      setRejectGroupIdInput(automation.rejectGroupId || '');
      setRejectThreadIdInput(automation.rejectThreadId !== null && automation.rejectThreadId !== undefined ? automation.rejectThreadId : '');

      setTokenStatus('idle');
      setTokenBotName('');
      setEditCard(null);
    }
    setIsDragging(false);
    setZoom(1);
    setPanX(0);
    setPanY(0);
  }, [automation?.id]);

  useEffect(() => {
    if (!onActiveNodeChange) return;
    if (!automation || !editCard) {
      onActiveNodeChange(null);
      return;
    }

    if (editCard === 'bot') {
      onActiveNodeChange(null);
      return;
    }

    onActiveNodeChange(editCard as WorkflowNodeKey);
  }, [automation, editCard, onActiveNodeChange]);

  // Drag-to-scroll event handlers
  const handleMouseDown = (e: React.MouseEvent) => {
    if (!containerRef.current) return;
    const target = e.target as HTMLElement;
    // Don't pan if clicking interactive controls
    if (
      target.closest('button') ||
      target.closest('a') ||
      target.closest('input') ||
      target.closest('select') ||
      target.closest('textarea') ||
      target.closest('label') ||
      target.closest('[data-no-pan="true"]')
    ) {
      return;
    }
    setIsDragging(true);
    dragStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      panX,
      panY,
    };
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return;
    e.preventDefault();
    const dx = e.clientX - dragStartRef.current.x;
    const dy = e.clientY - dragStartRef.current.y;
    setPanX(dragStartRef.current.panX + dx);
    setPanY(dragStartRef.current.panY + dy);
  };

  const handleMouseUpOrLeave = () => {
    setIsDragging(false);
  };

  const clampZoom = (value: number) => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, value));

  const handleWheel = (e: React.WheelEvent) => {
    if (!containerRef.current) return;
    const target = e.target as HTMLElement;
    if (
      target.closest('button') ||
      target.closest('a') ||
      target.closest('input') ||
      target.closest('select') ||
      target.closest('textarea') ||
      target.closest('[data-no-pan="true"]')
    ) {
      return;
    }
    e.preventDefault();
    const rect = containerRef.current.getBoundingClientRect();
    const pointerX = e.clientX - rect.left;
    const pointerY = e.clientY - rect.top;
    const nextZoom = clampZoom(zoom * (e.deltaY > 0 ? 0.92 : 1.08));
    if (nextZoom === zoom) return;
    const zoomFactor = nextZoom / zoom;
    setPanX((prev) => pointerX - (pointerX - prev) * zoomFactor);
    setPanY((prev) => pointerY - (pointerY - prev) * zoomFactor);
    setZoom(nextZoom);
  };

  const resetCanvasView = () => {
    setZoom(1);
    setPanX(0);
    setPanY(0);
  };

  // Rename automation
  const handleRenameSave = async (newName: string) => {
    try {
      await onSaveAutomation({
        id: automation!.id,
        name: newName.trim() || 'Automation mới',
        restartIfListening: listenerActive,
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
  const handleSaveCard = async (field: 'source' | 'bot' | 'approval' | 'supply' | 'supplyChange' | 'delivery' | 'final' | 'reject') => {
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
        updates.approvalMessageMode = approvalMessageModeInput;
        updates.approvalCustomMessage = approvalCustomMessageInput;
      }
      if (field === 'supply') {
        updates.supplyGroupId = supplyGroupIdInput;
        updates.supplyThreadIds = supplyThreadIdsInput;
        updates.supplyThreadId = supplyThreadIdsInput[0] ?? null;
        updates.supplierRoutes = supplierRoutesInput;
      }
      if (field === 'supplyChange') {
        updates.supplyChangeGroupId = supplyChangeGroupIdInput;
        updates.supplyChangeThreadId = supplyChangeThreadIdInput === '' ? null : Number(supplyChangeThreadIdInput);
        updates.supplyChangeMessageMode = supplyChangeMessageModeInput;
      }
      if (field === 'delivery') {
        updates.deliveryGroupId = deliveryGroupIdInput;
        updates.deliveryThreadId = deliveryThreadIdInput === '' ? null : Number(deliveryThreadIdInput);
      }
      if (field === 'final') {
        updates.finalGroupId = finalGroupIdInput;
        updates.finalThreadId = finalThreadIdInput === '' ? null : Number(finalThreadIdInput);
        updates.finalMessageMode = finalMessageModeInput;
      }
      if (field === 'reject') {
        updates.rejectGroupId = rejectGroupIdInput;
        updates.rejectThreadId = rejectThreadIdInput === '' ? null : Number(rejectThreadIdInput);
      }

      await onSaveAutomation({ ...updates, restartIfListening: listenerActive });
      setEditCard(null);
      showStatus(listenerActive
        ? '✅ Đã lưu cấu hình và khởi động lại bot!'
        : '✅ Đã lưu cấu hình bước thành công!');
    } catch (err: any) {
      showStatus('❌ Lỗi: ' + err.message);
    } finally {
      setIsSaving(false);
    }
  };

  const requestDeleteConfirm = (options: {
    title: string;
    message: string;
    confirmText?: string;
    onConfirm: () => void | Promise<void>;
  }) => {
    if (onRequestDeleteConfirm) {
      onRequestDeleteConfirm(options);
      return;
    }
    const confirmed = window.confirm(`${options.title}\n\n${options.message}`);
    if (confirmed) {
      void options.onConfirm();
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
            <span style={{ color: 'var(--color-text)', fontWeight: '600', fontSize: '11px' }}>Tất cả chủ đề</span>
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
                  <span style={{ color: 'var(--color-text)', fontWeight: '600', fontSize: '11px' }}>Chủ đề #{threadId}</span>
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

  const renderApprovalModeBadge = (mode: ApprovalMessageMode) => {
    const label = mode === 'copy' ? 'Sao chép tin gốc' : 'Gửi nguyên tin gốc';
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', background: 'rgba(34, 158, 217, 0.08)', padding: '2px 6px', borderRadius: '4px', border: '1px solid rgba(34, 158, 217, 0.2)' }}>
        <span>🔁</span>
        <span style={{ color: 'var(--color-text)', fontWeight: '600', fontSize: '11px' }}>{label}</span>
      </span>
    );
  };

  const renderSupplierModeBadge = (mode: SupplierRouteMode) => {
    const label = mode === 'copy' ? 'Sao chép sang nhà cung ứng' : 'Gửi nguyên sang nhà cung ứng';
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', background: 'rgba(16, 185, 129, 0.08)', padding: '2px 6px', borderRadius: '4px', border: '1px solid rgba(16, 185, 129, 0.2)' }}>
        <span>🏭</span>
        <span style={{ color: 'var(--color-text)', fontWeight: '600', fontSize: '11px' }}>{label}</span>
      </span>
    );
  };

  const renderSupplyChangeModeBadge = (mode: SupplyChangeMessageMode) => {
    const label = mode === 'copy' ? 'Sao chép phản hồi + báo đổi' : 'Gửi nguyên phản hồi + báo đổi';
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', background: 'rgba(249, 115, 22, 0.08)', padding: '2px 6px', borderRadius: '4px', border: '1px solid rgba(249, 115, 22, 0.2)' }}>
        <span>📣</span>
        <span style={{ color: 'var(--color-text)', fontWeight: '600', fontSize: '11px' }}>{label}</span>
      </span>
    );
  };

  const renderFinalModeBadge = (mode: FinalMessageMode) => {
    const label = mode === 'copy' ? 'Sao chép tin cuối' : 'Gửi nguyên tin cuối';
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', background: 'rgba(168, 85, 247, 0.08)', padding: '2px 6px', borderRadius: '4px', border: '1px solid rgba(168, 85, 247, 0.2)' }}>
        <span>📦</span>
        <span style={{ color: 'var(--color-text)', fontWeight: '600', fontSize: '11px' }}>{label}</span>
      </span>
    );
  };

  const createSupplierRoute = (index: number): SupplierRoute => ({
    id: `supplier_${Date.now()}_${index}`,
    name: `Nhà cung ứng ${index + 1}`,
    groupId: '',
    threadId: null,
    messageMode: 'forward',
  });

  const renderGroupTopicSelector = (
    groupIdVal: string,
    setGroupId: any,
    threadIdVal: number | '' | number[],
    setThreadId: any,
    onCancel: () => void,
    onSave: () => void,
    extraControls?: React.ReactNode,
    options?: { hideActions?: boolean; selectorId?: string; topicLabel?: string }
  ) => {
    const selectorId = (options?.selectorId || `${groupIdVal || 'empty'}:${Array.isArray(threadIdVal) ? threadIdVal.join(',') : threadIdVal ?? 'root'}`)
      .toString()
      .replace(/[^a-zA-Z0-9_-]/g, '_');
    const isDropdownOpen = openSelectorId === selectorId;
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
      <div
        id={`tour-group-topic-selector-${selectorId}`}
        data-no-pan="true"
        onClick={(e) => e.stopPropagation()}
        style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '8px' }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', position: 'relative' }}>
          <label style={{ fontSize: '10px', color: 'var(--color-text-muted)', fontWeight: '600' }}>Chọn Nhóm/Kênh:</label>
          
          {/* Custom Select Box */}
          <div 
            id={`tour-group-select-${selectorId}`}
            onClick={() => setOpenSelectorId(isDropdownOpen ? null : selectorId)}
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
              ref={(el) => { dropdownRefs.current[selectorId] = el; }}
              data-no-pan="true"
              onMouseDownCapture={(e) => e.stopPropagation()}
              onWheelCapture={(e) => e.stopPropagation()}
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
                maxHeight: '380px',
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden'
              }}
            >
              <div style={{ padding: '6px', borderBottom: '1px solid var(--border-color)', background: 'var(--bg-secondary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <i className="fa-solid fa-magnifying-glass" style={{ fontSize: '10px', color: 'var(--color-text-muted)', marginLeft: '4px' }} />
                <input 
                  id={`tour-group-search-${selectorId}`}
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

              <div style={{ overflowY: 'auto', flex: 1, padding: '4px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
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
                          data-no-pan="true"
                          onMouseDown={(e) => e.stopPropagation()}
                          onWheel={(e) => e.stopPropagation()}
                          onClick={() => {
                            setGroupId(c.chatId);
                            setThreadId(isMultiSelect ? [] : '');
                            setOpenSelectorId(selectorId);
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

                {selectedChat && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', paddingTop: '8px', borderTop: '1px solid var(--border-color)' }}>
                    {!isMultiSelect && (
                      <label style={{ fontSize: '10px', color: 'var(--color-text-muted)', fontWeight: '600' }}>{options?.topicLabel || 'Chọn chủ đề:'}</label>
                    )}

                    {isMultiSelect && (
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                        <label style={{ fontSize: '10px', color: 'var(--color-text-muted)', fontWeight: '600' }}>{options?.topicLabel || 'Chọn chủ đề:'}</label>
                        <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                          <button
                            id={`tour-topic-select-all-${selectorId}`}
                            type="button"
                            onClick={() => setThreadId(topicsList.map((t) => t.threadId))}
                            style={{ border: '1px solid var(--border-color)', background: 'var(--bg-secondary)', color: 'var(--color-text)', borderRadius: '4px', padding: '2px 6px', fontSize: '10px', cursor: 'pointer' }}
                          >
                            Chọn tất cả
                          </button>
                          <button
                            id={`tour-topic-clear-${selectorId}`}
                            type="button"
                            onClick={() => setThreadId([])}
                            style={{ border: '1px solid var(--border-color)', background: 'var(--bg-secondary)', color: 'var(--color-text)', borderRadius: '4px', padding: '2px 6px', fontSize: '10px', cursor: 'pointer' }}
                          >
                            Bỏ chọn
                          </button>
                        </div>
                      </div>
                    )}

                    <div style={{ fontSize: '10px', color: 'var(--color-text-muted)', lineHeight: 1.4 }}>
                      {!topicsList.length
                        ? 'Nhóm này chưa có chủ đề. Để trống để bot nghe tất cả tin nhắn trong nhóm.'
                        : isMultiSelect
                          ? 'Để trống = bot sẽ nghe toàn bộ chủ đề trong nhóm, bao gồm cả General.'
                          : 'Chọn 1 topic, hoặc để trống để bot nghe tất cả tin nhắn trong nhóm.'}
                    </div>

                    {topicsList.length > 0 ? (
                      isMultiSelect ? (
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
                        <select
                          id={`tour-topic-select-${selectorId}`}
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
                      )
                    ) : (
                      <div style={{ padding: '10px', fontSize: '11px', color: 'var(--color-text-muted)', border: '1px dashed var(--border-color)', borderRadius: '4px', background: 'var(--bg-secondary)' }}>
                        Nhóm này chưa có chủ đề. Để trống để bot nghe tất cả tin nhắn trong nhóm.
                      </div>
                    )}
                  </div>
                )}

                {extraControls && (
                  <div style={{ paddingTop: '8px', borderTop: '1px solid var(--border-color)' }}>
                    {extraControls}
                  </div>
                )}

                {!options?.hideActions && (
                  <div id={`tour-selector-actions-${selectorId}`} style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end', marginTop: '4px' }}>
                    <button className="btn btn-secondary" onClick={onCancel} style={{ padding: '4px 8px', fontSize: '10px', borderRadius: '4px' }}>Hủy</button>
                    <button className="btn btn-primary" onClick={onSave} disabled={isSaving} style={{ padding: '4px 8px', fontSize: '10px', borderRadius: '4px', background: 'var(--accent-blue)' }}>Lưu</button>
                  </div>
                )}
              </div>
            </div>
          )}
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
        <div id="tour-empty-state" style={{ minHeight: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '32px 20px' }}>
          <div
            style={{
              maxWidth: '520px',
              width: '100%',
              textAlign: 'center',
              background: 'var(--bg-primary)',
              border: '1px solid var(--border-color)',
              borderRadius: '16px',
              padding: '28px 24px',
              boxShadow: '0 8px 24px rgba(15, 23, 42, 0.04)',
            }}
          >
            <div
              style={{
                width: '48px',
                height: '48px',
                margin: '0 auto 14px',
                borderRadius: '14px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'var(--bg-secondary)',
                color: 'var(--accent-blue)',
                fontSize: '20px',
              }}
            >
              <i className="fa-solid fa-diagram-project" />
            </div>
            <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: 'var(--text-primary)' }}>
              Vui lòng chọn hoặc tạo mới 1 automation
            </h3>
            <p style={{ margin: '10px 0 0', fontSize: '13px', lineHeight: 1.6, color: 'var(--text-secondary)' }}>
              Mình sẽ hiển thị sơ đồ quy trình và phần cấu hình ngay khi bạn chọn một automation ở cột bên trái.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Render Interactive Configuration Mode (When an automation is selected)
  // ---------------------------------------------------------------------------
  const isCardUnconfigured = (field: 'source' | 'bot' | 'approval' | 'supply' | 'supplyChange' | 'delivery' | 'final' | 'reject') => {
    if (field === 'source') return !automation.sourceGroupId;
    if (field === 'bot') return !automation.botToken;
    if (field === 'approval') return !automation.approvalGroupId;
    if (field === 'supply') return !automation.supplyGroupId && (!automation.supplierRoutes || automation.supplierRoutes.length === 0);
    if (field === 'supplyChange') return !automation.supplyChangeGroupId;
    if (field === 'delivery') return !automation.deliveryGroupId;
    if (field === 'final') return !automation.finalGroupId;
    if (field === 'reject') return !automation.rejectGroupId;
    return false;
  };

  const isListenerStartable = !!(
    automation.botToken &&
    automation.sourceGroupId
  );

  const supplierRoutesEditor = (
    <div id="tour-supplier-routes-section" style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '8px', paddingTop: '8px', borderTop: '1px dashed var(--border-color)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
          <label style={{ fontSize: '10px', color: 'var(--color-text-muted)', fontWeight: '600' }}>Nhà cung ứng cho CT:</label>
          <span style={{ fontSize: '10px', color: 'var(--color-text-muted)' }}>Tin CT hợp lệ cần bắt đầu bằng <code>CT:</code>, có dòng <code>HM:</code> và ít nhất 1 dòng vật tư đánh số. Mỗi nhà cung ứng cũng có thể chọn topic riêng.</span>
        </div>
        <button
          id="tour-add-supplier-route"
          type="button"
          onClick={() => setSupplierRoutesInput((prev) => [...prev, createSupplierRoute(prev.length)])}
          style={{ border: '1px solid var(--border-color)', background: 'var(--bg-secondary)', color: 'var(--color-text)', borderRadius: '4px', padding: '4px 8px', fontSize: '10px', cursor: 'pointer' }}
        >
          + Thêm nhà cung ứng
        </button>
      </div>

      {supplierRoutesInput.length === 0 ? (
        <div style={{ padding: '10px', border: '1px dashed var(--border-color)', borderRadius: '4px', background: 'var(--bg-secondary)', fontSize: '11px', color: 'var(--color-text-muted)' }}>
          Chưa có nhà cung ứng nào. Hãy thêm ít nhất 1 nhà cung ứng để nhánh CT hoạt động.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {supplierRoutesInput.map((route, index) => (
            <div id={`tour-supplier-route-${index + 1}`} key={route.id} style={{ border: '1px solid var(--border-color)', borderRadius: '6px', padding: '8px', background: 'var(--bg-primary)', display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                <strong style={{ fontSize: '11px', color: 'var(--color-text)' }}>Nhà cung ứng {index + 1}</strong>
                <button
                  id={`tour-supplier-route-delete-${index + 1}`}
                  type="button"
                  onClick={() => requestDeleteConfirm({
                    title: 'Xóa nhà cung ứng này?',
                    message: 'Nhà cung ứng sẽ bị xóa khỏi workflow hiện tại. Bạn có thể thêm lại sau nếu cần.',
                    confirmText: 'Xóa',
                    onConfirm: () => setSupplierRoutesInput((prev) => prev.filter((item) => item.id !== route.id)),
                  })}
                  style={{ border: 'none', background: 'transparent', color: '#ef4444', fontSize: '10px', cursor: 'pointer' }}
                >
                  Xóa
                </button>
              </div>

              <input
                id={`tour-supplier-route-name-${index + 1}`}
                value={route.name}
                onChange={(e) => setSupplierRoutesInput((prev) => prev.map((item) => item.id === route.id ? { ...item, name: e.target.value } : item))}
                placeholder={`Tên nhà cung ứng ${index + 1}`}
                style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '4px', padding: '6px 8px', color: 'var(--color-text)', width: '100%', fontSize: '12px' }}
              />

              <div style={{ border: '1px solid var(--border-color)', borderRadius: '4px', padding: '8px', background: 'var(--bg-secondary)' }}>
                {renderGroupTopicSelector(
                  route.groupId,
                  (groupId: string) => setSupplierRoutesInput((prev) => prev.map((item) => item.id === route.id ? { ...item, groupId, threadId: null } : item)),
                  route.threadId === null ? '' : route.threadId,
                  (threadId: number | '') => setSupplierRoutesInput((prev) => prev.map((item) => item.id === route.id ? { ...item, threadId: threadId === '' ? null : Number(threadId) } : item)),
                  () => {},
                  () => {},
                  undefined,
                  { hideActions: true, selectorId: route.id, topicLabel: 'Chọn topic nhà cung ứng:' },
                )}
              </div>

              <select
                id={`tour-supplier-route-mode-${index + 1}`}
                value={route.messageMode}
                onChange={(e) => setSupplierRoutesInput((prev) => prev.map((item) => item.id === route.id ? { ...item, messageMode: e.target.value === 'copy' ? 'copy' : 'forward' } : item))}
                style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '4px', padding: '6px 8px', color: 'var(--color-text)', width: '100%', fontSize: '12px' }}
              >
                <option value="forward">Gửi nguyên sang nhà cung ứng</option>
                <option value="copy">Sao chép sang nhà cung ứng</option>
              </select>

              {route.groupId && (
                <div style={{ fontSize: '10px', color: 'var(--color-text-muted)', lineHeight: 1.4 }}>
                  Đã chọn: {renderGroupTopicBadge(route.groupId, route.threadId)}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
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
            id="tour-automation-name"
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
            id="tour-listener-toggle"
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
              <><i className="fa-solid fa-play" /> Bật bot</>
            )}
          </button>

          <button
            className="btn btn-danger"
            onClick={() => {
              requestDeleteConfirm({
                title: 'Xóa automation này?',
                message: 'Toàn bộ cấu hình của workflow hiện tại sẽ bị xóa. Thao tác này không thể hoàn tác.',
                confirmText: 'Xóa',
                onConfirm: () => onDeleteAutomation(automation.id),
              });
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
        id="tour-workflow-canvas"
        className={`workflow-diagram-container${isDragging ? ' dragging' : ''}`}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUpOrLeave}
        onMouseLeave={handleMouseUpOrLeave}
        onWheel={handleWheel}
        style={{ cursor: isDragging ? 'grabbing' : 'grab', flex: 1, overflow: 'hidden', padding: '24px 10px', position: 'relative' }}
      >
        <div
          id="tour-canvas-zoom"
          style={{
            position: 'absolute',
            top: '12px',
            right: '12px',
            zIndex: 4,
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            padding: '6px',
            borderRadius: '999px',
            border: '1px solid var(--border-color)',
            background: 'rgba(255, 255, 255, 0.92)',
            boxShadow: '0 6px 20px rgba(15, 23, 42, 0.08)',
            height: '42px',
            boxSizing: 'border-box',
          }}
        >
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => setZoom((current) => clampZoom(current * 0.9))}
            style={{ width: '30px', height: '30px', minWidth: '30px', padding: 0, borderRadius: '999px', fontSize: '14px', lineHeight: 1, justifyContent: 'center', flex: '0 0 auto' }}
            title="Thu nhỏ"
          >
            -
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={resetCanvasView}
            style={{ minWidth: '58px', height: '30px', padding: '0 10px', borderRadius: '999px', fontSize: '11px', justifyContent: 'center', flex: '0 0 auto', lineHeight: 1 }}
            title="Đặt lại khung nhìn"
          >
            {Math.round(zoom * 100)}%
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => setZoom((current) => clampZoom(current * 1.1))}
            style={{ width: '30px', height: '30px', minWidth: '30px', padding: 0, borderRadius: '999px', fontSize: '14px', lineHeight: 1, justifyContent: 'center', flex: '0 0 auto' }}
            title="Phóng to"
          >
            +
          </button>
        </div>
        <div
          className="workflow-canvas"
          style={{
            transform: `translate(${panX}px, ${panY}px) scale(${zoom})`,
            transformOrigin: '0 0',
            width: '100%',
            minHeight: '100%',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
          }}
        >
        {statusMessage && (
          <div className="bot-status-toast" style={{ position: 'relative', top: 0, left: 0, right: 0, margin: '0 auto 20px auto', width: '100%', maxWidth: '560px', transform: 'none' }}>
            {statusMessage}
          </div>
        )}

        <div className="workflow-tree" style={{ paddingBottom: '40px' }}>
          
          {/* ── NODE 1: SOURCE GROUP CONFIG ── */}
          <div 
            id="tour-node-source"
            className={`workflow-node start-node interactive-node${editCard === 'source' ? ' editing' : ''}${isCardUnconfigured('source') ? ' unconfigured' : ''}`}
            onClick={() => { if (editCard !== 'source') setEditCard('source'); }}
          >
            <div className="node-icon">📡</div>
            <div className="node-content">
              <span className="node-tag">Bước 1: Nhóm nguồn</span>
              <h5 className="node-title">Lắng nghe nhóm nguồn và nhiều chủ đề</h5>
              
              {editCard === 'source' ? (
                <div id="tour-source-editor">
                  {renderGroupTopicSelector(
                    sourceGroupIdInput,
                    setSourceGroupIdInput,
                    sourceThreadIdsInput,
                    (v: number | '' | number[]) => setSourceThreadIdsInput(Array.isArray(v) ? v : []),
                    () => setEditCard(null),
                    () => handleSaveCard('source'),
                    undefined,
                    { selectorId: 'source' }
                  )}
                </div>
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
            id="tour-node-approval"
            className={`workflow-node action-node interactive-node${editCard === 'approval' ? ' editing' : ''}${isCardUnconfigured('approval') ? ' unconfigured' : ''}`}
            onClick={() => { if (editCard !== 'approval') setEditCard('approval'); }}
          >
            <div className="node-icon">🤖</div>
            <div className="node-content">
              <span className="node-tag">Bước 2: Gửi sang nhóm duyệt (Hỏi ý kiến)</span>
              <h5 className="node-title">Bot gửi sang nhóm duyệt &amp; hỏi ý kiến</h5>
              
              {editCard === 'approval' ? (
                <div id="tour-approval-editor">
                  {renderGroupTopicSelector(
                    approvalGroupIdInput,
                    setApprovalGroupIdInput,
                    approvalThreadIdInput,
                    setApprovalThreadIdInput,
                    () => setEditCard(null),
                    () => handleSaveCard('approval'),
                    <div id="tour-approval-extra-controls" style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '4px' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <label style={{ fontSize: '10px', color: 'var(--color-text-muted)', fontWeight: '600' }}>Cách gửi nội dung gốc:</label>
                        <select
                          id="tour-approval-message-mode"
                          value={approvalMessageModeInput}
                          onChange={(e) => setApprovalMessageModeInput(e.target.value === 'copy' ? 'copy' : 'forward')}
                          style={{ background: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: '4px', padding: '6px', color: 'var(--color-text)', width: '100%', fontSize: '12px' }}
                        >
                          <option value="forward">Gửi nguyên tin + lời nhắn thêm</option>
                          <option value="copy">Sao chép tin + lời nhắn thêm</option>
                        </select>
                      </div>

                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <label style={{ fontSize: '10px', color: 'var(--color-text-muted)', fontWeight: '600' }}>Lời nhắn thêm:</label>
                        <textarea
                          id="tour-approval-custom-message"
                          value={approvalCustomMessageInput}
                          onChange={(e) => setApprovalCustomMessageInput(e.target.value)}
                          rows={4}
                          placeholder={DEFAULT_APPROVAL_CUSTOM_MESSAGE}
                          style={{
                            background: 'var(--bg-primary)',
                            border: '1px solid var(--border-color)',
                            borderRadius: '4px',
                            padding: '6px 8px',
                            color: 'var(--color-text)',
                            width: '100%',
                            fontSize: '12px',
                            resize: 'vertical',
                            minHeight: '84px',
                            lineHeight: 1.4,
                          }}
                        />
                        <div style={{ fontSize: '10px', color: 'var(--color-text-muted)', lineHeight: 1.4 }}>
                          Message này sẽ được gửi trước tin nhắn gốc để người duyệt đọc nhanh. Có thể dùng nội dung mặc định hoặc tự sửa theo ý bạn.
                        </div>
                      </div>
                    </div>,
                    { selectorId: 'approval' }
                  )}
                </div>
              ) : (
                <div className="node-text" style={{ fontWeight: '500', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  {automation.approvalGroupId ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                      <span style={{ fontSize: '11px', color: 'var(--color-text-muted)' }}>Phê duyệt:</span>
                      {renderGroupTopicBadge(automation.approvalGroupId, automation.approvalThreadId)}
                      {renderApprovalModeBadge(automation.approvalMessageMode)}
                    </div>
                  ) : (
                    <span style={{ color: '#f59e0b' }}>⚠️ Chưa cấu hình nhóm Phê duyệt.</span>
                  )}
                  {automation.approvalCustomMessage && (
                    <div style={{ background: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: '4px', padding: '6px 8px', fontSize: '10px', color: 'var(--color-text-muted)', whiteSpace: 'pre-wrap' }}>
                      {automation.approvalCustomMessage}
                    </div>
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
                  id="tour-node-reject"
                  className={`workflow-node end-node interactive-node${editCard === 'reject' ? ' editing' : ''}${isCardUnconfigured('reject') ? ' unconfigured' : ''}`}
                  onClick={() => { if (editCard !== 'reject') setEditCard('reject'); }}
                  style={{ opacity: 0.95 }}
                >
                  <div className="node-icon">❌</div>
                  <div className="node-content">
                    <h5 className="node-title">Thông báo từ chối</h5>
                    
                    {editCard === 'reject' ? (
                      <div id="tour-reject-editor">
                        {renderGroupTopicSelector(
                          rejectGroupIdInput,
                          setRejectGroupIdInput,
                          rejectThreadIdInput,
                          setRejectThreadIdInput,
                          () => setEditCard(null),
                          () => handleSaveCard('reject'),
                          undefined,
                          { selectorId: 'reject' }
                        )}
                      </div>
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
                  id="tour-node-supply"
                  className={`workflow-node action-node interactive-node${editCard === 'supply' ? ' editing' : ''}${isCardUnconfigured('supply') ? ' unconfigured' : ''}`}
                  onClick={() => { if (editCard !== 'supply') setEditCard('supply'); }}
                >
                  <div className="node-icon">📝</div>
                  <div className="node-content">
                    <span className="node-tag">Bước 3: Lựa chọn vật tư</span>
                    <h5 className="node-title">Hỏi phương án cung cấp</h5>
                    
                    {editCard === 'supply' ? (
                      <div id="tour-supply-editor">
                        {renderGroupTopicSelector(
                          supplyGroupIdInput,
                          setSupplyGroupIdInput,
                          supplyThreadIdsInput,
                          setSupplyThreadIdsInput,
                          () => setEditCard(null),
                          () => handleSaveCard('supply'),
                          supplierRoutesEditor,
                          { selectorId: 'supply', topicLabel: 'Chọn topic nhà cung ứng:' }
                        )}
                      </div>
                    ) : (
                      <div className="node-text" style={{ fontWeight: '500', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        {automation.supplyGroupId ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexWrap: 'wrap' }}>
                            <span style={{ color: 'var(--color-text-muted)', fontSize: '10px' }}>Nhóm/Topic mặc định:</span>
                            {renderSourceGroupTopicBadge(automation.supplyGroupId, automation.supplyThreadIds)}
                          </div>
                        ) : (
                          <span style={{ color: '#f59e0b' }}>⚠️ Nhấp để chọn nhóm lựa chọn vật tư.</span>
                        )}

                        <div style={{ fontSize: '10px', color: 'var(--color-text-muted)' }}>
                          Nhánh CT: {automation.supplierRoutes?.length ? `${automation.supplierRoutes.length} nhà cung ứng đã cấu hình` : 'chưa có nhà cung ứng'}
                        </div>
                        <div style={{ fontSize: '10px', color: 'var(--color-text-muted)' }}>
                          Có thể chọn nhiều topic để bot chỉ nhận phản hồi ở đúng các topic đã cấu hình.
                        </div>
                      </div>
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
                      <span className="branch-label label-neutral">Từ chối</span>
                      <div className="workflow-arrow-v">
                        <svg width="2" height="20" viewBox="0 0 2 20" fill="none">
                          <line x1="1" y1="0" x2="1" y2="20" stroke="var(--border-color)" strokeWidth="2" />
                        </svg>
                      </div>
                      
                      <div
                        id="tour-node-supply-change"
                        className={`workflow-node end-node interactive-node${editCard === 'supplyChange' ? ' editing' : ''}${isCardUnconfigured('supplyChange') ? ' unconfigured' : ''}`}
                        onClick={() => { if (editCard !== 'supplyChange') setEditCard('supplyChange'); }}
                        style={{ opacity: 0.9 }}
                      >
                        <div className="node-icon">📢</div>
                        <div className="node-content">
                          <h5 className="node-title">Thông báo yêu cầu thay đổi vật tư</h5>
                          {editCard === 'supplyChange' ? (
                            <div id="tour-supply-change-editor">
                              {renderGroupTopicSelector(
                                supplyChangeGroupIdInput,
                                setSupplyChangeGroupIdInput,
                                supplyChangeThreadIdInput,
                                setSupplyChangeThreadIdInput,
                                () => setEditCard(null),
                                () => handleSaveCard('supplyChange'),
                                <div id="tour-supply-change-extra-controls" style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '4px' }}>
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                    <label style={{ fontSize: '10px', color: 'var(--color-text-muted)', fontWeight: '600' }}>Cách chuyển phản hồi thay đổi:</label>
                                  <select
                                      id="tour-supply-change-message-mode"
                                      value={supplyChangeMessageModeInput}
                                      onChange={(e) => setSupplyChangeMessageModeInput(e.target.value === 'copy' ? 'copy' : 'forward')}
                                      style={{ background: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: '4px', padding: '6px', color: 'var(--color-text)', width: '100%', fontSize: '12px' }}
                                    >
                                      <option value="forward">Gửi nguyên phản hồi + báo đổi vật tư</option>
                                      <option value="copy">Sao chép phản hồi + báo đổi vật tư</option>
                                    </select>
                                  </div>
                                  <div style={{ fontSize: '10px', color: 'var(--color-text-muted)', lineHeight: 1.5 }}>
                                    Khi nhà cung ứng bấm yêu cầu thay đổi, bot sẽ gửi thông báo vào nhóm này. Sau đó, mọi reply vào tin nhắn đó sẽ được chuyển theo cách bạn chọn.
                                  </div>
                                </div>,
                                { selectorId: 'supply-change' }
                              )}
                            </div>
                          ) : (
                            <div className="node-text" style={{ fontSize: '10px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                              {automation.supplyChangeGroupId ? (
                                <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexWrap: 'wrap' }}>
                                  <span style={{ color: 'var(--color-text-muted)' }}>Gửi đến:</span>
                                  {renderGroupTopicBadge(automation.supplyChangeGroupId, automation.supplyChangeThreadId)}
                                </div>
                              ) : (
                                <span style={{ color: '#f59e0b' }}>⚠️ Nhấp để chọn nhóm nhận thông báo thay đổi vật tư.</span>
                              )}
                              {automation.supplyChangeMessageMode && (
                                <div>{renderSupplyChangeModeBadge(automation.supplyChangeMessageMode)}</div>
                              )}
                            </div>
                          )}
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
                        id="tour-node-delivery"
                        className={`workflow-node action-node interactive-node${editCard === 'delivery' ? ' editing' : ''}${isCardUnconfigured('delivery') ? ' unconfigured' : ''}`}
                        onClick={() => { if (editCard !== 'delivery') setEditCard('delivery'); }}
                      >
                        <div className="node-icon">📦</div>
                        <div className="node-content">
                          <span className="node-tag">Bước 4: Giao nhận</span>
                          <h5 className="node-title">Yêu cầu phản hồi khi nhận</h5>
                          
                          {editCard === 'delivery' ? (
                            <div id="tour-delivery-editor">
                              {renderGroupTopicSelector(
                                deliveryGroupIdInput,
                                setDeliveryGroupIdInput,
                                deliveryThreadIdInput,
                                setDeliveryThreadIdInput,
                                () => setEditCard(null),
                                () => handleSaveCard('delivery'),
                                undefined,
                                { selectorId: 'delivery' }
                              )}
                            </div>
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
                        id="tour-node-final"
                        className={`workflow-node success-node interactive-node${editCard === 'final' ? ' editing' : ''}${isCardUnconfigured('final') ? ' unconfigured' : ''}`}
                        onClick={() => { if (editCard !== 'final') setEditCard('final'); }}
                        style={{
                          borderColor: listenerActive ? 'rgba(16, 185, 129, 0.4)' : 'var(--border-color)',
                        }}
                      >
                        <div className="node-icon">{listenerActive ? '⚡' : '✅'}</div>
                        <div className="node-content" style={{ width: '100%' }}>
                          <span className="node-tag">Bước 5: Nghiệm thu</span>
                          <h5 className="node-title">Nghiệm thu vật tư &amp; Gửi tiếp</h5>
                          
                          {editCard === 'final' ? (
                            <div id="tour-final-editor">
                              {renderGroupTopicSelector(
                                finalGroupIdInput,
                                setFinalGroupIdInput,
                                finalThreadIdInput,
                                setFinalThreadIdInput,
                                () => setEditCard(null),
                                () => handleSaveCard('final'),
                                <div id="tour-final-extra-controls" style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '4px' }}>
                                  <label style={{ fontSize: '10px', color: 'var(--color-text-muted)', fontWeight: '600' }}>Cách gửi phản hồi cuối:</label>
                                  <select
                                    id="tour-final-message-mode"
                                    value={finalMessageModeInput}
                                    onChange={(e) => setFinalMessageModeInput(e.target.value === 'copy' ? 'copy' : 'forward')}
                                    style={{ background: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: '4px', padding: '6px', color: 'var(--color-text)', width: '100%', fontSize: '12px' }}
                                  >
                                    <option value="forward">Gửi nguyên tin + lời nhắn tổng hợp</option>
                                    <option value="copy">Sao chép tin + lời nhắn tổng hợp</option>
                                  </select>
                                </div>,
                                { selectorId: 'final' }
                              )}
                            </div>
                          ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '6px', textAlign: 'left' }}>
                              <div style={{ fontWeight: '500', fontSize: '11px' }}>
                                {automation.finalGroupId ? (
                                  renderGroupTopicBadge(automation.finalGroupId, automation.finalThreadId)
                                ) : (
                                  <span style={{ color: '#f59e0b' }}>⚠️ Nhấp để cấu hình nhóm nghiệm thu.</span>
                                )}
                                {automation.finalMessageMode && (
                                  <span style={{ marginLeft: '6px' }}>{renderFinalModeBadge(automation.finalMessageMode)}</span>
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
    </div>
  );
}
