import { WorkspaceContextSnapshot } from '../workspaceContextManager';

export type AssistantStatus = 'idle' | 'processing' | 'error';

export interface AssistantAction {
  id: string;
  label: string;
  description?: string;
  command: string;
  args?: unknown[];
  emphasis?: 'primary' | 'default';
  disabled?: boolean;
  source?: 'local' | 'mcp' | 'system' | string;
}

export interface AssistantLogEntry {
  id: string;
  message: string;
  level: 'info' | 'warn' | 'error';
  timestamp: string;
}

export interface AssistantChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  message: string;
  timestamp: string;
}

export interface StatusUpdate {
  status: AssistantStatus;
  lastMessage?: string;
}

export interface LogUpdate {
  entry: AssistantLogEntry;
}

export interface ContextUpdate {
  snapshot: WorkspaceContextSnapshot;
}

export interface ActionsUpdate {
  actions: AssistantAction[];
}

export type BridgeState = 'disconnected' | 'connecting' | 'ready' | 'error';

export interface BridgeStateUpdate {
  state: BridgeState;
  message?: string;
}

export interface McpOutboundMessage {
  type: string;
  payload?: unknown;
}

export interface McpInboundMessage {
  type: string;
  payload?: unknown;
}

export interface BridgeMessageUpdate {
  direction: 'inbound' | 'outbound';
  message: McpInboundMessage | McpOutboundMessage;
  raw?: string;
}

export interface AssistantEventMap {
  status: StatusUpdate;
  log: LogUpdate;
  context: ContextUpdate;
  actions: ActionsUpdate;
  bridge: BridgeStateUpdate;
  bridgeMessage: BridgeMessageUpdate;
  chat: AssistantChatMessage;
}

export interface McpRemoteActionDescriptor {
  id: string;
  label: string;
  description?: string;
  emphasis?: 'primary' | 'default';
  disabled?: boolean;
  sendContextOnInvoke?: boolean;
}

export interface McpRegisterActionsPayload {
  actions: McpRemoteActionDescriptor[];
}

export interface McpContextRequestPayload {
  requestId?: string;
}

export interface McpActionInvocationPayload {
  actionId: string;
  timestamp: string;
  context?: WorkspaceContextSnapshot;
}

export interface McpActionStateUpdatePayload {
  actionId: string;
  disabled?: boolean;
  label?: string;
  description?: string;
  emphasis?: 'primary' | 'default';
}

export interface McpActionCompletePayload {
  actionId: string;
  status?: 'success' | 'error';
  message?: string;
}

export interface McpLogPayload {
  message: string;
  level?: AssistantLogEntry['level'];
}

export interface McpPosition {
  line: number;
  character: number;
}

export interface McpRange {
  start: McpPosition;
  end: McpPosition;
}

export interface McpTextEdit {
  range: McpRange;
  newText: string;
}

export interface McpFileEdit {
  uri: string;
  edits: McpTextEdit[];
}

export interface McpApplyEditsPayload {
  actionId?: string;
  description?: string;
  edits: McpFileEdit[];
  preview?: boolean;
}

export interface McpTaskSequenceEntry {
  command: string;
  args?: string[];
}

export interface McpTaskRequestPayload {
  actionId?: string;
  command?: string;
  args?: string[];
  cwd?: string;
  terminalName?: string;
  mode?: 'terminal' | 'process';
  sequence?: McpTaskSequenceEntry[];
}

export interface McpChatMessagePayload {
  message: string;
  context?: WorkspaceContextSnapshot;
}

export interface McpChatResponsePayload {
  message: string;
  role?: 'assistant' | 'system';
}
