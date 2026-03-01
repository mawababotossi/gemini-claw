/**
 * @license Apache-2.0
 * @geminiclaw/memory — Types and shared interfaces
 */

export interface Session {
    id: string;
    channel: string;
    peerId: string;
    agentName: string;
    createdAt: number;
    updatedAt: number;
    metadata?: Record<string, unknown>;
}

export interface ChatMessage {
    role: 'user' | 'assistant' | 'tool';
    content: string;
    timestamp: number;
    thought?: string;
    toolName?: string;
    toolInput?: unknown;
    toolResult?: unknown;
}

export interface InboundMessage {
    sessionId: string;
    channel: string;
    peerId: string;
    text: string;
    attachments?: Attachment[];
    metadata?: Record<string, any>;
    timestamp: number;
}

export interface Attachment {
    type: 'image' | 'audio' | 'video' | 'document';
    mimeType: string;
    data?: Buffer;
    url?: string;
    filename?: string;
}

export interface AgentResponse {
    text: string;
    sessionId: string;
    thought?: string;
    tokensUsed?: number;
    streamed?: boolean;
}
