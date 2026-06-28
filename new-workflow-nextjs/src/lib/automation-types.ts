export type ApprovalMessageMode = 'forward' | 'copy';
export type SupplierRouteMode = 'forward' | 'copy';
export type FinalMessageMode = 'forward' | 'copy';
export type SupplyChangeMessageMode = 'forward' | 'copy';

export interface ApprovalActionConfig {
  agreeButtonLabel: string;
  disagreeButtonLabel: string;
  agreeResultMessage: string;
  disagreeResultMessage: string;
  hideAfterAction: boolean;
}

export interface ApprovalTopicConfig {
  sourceThreadId: number;
  approvalMessageMode: ApprovalMessageMode;
  approvalCustomMessage: string;
  approvalActionConfig: ApprovalActionConfig;
}

export interface SupplierRoute {
  id: string;
  name: string;
  groupId: string;
  threadId: number | null;
  messageMode: SupplierRouteMode;
}

export const DEFAULT_APPROVAL_CUSTOM_MESSAGE =
  '📡 YÊU CẦU PHÊ DUYỆT\n\nVui lòng xem nội dung gốc được gửi bên dưới rồi bấm nút xử lý.';

export const DEFAULT_APPROVAL_ACTION_CONFIG: ApprovalActionConfig = {
  hideAfterAction: false,
  agreeButtonLabel: '👍 Đồng ý',
  disagreeButtonLabel: '👎 Không đồng ý',
  agreeResultMessage: '✅ *ĐÃ PHÊ DUYỆT SƠ BỘ* bởi {{userFullName}}',
  disagreeResultMessage: '❌ *BỊ TỪ CHỐI PHÊ DUYỆT* bởi {{userFullName}}',
};

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
  photoData?: string | null;
  photoMime?: string | null;
  lastUpdated: number;
  topics: Record<string, TopicEntry>;
}

export interface AutomationSetup {
  id: string;
  name: string;
  sortOrder: number;
  botToken: string;
  sourceGroupId: string;
  sourceThreadIds: number[];
  sourceThreadId: number | null;
  approvalGroupId: string;
  approvalThreadId: number | null;
  approvalMessageMode: ApprovalMessageMode;
  approvalCustomMessage: string;
  approvalActionConfig: ApprovalActionConfig;
  approvalTopicConfigs: ApprovalTopicConfig[];
  supplyGroupId: string;
  supplyThreadId: number | null;
  supplierSelectionHideAfterAction: boolean;
  supplyPromptHideAfterAction: boolean;
  supplyListenGroupId: string;
  supplyListenThreadIds: number[];
  supplyListenThreadId: number | null;
  supplyChangeGroupId: string;
  supplyChangeThreadId: number | null;
  supplyChangeMessageMode: SupplyChangeMessageMode;
  supplierRoutes: SupplierRoute[];
  deliveryGroupId: string;
  deliveryThreadId: number | null;
  finalMessageMode: FinalMessageMode;
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
