import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { randomUUID } from 'crypto';
import type { MemoryEntry, SessionSummary } from '../shared/types';
import { MEMORY } from '../shared/constants';

export class JarvisMemory {
  private memoryDir: string;
  private longTermPath: string;
  private sessionsPath: string;
  private entries: MemoryEntry[] = [];
  private sessions: SessionSummary[] = [];

  constructor() {
    this.memoryDir = join(homedir(), '.ghostforge', 'memory');
    this.longTermPath = join(this.memoryDir, 'long_term.json');
    this.sessionsPath = join(this.memoryDir, 'sessions.json');

    if (!existsSync(this.memoryDir)) {
      mkdirSync(this.memoryDir, { recursive: true });
    }

    this.load();
  }

  private load(): void {
    try {
      if (existsSync(this.longTermPath)) {
        this.entries = JSON.parse(readFileSync(this.longTermPath, 'utf-8'));
      }
    } catch {
      this.entries = [];
    }

    try {
      if (existsSync(this.sessionsPath)) {
        this.sessions = JSON.parse(readFileSync(this.sessionsPath, 'utf-8'));
      }
    } catch {
      this.sessions = [];
    }

    // Clean up expired entries
    this.cleanExpired();
  }

  private save(): void {
    writeFileSync(this.longTermPath, JSON.stringify(this.entries, null, 2));
    writeFileSync(this.sessionsPath, JSON.stringify(this.sessions, null, 2));
  }

  private cleanExpired(): void {
    const now = Date.now();
    this.entries = this.entries.filter(entry => {
      if (!entry.ttl) return true;
      return now - entry.timestamp < entry.ttl;
    });
  }

  // ── Entry CRUD ─────────────────────────────────────────────────────────────

  set(key: string, value: string, category: MemoryEntry['category'] = 'fact', ttlMs?: number): MemoryEntry {
    // Update existing or create new
    const existing = this.entries.find(e => e.key === key);
    if (existing) {
      existing.value = value;
      existing.category = category;
      existing.timestamp = Date.now();
      if (ttlMs) existing.ttl = ttlMs;
      this.save();
      return existing;
    }

    const entry: MemoryEntry = {
      id: randomUUID(),
      key,
      value,
      category,
      timestamp: Date.now(),
      ttl: ttlMs || (category === 'session' ? MEMORY.defaultTtlMs : undefined),
    };

    this.entries.push(entry);

    // Enforce max entries
    if (this.entries.length > MEMORY.maxEntries) {
      // Remove oldest non-permanent entries first
      const permanent = this.entries.filter(e => e.category === 'user' || e.category === 'preference');
      const temporary = this.entries.filter(e => e.category !== 'user' && e.category !== 'preference');
      temporary.sort((a, b) => a.timestamp - b.timestamp);
      this.entries = [...permanent, ...temporary.slice(-(MEMORY.maxEntries - permanent.length))];
    }

    this.save();
    return entry;
  }

  get(key: string): string | undefined {
    const entry = this.entries.find(e => e.key === key);
    return entry?.value;
  }

  getByCategory(category: MemoryEntry['category']): MemoryEntry[] {
    return this.entries.filter(e => e.category === category);
  }

  search(query: string): MemoryEntry[] {
    const lower = query.toLowerCase();
    return this.entries.filter(e =>
      e.key.toLowerCase().includes(lower) ||
      e.value.toLowerCase().includes(lower)
    );
  }

  delete(key: string): boolean {
    const before = this.entries.length;
    this.entries = this.entries.filter(e => e.key !== key);
    if (this.entries.length < before) {
      this.save();
      return true;
    }
    return false;
  }

  getAll(): MemoryEntry[] {
    return [...this.entries];
  }

  // ── Project Memory ─────────────────────────────────────────────────────────

  rememberProject(name: string, details: string): void {
    this.set(`project:${name}`, details, 'project');
  }

  getProject(name: string): string | undefined {
    return this.get(`project:${name}`);
  }

  listProjects(): MemoryEntry[] {
    return this.getByCategory('project');
  }

