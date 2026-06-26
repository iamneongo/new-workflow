export type ApprovalMessageMode = 'forward' | 'copy';

export const DEFAULT_APPROVAL_CUSTOM_MESSAGE =
  '📡 *YÊU CẦU PHÊ DUYỆT VẬT TƯ MỚI*\n\nVui lòng xem nội dung gốc được gửi bên dưới rồi bấm nút xử lý.';

export interface TopicEntry {
  threadId: number;
  topicName: string;
  topicIcon: string;
  lastUpdated: number;
}

export interface ChatEntry {
  chatId: string;
  chatTitle: string;
  chatType: 'group' | 'channel' | 'supergroup';
  username: string | null;
  photoPath: string | null;
  lastUpdated: number;
  topics: Record<string, TopicEntry>;
}

export interface AutomationSetup {
  id: string;
  name: string;
  botToken: string;
  sourceGroupId: string;
  sourceThreadIds: number[];
  sourceThreadId: number | null;
  approvalGroupId: string;
  approvalThreadId: number | null;
  approvalMessageMode: ApprovalMessageMode;
  approvalCustomMessage: string;
  supplyGroupId: string;
  supplyThreadId: number | null;
  deliveryGroupId: string;
  deliveryThreadId: number | null;
  finalGroupId: string;
  finalThreadId: number | null;
  rejectGroupId: string;
  rejectThreadId: number | null;
  isListening: boolean;
  forwardCount: number;
  lastForwardTime: number | null;
  destGroupId: string;
}

export interface Database {
  chats: Record<string, ChatEntry>;
}
