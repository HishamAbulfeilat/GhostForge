import { randomUUID } from 'crypto';
import type { ProactiveCheckin, SessionSummary } from '../shared/types';
import type { JarvisMemory } from './memory';

interface TimeSlot {
  period: 'morning' | 'midday' | 'afternoon' | 'evening' | 'night';
  hour: number;
}

interface TopicUpdate {
  topic: string;
  lastChecked: number;
  intervalMs: number;
}

export class JarvisProactive {
  private memory: JarvisMemory;
  private checkins: ProactiveCheckin[] = [];
  private monitoredTopics: TopicUpdate[] = [];
  private lastCheckin: number = 0;
  private checkinIntervalMs: number = 30 * 60 * 1000; // 30 minutes

  constructor(memory: JarvisMemory) {
    this.memory = memory;
  }

  // ── Time-Aware Check-ins ───────────────────────────────────────────────────

  getCurrentTimeSlot(): TimeSlot {
    const hour = new Date().getHours();

    if (hour >= 5 && hour < 9) return { period: 'morning', hour };
    if (hour >= 9 && hour < 12) return { period: 'midday', hour };
    if (hour >= 12 && hour < 17) return { period: 'afternoon', hour };
    if (hour >= 17 && hour < 21) return { period: 'evening', hour };
    return { period: 'night', hour };
  }

  shouldCheckIn(): boolean {
    const now = Date.now();
    if (now - this.lastCheckin < this.checkinIntervalMs) return false;

    const slot = this.getCurrentTimeSlot();

    // Don't interrupt during night
    if (slot.period === 'night') return false;

    // Check if we have a reason to check in
    if (this.hasTopicUpdates()) return true;
    if (this.hasPendingReminders()) return true;
    if (this.shouldSuggestBreak()) return true;

    return false;
  }

  generateCheckin(): ProactiveCheckin | null {
    const slot = this.getCurrentTimeSlot();
    const context = this.memory.getMorningBriefingContext();

    let message = '';
    let type: ProactiveCheckin['type'] = 'idle';

    // Priority 1: Topic updates
    const topicUpdate = this.getPendingTopicUpdate();
    if (topicUpdate) {
      message = `I noticed something new about "${topicUpdate.topic}" — want me to look into it?`;
      type = 'topic-update';
    }

    // Priority 2: Context-aware suggestions
    if (!message) {
      if (slot.period === 'morning' && context.projects.length > 0) {
        message = `Good morning, ${context.userName}! Ready to work on ${context.projects[0]}?`;
        type = 'morning';
      } else if (slot.period === 'afternoon') {
        message = this.getTimeAwareSuggestion(slot, context);
        type = 'idle';
      } else if (slot.period === 'evening') {
        message = this.getEveningSuggestion(context);
        type = 'idle';
      }
    }

    if (!message) return null;

    const checkin: ProactiveCheckin = {
      id: randomUUID(),
      type,
      message,
      timestamp: Date.now(),
      acknowledged: false,
    };

    this.checkins.push(checkin);
    this.lastCheckin = Date.now();
    return checkin;
  }

  private getTimeAwareSuggestion(
    slot: TimeSlot,
    context: { projects: string[]; recentSessions: string[]; preferences: Record<string, string> }
  ): string {
    const suggestions = [
      `How's the ${context.projects[0] || 'project'} going? Need any help?`,
      `Want me to review what we've been working on?`,
      `I can run a quick health check on the codebase if you'd like.`,
      `Time for a quick break? I can hold down the fort.`,
    ];

    // Pick based on time of day
    if (slot.hour >= 12 && slot.hour < 14) {
      return `It's lunch time — want me to handle anything while you take a break?`;
    }

    return suggestions[Math.floor(Math.random() * suggestions.length)];
  }

  private getEveningSuggestion(
    context: { projects: string[]; recentSessions: string[] }
  ): string {
    if (context.recentSessions.length > 0) {
      return `Good session today! Here's a recap: ${context.recentSessions[context.recentSessions.length - 1]}`;
    }
    return `Anything you'd like me to prepare for tomorrow?`;
  }