  // ── User Preferences ───────────────────────────────────────────────────────

  setPreference(key: string, value: string): void {
    this.set(`pref:${key}`, value, 'preference');
  }

  getPreference(key: string): string | undefined {
    return this.get(`pref:${key}`);
  }

  // ── User Facts ─────────────────────────────────────────────────────────────

  rememberFact(fact: string): void {
    this.set(`fact:${Date.now()}`, fact, 'fact');
  }

  getFacts(): string[] {
    return this.getByCategory('fact').map(e => e.value);
  }

  // ── Sessions ───────────────────────────────────────────────────────────────

  createSession(): SessionSummary {
    const session: SessionSummary = {
      id: randomUUID(),
      startedAt: Date.now(),
      endedAt: 0,
      messages: [],
      summary: '',
      topics: [],
    };
    this.sessions.push(session);
    this.save();
    return session;
  }

  addMessage(sessionId: string, role: 'user' | 'ai', content: string): void {
    const session = this.sessions.find(s => s.id === sessionId);
    if (session) {
      session.messages.push({ role, content, ts: Date.now() });
      this.save();
    }
  }

  async endSession(sessionId: string): Promise<SessionSummary | null> {
    const session = this.sessions.find(s => s.id === sessionId);
    if (!session) return null;

    session.endedAt = Date.now();

    // Generate summary from messages
    if (session.messages.length > 0) {
      session.summary = this.generateSummary(session);
      session.topics = this.extractTopics(session);
    }

    this.save();
    return session;
  }

  private generateSummary(session: SessionSummary): string {
    const userMessages = session.messages.filter(m => m.role === 'user');
    if (userMessages.length === 0) return 'Empty session';

    const topics = this.extractTopics(session);
    const duration = Math.round((session.endedAt - session.startedAt) / 60000);

    return `Session about ${topics.join(', ') || 'general conversation'} (${duration}min, ${session.messages.length} messages)`;
  }

  private extractTopics(session: SessionSummary): string[] {
    const topics = new Set<string>();
    const keywords = [
      'react', 'nextjs', 'typescript', 'javascript', 'python',
      'deploy', 'build', 'test', 'debug', 'fix', 'review',
      'api', 'database', 'ui', 'component', 'page',
      'git', 'github', 'azure', 'docker', 'ci/cd',
      'voice', 'screen', 'cursor', 'clicky', 'jarvis',
    ];

    for (const msg of session.messages) {
      const lower = msg.content.toLowerCase();
      for (const kw of keywords) {
        if (lower.includes(kw)) topics.add(kw);
      }
    }

    return [...topics].slice(0, 5);
  }

  // ── Morning Briefing Context ───────────────────────────────────────────────

  getMorningBriefingContext(): {
    userName: string;
    projects: string[];
    recentSessions: string[];
    preferences: Record<string, string>;
    facts: string[];
  } {
    const userName = this.getPreference('name') || 'User';
    const projects = this.listProjects().map(e => e.value.split('\n')[0]);
    const recentSessions = this.sessions
      .filter(s => s.summary)
      .slice(-3)
      .map(s => s.summary);

    const preferences: Record<string, string> = {};
    this.getByCategory('preference').forEach(e => {
      const key = e.key.replace('pref:', '');
      preferences[key] = e.value;
    });

    return {
      userName,
      projects,
      recentSessions,
      preferences,
      facts: this.getFacts().slice(-5),
    };
  }

  // ── Stats ──────────────────────────────────────────────────────────────────

  getStats(): {
    totalEntries: number;
    byCategory: Record<string, number>;
    totalSessions: number;
    totalMessages: number;
  } {
    const byCategory: Record<string, number> = {};
    for (const entry of this.entries) {
      byCategory[entry.category] = (byCategory[entry.category] || 0) + 1;
    }

    return {
      totalEntries: this.entries.length,
      byCategory,
      totalSessions: this.sessions.length,
      totalMessages: this.sessions.reduce((sum, s) => sum + s.messages.length, 0),
    };
  }
}
