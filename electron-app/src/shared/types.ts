export interface CursorTarget {
  x: number;
  y: number;
  label?: string;
  screen?: number;
  timestamp: number;
}

export interface ScreenCaptureOptions {
  format?: 'jpeg' | 'png';
  quality?: number;
  captureAll?: boolean;
  screenId?: number;
}

export interface ScreenCaptureResult {
  success: boolean;
  image: string; // base64
  format: string;
  size: number;
  timestamp: number;
  width: number;
  height: number;
}

export interface VoiceCommand {
  transcript: string;
  confidence: number;
  timestamp: number;
}

export interface VisionAnalysis {
  description: string;
  elements: Array<{
    type: string;
    label: string;
    x: number;
    y: number;
    width: number;
    height: number;
  }>;
  suggestions: string[];
}

export interface JarvisConfig {
  ollamaUrl: string;
  ollamaModel: string;
  visionModel: string;
  geminiApiKey?: string;
  elevenLabsApiKey?: string;
  fishAudioApiKey?: string;
  voiceEngine: 'browser' | 'elevenlabs' | 'fish-audio' | 'gemini-live';
  wakeWord: string;
  language: string;
  autoStart: boolean;
  minimizeToTray: boolean;
}

export interface MemoryEntry {
  id: string;
  key: string;
  value: string;
  category: 'project' | 'preference' | 'fact' | 'session' | 'user';
  timestamp: number;
  ttl?: number; // time to live in ms
}

export interface SessionSummary {
  id: string;
  startedAt: number;
  endedAt: number;
  messages: Array<{ role: 'user' | 'ai'; content: string; ts: number }>;
  summary: string;
  topics: string[];
}

export interface ProactiveCheckin {
  id: string;
  type: 'morning' | 'reminder' | 'topic-update' | 'idle';
  message: string;
  timestamp: number;
  acknowledged: boolean;
}

export interface N8nWorkflow {
  id: string;
  name: string;
  webhookUrl: string;
  active: boolean;
  trigger: string;
}

// ── Email Types ──────────────────────────────────────────────────────────────

export interface EmailMessage {
  id: string;
  threadId: string;
  subject: string;
  from: string;
  fromEmail: string;
  to: string[];
  cc?: string[];
  date: string;
  snippet: string;
  body: string;
  bodyHtml: string;
  isUnread: boolean;
  isStarred: boolean;
  labels: string[];
  hasAttachments: boolean;
  attachments?: Array<{ filename: string; mimeType: string; size: number }>;
}

export interface EmailSendParams {
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  body: string;
  bodyHtml?: string;
  inReplyTo?: string;
  threadId?: string;
}

export interface EmailSearchParams {
  query?: string;
  from?: string;
  to?: string;
  subject?: string;
  after?: string;
  before?: string;
  label?: string;
  isUnread?: boolean;
  maxResults?: number;
  pageToken?: string;
}

// ── Google AI Studio Types ───────────────────────────────────────────────────

export interface AIStudioConfig {
  apiKey: string;
  baseUrl?: string;
}

export interface TunedModel {
  name: string;
  displayName: string;
  description: string;
  baseModel: string;
  state: string;
  createTime: string;
  updateTime: string;
  modelType?: string;
}

export interface ModelInfo {
  name: string;
  displayName: string;
  description: string;
  supportedGenerationMethods: string[];
  inputTokenLimit: number;
  outputTokenLimit: number;
}

// ── Calendar Types ───────────────────────────────────────────────────────────

export interface CalendarEvent {
  id: string;
  summary: string;
  description?: string;
  location?: string | { displayName?: string };
  start: { dateTime?: string; date?: string; timeZone?: string };
  end: { dateTime?: string; date?: string; timeZone?: string };
  attendees?: Array<{ email: string; displayName?: string; responseStatus: string }>;
  recurrence?: string[];
  reminders?: Array<{ method: string; minutes: number }>;
  status: string;
  htmlLink?: string;
  created: string;
  updated: string;
}

export interface CreateEventParams {
  summary: string;
  description?: string;
  location?: string;
  startDateTime: string;
  endDateTime: string;
  timeZone?: string;
  attendees?: string[];
  recurrence?: string[];
  reminders?: Array<{ method: string; minutes: number }>;
}

// ── Contacts Types ───────────────────────────────────────────────────────────

export interface Contact {
  id: string;
  displayName: string;
  givenName?: string;
  familyName?: string;
  emails: Array<{ value: string; type: string }>;
  phones: Array<{ value: string; type: string }>;
  organizations?: Array<{ name: string; title?: string }>;
  addresses?: Array<{ formattedValue: string; type?: string }>;
  birthdays?: Array<{ date: { year?: number; month: number; day: number } }>;
  photos?: Array<{ url: string }>;
  notes?: string;
  createdAt?: string;
  updatedAt?: string;
}