  // ── Topic Monitoring ───────────────────────────────────────────────────────

  monitorTopic(topic: string, intervalMs: number = 4 * 60 * 60 * 1000): void {
    const existing = this.monitoredTopics.find(t => t.topic === topic);
    if (existing) {
      existing.intervalMs = intervalMs;
      return;
    }

    this.monitoredTopics.push({
      topic,
      lastChecked: Date.now(),
      intervalMs,
    });
  }

  stopMonitoring(topic: string): void {
    this.monitoredTopics = this.monitoredTopics.filter(t => t.topic !== topic);
  }

  private hasTopicUpdates(): boolean {
    const now = Date.now();
    return this.monitoredTopics.some(
      t => now - t.lastChecked >= t.intervalMs
    );
  }

  private getPendingTopicUpdate(): TopicUpdate | null {
    const now = Date.now();
    return this.monitoredTopics.find(
      t => now - t.lastChecked >= t.intervalMs
    ) || null;
  }

  markTopicChecked(topic: string): void {
    const t = this.monitoredTopics.find(t => t.topic === topic);
    if (t) t.lastChecked = Date.now();
  }

  // ── Break Suggestions ──────────────────────────────────────────────────────

  private sessionStart: number = Date.now();

  setSessionStart(start: number): void {
    this.sessionStart = start;
  }

  private shouldSuggestBreak(): boolean {
    const elapsed = Date.now() - this.sessionStart;
    const breakInterval = 90 * 60 * 1000; // 90 minutes
    return elapsed > breakInterval && elapsed % breakInterval < this.checkinIntervalMs;
  }

  // ── Pending Reminders ──────────────────────────────────────────────────────

  private reminders: Array<{ id: string; message: string; dueAt: number; recurring?: string }> = [];

  addReminder(message: string, dueAt: number, recurring?: string): string {
    const id = randomUUID();
    this.reminders.push({ id, message, dueAt, recurring });
    return id;
  }

  removeReminder(id: string): boolean {
    const before = this.reminders.length;
    this.reminders = this.reminders.filter(r => r.id !== id);
    return this.reminders.length < before;
  }

  private hasPendingReminders(): boolean {
    const now = Date.now();
    return this.reminders.some(r => r.dueAt <= now);
  }

  getDueReminders(): Array<{ id: string; message: string; dueAt: number }> {
    const now = Date.now();
    return this.reminders.filter(r => r.dueAt <= now);
  }

  acknowledgeReminder(id: string): void {
    const reminder = this.reminders.find(r => r.id === id);
    if (reminder) {
      if (reminder.recurring) {
        // Reschedule recurring reminder
        const interval = this.parseRecurring(reminder.recurring);
        reminder.dueAt = Date.now() + interval;
      } else {
        this.reminders = this.reminders.filter(r => r.id !== id);
      }
    }
  }

  private parseRecurring(recurring: string): number {
    const match = recurring.match(/^(\d+)(m|h|d)$/);
    if (!match) return 24 * 60 * 60 * 1000; // default 1 day

    const [, amount, unit] = match;
    const n = parseInt(amount, 10);

    switch (unit) {
      case 'm': return n * 60 * 1000;
      case 'h': return n * 60 * 60 * 1000;
      case 'd': return n * 24 * 60 * 60 * 1000;
      default: return 24 * 60 * 60 * 1000;
    }
  }

  // ── Checkin History ────────────────────────────────────────────────────────

  getCheckins(): ProactiveCheckin[] {
    return [...this.checkins];
  }

  acknowledgeCheckin(id: string): void {
    const checkin = this.checkins.find(c => c.id === id);
    if (checkin) checkin.acknowledged = true;
  }

  getUnacknowledged(): ProactiveCheckin[] {
    return this.checkins.filter(c => !c.acknowledged);
  }

  clearOldCheckins(maxAge: number = 24 * 60 * 60 * 1000): void {
    const cutoff = Date.now() - maxAge;
    this.checkins = this.checkins.filter(c => c.timestamp > cutoff);
  }
}
