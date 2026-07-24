import type { JarvisMemory } from './memory';
import type { JarvisProactive } from './proactive';
import type { SessionSummary } from '../shared/types';

interface MorningBriefingData {
  greeting: string;
  time: string;
  weather: string;
  news: string[];
  yesterdayRecap: string;
  todayPlan: string;
  projects: string[];
  reminders: string[];
  advice: string;
}

export class MorningBriefingManager {
  private memory: JarvisMemory;
  private proactive: JarvisProactive;
  private lastBriefing: number = 0;

  constructor(memory: JarvisMemory, proactive: JarvisProactive) {
    this.memory = memory;
    this.proactive = proactive;
  }

  shouldShowBriefing(): boolean {
    // Show once per day, and only in the morning
    const now = Date.now();
    const hour = new Date().getHours();
    const dayStart = new Date().setHours(0, 0, 0, 0);

    if (now - this.lastBriefing < 12 * 60 * 60 * 1000) return false; // 12 hours
    if (hour < 5 || hour > 11) return false; // Only 5am-11am

    return true;
  }

  async generate(): Promise<MorningBriefingData> {
    this.lastBriefing = Date.now();
    const context = this.memory.getMorningBriefingContext();

    const now = new Date();
    const greeting = this.getGreeting(now.getHours(), context.userName);
    const time = this.formatTime(now);
    const weather = await this.getWeather(context.preferences.city || 'Amman');
    const news = await this.getNews();
    const yesterdayRecap = this.getYesterdayRecap();
    const todayPlan = this.getTodayPlan(context);
    const reminders = this.getReminderMessages();
    const advice = this.getAdvice(now, context.facts);

    return {
      greeting,
      time,
      weather,
      news,
      yesterdayRecap,
      todayPlan,
      projects: context.projects,
      reminders,
      advice,
    };
  }

  private getGreeting(hour: number, userName: string): string {
    const greetings = [
      `Good ${hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening'}, ${userName}!`,
      `Welcome back, ${userName}. Ready to build something great?`,
      `Hey ${userName}! I've been thinking about your projects while you were away.`,
      `Rise and shine, ${userName}! Here's what's happening today.`,
    ];
    return greetings[Math.floor(Math.random() * greetings.length)];
  }

  private formatTime(date: Date): string {
    return date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });
  }

  private async getWeather(city: string): Promise<string> {
    try {
      const response = await fetch(
        `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(city)}&units=metric&appid=demo`
      );
      if (!response.ok) throw new Error('Weather API unavailable');
      const data: any = await response.json();
      return `${Math.round(data.main.temp)}°C, ${data.weather[0].description} in ${city}`;
    } catch {
      return `Weather data unavailable for ${city}`;
    }
  }

  private async getNews(): Promise<string[]> {
    try {
      // Use DuckDuckGo news as a fallback
      const response = await fetch(
        'https://api.duckduckgo.com/?q=today+news&format=json&t=ghostforge'
      );
      if (!response.ok) throw new Error('News unavailable');
      const data: any = await response.json();

      // Extract headlines from Abstract
      if (data.AbstractText) {
        return [data.AbstractText];
      }

      return ['News feed temporarily unavailable'];
    } catch {
      return ['News feed temporarily unavailable'];
    }
  }

  private getYesterdayRecap(): string {
    const sessions = this.memory.getMorningBriefingContext().recentSessions;

    if (sessions.length === 0) {
      return "I don't have any session history from yesterday. Let's start fresh!";
    }

    const mostRecent = sessions[sessions.length - 1];
    return `Yesterday we were working on: ${mostRecent}`;
  }

  private getTodayPlan(
    context: { projects: string[]; preferences: Record<string, string>; facts: string[] }
  ): string {
    if (context.projects.length === 0) {
      return "What would you like to work on today?";
    }

    const plans = [
      `Your main project is ${context.projects[0]}. Want to continue where you left off?`,
      `We have ${context.projects.length} project${context.projects.length > 1 ? 's' : ''} in the queue. Shall we start with ${context.projects[0]}?`,
      `I'm ready to help with ${context.projects[0]} or anything else you need.`,
    ];

    return plans[Math.floor(Math.random() * plans.length)];
  }

  private getReminderMessages(): string[] {
    const due = this.proactive.getDueReminders();
    return due.map(r => r.message);
  }

  private getAdvice(date: Date, facts: string[]): string {
    const day = date.getDay();
    const hour = date.getHours();

    const advicePool: string[] = [];

    if (day === 1) {
      advicePool.push("It's Monday — great day to plan the week ahead.");
    } else if (day === 5) {
      advicePool.push("Friday! Let's wrap up loose ends before the weekend.");
    }

    if (hour < 8) {
      advicePool.push("Early bird! Consider tackling the hardest task first.");
    } else if (hour > 10) {
      advicePool.push("You're starting a bit late — no worries, I'm here when you're ready.");
    }

    if (facts.length > 0) {
      advicePool.push(`Fun fact I remember: ${facts[0]}`);
    }

    return advicePool.length > 0
      ? advicePool[Math.floor(Math.random() * advicePool.length)]
      : "Have a productive day!";
  }

  formatBriefing(briefing: MorningBriefingData): string {
    const lines: string[] = [];

    lines.push(briefing.greeting);
    lines.push(`It's ${briefing.time}.`);
    lines.push('');

    if (briefing.weather && !briefing.weather.includes('unavailable')) {
      lines.push(`Weather: ${briefing.weather}`);
      lines.push('');
    }

    if (briefing.yesterdayRecap) {
      lines.push(`Yesterday: ${briefing.yesterdayRecap}`);
      lines.push('');
    }

    if (briefing.projects.length > 0) {
      lines.push(`Projects: ${briefing.projects.join(', ')}`);
      lines.push('');
    }

    if (briefing.reminders.length > 0) {
      lines.push('Reminders:');
      briefing.reminders.forEach(r => lines.push(`  - ${r}`));
      lines.push('');
    }

    if (briefing.news.length > 0 && briefing.news[0] !== 'News feed temporarily unavailable') {
      lines.push('Headlines:');
      briefing.news.slice(0, 3).forEach(n => lines.push(`  - ${n}`));
      lines.push('');
    }

    if (briefing.advice) {
      lines.push(briefing.advice);
    }

    return lines.join('\n');
  }
}
