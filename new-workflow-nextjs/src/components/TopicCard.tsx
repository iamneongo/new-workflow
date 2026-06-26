'use client';

import React from 'react';
import { TopicEntry } from '@/lib/database';

interface TopicCardProps {
  topic: TopicEntry;
  chatId: string;
  onRename: (chatId: string, threadId: number, currentName: string) => void;
}

function formatDate(timestamp: number): string {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  return (
    date.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) +
    ' ' +
    date.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' })
  );
}

export default function TopicCard({ topic, chatId, onRename }: TopicCardProps) {
  return (
    <div className="topic-card">
      <div className="topic-top">
        <div className="topic-icon-box">
          <span>{topic.topicIcon || '💬'}</span>
        </div>
        <div className="topic-details">
          <div className="topic-name" title={topic.topicName}>
            {topic.topicName}
          </div>
          <div className="topic-id">Thread ID: {topic.threadId}</div>
        </div>
      </div>
      <div className="topic-action-row">
        <span className="topic-time" title="Cập nhật cuối">
          <i className="fa-regular fa-clock" /> {formatDate(topic.lastUpdated)}
        </span>
        <button
          className="rename-btn"
          onClick={() => onRename(chatId, topic.threadId, topic.topicName)}
        >
          <i className="fa-solid fa-pen" /> Đổi tên
        </button>
      </div>
    </div>
  );
}
