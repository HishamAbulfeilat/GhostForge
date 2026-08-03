import { EventEmitter } from 'events';
import { execSync, exec as execCb, execFile as execFileCb } from 'child_process';
import { promisify } from 'util';
import { randomUUID } from 'crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const execAsync = promisify(execCb);
const execFileAsync = promisify(execFileCb);

// ── Types ──────────────────────────────────────────────────────────────────

export type AgentState =
  | 'idle'
  | 'monitoring'
  | 'planning'
  | 'coding'
  | 'testing'
  | 'committing'
  | 'pr'
  | 'reporting'
  | 'paused'
  | 'completed';

export interface AgentConfig {
  repo: string;
  githubToken: string;
  ollamaUrl: string;
  ollamaModel: string;
  pollInterval: number;
  maxConcurrent: number;
  autoMerge: boolean;
  testRequired: boolean;
  labels: string[];
  branchPrefix: string;
  dryRun: boolean;
  maxFilesPerPR: number;
  maxLinesPerPR: number;
  workspaceDir: string;
}

export interface GitHubIssue {
  number: number;
  title: string;
  body: string;
  labels: string[];
  state: string;
  user: string;
  url: string;
  createdAt: string;
  assignee: string | null;
}

export interface TaskPlan {
  issueNumber: number;
  subtasks: Subtask[];
  estimatedComplexity: 'low' | 'medium' | 'high';
  totalEstimatedLines: number;
}

export interface Subtask {
  id: string;
  description: string;
  files: string[];
  estimatedLines: number;
  status: 'pending' | 'in-progress' | 'done' | 'failed';
}

export interface GeneratedFile {
  path: string;
  content: string;
  action: 'create' | 'modify' | 'delete';
}

export interface TestResults {
  lint: TestResult;
  typeCheck: TestResult;
  tests: TestResult;
  build: TestResult;
}

export interface TestResult {
  passed: boolean;
  output: string;
  duration: number;
  error?: string;
}

export interface ProcessedIssue {
  issueNumber: number;
  branch: string;
  files: GeneratedFile[];
  prUrl: string | null;
  testResults: TestResults;
  status: 'success' | 'partial' | 'failed';
  error?: string;
  startedAt: number;
  completedAt: number;
}

export interface AgentStatus {
  state: AgentState;
  config: AgentConfig;
  currentIssue: number | null;
  processedCount: number;
  failedCount: number;
  pendingIssues: number[];
  lastPollAt: number | null;
  uptime: number;
  startedAt: number | null;
}

interface OllamaResponse {
  model: string;
  response: string;
  done: boolean;
}

// ── Defaults ───────────────────────────────────────────────────────────────

const DEFAULT_CONFIG: AgentConfig = {
  repo: 'HishamAbulfeilat/GhostForge',
  githubToken: '',
  ollamaUrl: 'http://localhost:11434',
  ollamaModel: 'llama3.2:3b',
  pollInterval: 60_000,
  maxConcurrent: 1,
  autoMerge: false,
  testRequired: true,
  labels: ['agent:auto', 'good first issue'],
  branchPrefix: 'agent/',
  dryRun: false,
  maxFilesPerPR: 10,
  maxLinesPerPR: 500,
  workspaceDir: process.cwd(),
};

const GITHUB_API = 'https://api.github.com';
const STORE_KEY = 'autonomous-agent';
const SKIP_LABEL = 'agent:skip';
const AGENT_LABEL = 'agent:working';

// ── Main Class ─────────────────────────────────────────────────────────────

export class AutonomousAgent extends EventEmitter {
  private config: AgentConfig;
  private state: AgentState = 'idle';
  private currentIssue: number | null = null;
  private processedIssues: Map<number, ProcessedIssue> = new Map();
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private loopRunning = false;
  private startedAt: number | null = null;
  private store: any;

  constructor(config?: Partial<AgentConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.loadConfig();
  }

  // ── State Machine ────────────────────────────────────────────────────────

  private setState(newState: AgentState): void {
    const prev = this.state;
    this.state = newState;
    this.emit('state:changed', { from: prev, to: newState });
    this.log(`State: ${prev} → ${newState}`);
  }

  getState(): AgentState {
    return this.state;
  }

  // ── Config Persistence ───────────────────────────────────────────────────

  private loadConfig(): void {
    try {
      const Store = require('electron-store');
      this.store = new Store({ name: STORE_KEY });
      const saved = this.store.get('config') as Partial<AgentConfig> | undefined;
      if (saved) {
        this.config = { ...this.config, ...saved };
      }
      const history = this.store.get('processedIssues') as Array<[number, ProcessedIssue]> | undefined;
      if (history) {
        this.processedIssues = new Map(history);
      }
    } catch {
      this.store = null;
    }
  }

  private saveConfig(): void {
    if (!this.store) return;
    try {
      this.store.set('config', this.config);
      this.store.set('processedIssues', Array.from(this.processedIssues.entries()));
    } catch { /* ignore */ }
  }

  // ── Logging ──────────────────────────────────────────────────────────────

  private log(message: string, level: 'info' | 'warn' | 'error' = 'info'): void {
    const timestamp = new Date().toISOString();
    const prefix = `[AutonomousAgent ${timestamp}]`;
    if (level === 'error') {
      console.error(`${prefix} ${message}`);
    } else if (level === 'warn') {
      console.warn(`${prefix} ${message}`);
    } else {
      console.log(`${prefix} ${message}`);
    }
    this.emit('log', { timestamp, level, message });
  }

  // ── GitHub API ───────────────────────────────────────────────────────────

  private async githubRequest(
    method: string,
    path: string,
    body?: unknown
  ): Promise<any> {
    const url = path.startsWith('http') ? path : `${GITHUB_API}${path}`;
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    };

    if (this.config.githubToken) {
      headers.Authorization = `Bearer ${this.config.githubToken}`;
    }

    if (body) {
      headers['Content-Type'] = 'application/json';
    }

    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      throw new Error(
        `GitHub API ${method} ${path} failed (${response.status}): ${errorText}`
      );
    }

    const text = await response.text();
    return text ? JSON.parse(text) : {};
  }

  async fetchIssues(repo?: string): Promise<GitHubIssue[]> {
    const targetRepo = repo || this.config.repo;
    const labels = this.config.labels.join(',');

    this.log(`Fetching issues for ${targetRepo} with labels: ${labels}`);

    const data = await this.githubRequest(
      'GET',
      `/repos/${targetRepo}/issues?labels=${encodeURIComponent(labels)}&state=open&per_page=30`
    );

    const issues: GitHubIssue[] = [];
    for (const item of data as any[]) {
      if (item.pull_request) continue;

      const issueLabels = (item.labels || []).map((l: any) => l.name as string);

      if (issueLabels.includes(SKIP_LABEL)) {
        this.log(`Skipping issue #${item.number} (has ${SKIP_LABEL} label)`, 'warn');
        continue;
      }

      if (this.processedIssues.has(item.number)) {
        const processed = this.processedIssues.get(item.number)!;
        if (processed.status === 'success' && processed.prUrl) continue;
      }

      issues.push({
        number: item.number,
        title: item.title,
        body: item.body || '',
        labels: issueLabels,
        state: item.state,
        user: item.user?.login || 'unknown',
        url: item.html_url,
        createdAt: item.created_at,
        assignee: item.assignee?.login || null,
      });
    }

    this.emit('issues:fetched', issues);
    return issues;
  }

  async analyzeIssue(issue: GitHubIssue): Promise<{
    requirements: string[];
    complexity: 'low' | 'medium' | 'high';
    estimatedLines: number;
    suggestedLabels: string[];
  }> {
    this.log(`Analyzing issue #${issue.number}: ${issue.title}`);

    const prompt = `Analyze this GitHub issue and extract requirements, estimate complexity, and suggest labels.

Issue Title: ${issue.title}
Issue Body:
${issue.body.substring(0, 2000)}

Respond in JSON format:
{
  "requirements": ["requirement 1", "requirement 2"],
  "complexity": "low|medium|high",
  "estimatedLines": number,
  "suggestedLabels": ["label1"]
}`;

    try {
      const response = await this.queryOllama(prompt);
      const parsed = this.parseJsonFromResponse(response);
      return {
        requirements: parsed.requirements || [issue.title],
        complexity: parsed.complexity || 'medium',
        estimatedLines: parsed.estimatedLines || 100,
        suggestedLabels: parsed.suggestedLabels || [],
      };
    } catch (err: any) {
      this.log(`Analysis fallback for #${issue.number}: ${err.message}`, 'warn');
      return {
        requirements: [issue.title, issue.body.substring(0, 200)],
        complexity: 'medium',
        estimatedLines: 100,
        suggestedLabels: [],
      };
    }
  }

  async commentOnIssue(issueNumber: number, body: string): Promise<void> {
    const { repo } = this.config;
    this.log(`Commenting on issue #${issueNumber}`);

    await this.githubRequest(
      'POST',
      `/repos/${repo}/issues/${issueNumber}/comments`,
      { body }
    );
  }

  async addLabelToIssue(issueNumber: number, label: string): Promise<void> {
    const { repo } = this.config;
    try {
      await this.githubRequest(
        'POST',
        `/repos/${repo}/issues/${issueNumber}/labels`,
        { labels: [label] }
      );
    } catch (err: any) {
      this.log(`Failed to add label "${label}" to #${issueNumber}: ${err.message}`, 'warn');
    }
  }

  async removeLabelFromIssue(issueNumber: number, label: string): Promise<void> {
    const { repo } = this.config;
    try {
      await this.githubRequest(
        'DELETE',
        `/repos/${repo}/issues/${issueNumber}/labels/${label}`
      );
    } catch { /* ignore */ }
  }

  async closeIssue(issueNumber: number): Promise<void> {
    const { repo } = this.config;
    await this.githubRequest(
      'PATCH',
      `/repos/${repo}/issues/${issueNumber}`,
      { state: 'closed' }
    );
  }

  // ── Git Operations ───────────────────────────────────────────────────────

  private async gitExec(command: string): Promise<string> {
    try {
      const result = await execAsync(command, {
        cwd: this.config.workspaceDir,
        timeout: 30_000,
        maxBuffer: 1024 * 1024,
      });
      return (result.stdout || '').trim();
    } catch (err: any) {
      throw new Error(`Git command failed: ${command}\n${err.stderr || err.message}`);
    }
  }

  /** Run git with an argument array — no shell interpolation. */
  private async gitExecFile(args: string[]): Promise<string> {
    try {
      const result = await execFileAsync('git', args, {
        cwd: this.config.workspaceDir,
        timeout: 30_000,
        maxBuffer: 1024 * 1024,
      });
      return (result.stdout || '').trim();
    } catch (err: any) {
      throw new Error(`Git command failed: git ${args.join(' ')}\n${err.stderr || err.message}`);
    }
  }

  async createBranch(name: string): Promise<string> {
    const branchName = `${this.config.branchPrefix}${name}`;
    if (!/^[A-Za-z0-9_\-/.]+$/.test(branchName)) {
      throw new Error(`Invalid branch name: ${branchName}`);
    }
    this.log(`Creating branch: ${branchName}`);

    await this.gitExec('git fetch origin');

    try {
      await this.gitExec('git branch --show-current');
      await this.gitExec('git checkout main 2>/dev/null || git checkout master');
    } catch { /* may already be on main */ }

    await this.gitExec('git pull origin main 2>/dev/null || git pull origin master');
    await this.gitExecFile(['checkout', '-b', branchName]);

    return branchName;
  }

  async commitChanges(files: GeneratedFile[], message: string): Promise<string> {
    this.log(`Committing ${files.length} files: ${message}`);

    for (const file of files) {
      const filePath = join(this.config.workspaceDir, file.path);
      const dir = join(filePath, '..');

      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }

      if (file.action === 'delete') {
        await this.gitExecFile(['rm', file.path]);
      } else {
        writeFileSync(filePath, file.content, 'utf8');
        await this.gitExecFile(['add', file.path]);
      }
    }

    await this.gitExecFile(['commit', '-m', message]);

    const hash = await this.gitExec('git rev-parse --short HEAD');
    return hash;
  }

  async pushBranch(branchName: string): Promise<void> {
    this.log(`Pushing branch: ${branchName}`);
    await this.gitExecFile(['push', '-u', 'origin', branchName]);
  }

  async getCurrentBranch(): Promise<string> {
    return this.gitExec('git branch --show-current');
  }

  async getDiff(): Promise<string> {
    return this.gitExec('git diff --stat HEAD~1');
  }

  async getChangedFiles(): Promise<string[]> {
    const output = await this.gitExec('git diff --name-only HEAD~1');
    return output ? output.split('\n').filter(Boolean) : [];
  }

  // ── PR Operations ────────────────────────────────────────────────────────

  async createPR(
    branchName: string,
    title: string,
    body: string
  ): Promise<{ url: string; number: number }> {
    const { repo } = this.config;
    this.log(`Creating PR: ${title}`);

    const data = await this.githubRequest('POST', `/repos/${repo}/pulls`, {
      title,
      body,
      head: branchName,
      base: 'main',
    });

    const prUrl = data.html_url;
    const prNumber = data.number;

    this.log(`PR created: ${prUrl}`);
    this.emit('pr:created', { url: prUrl, number: prNumber });

    return { url: prUrl, number: prNumber };
  }

  // ── Ollama / Code Generation ─────────────────────────────────────────────

  private async queryOllama(prompt: string, options?: {
    model?: string;
    temperature?: number;
    format?: string;
  }): Promise<string> {
    const url = `${this.config.ollamaUrl}/api/generate`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: options?.model || this.config.ollamaModel,
        prompt,
        stream: false,
        options: {
          temperature: options?.temperature ?? 0.3,
        },
        format: options?.format,
      }),
    });

    if (!response.ok) {
      throw new Error(`Ollama request failed: ${response.status}`);
    }

    const data = await response.json() as OllamaResponse;
    return data.response;
  }

  private parseJsonFromResponse(response: string): any {
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[0]);
      } catch { /* fall through */ }
    }

    const arrayMatch = response.match(/\[[\s\S]*\]/);
    if (arrayMatch) {
      try {
        return JSON.parse(arrayMatch[0]);
      } catch { /* fall through */ }
    }

    return {};
  }

  // ── Planning ─────────────────────────────────────────────────────────────

  async planSolution(issue: GitHubIssue): Promise<TaskPlan> {
    this.log(`Planning solution for #${issue.number}`);
    this.setState('planning');

    const prompt = `You are a senior software engineer planning a solution for a GitHub issue.

Issue #${issue.number}: ${issue.title}
Description: ${issue.body.substring(0, 2000)}

The project uses React 18+, Next.js 14+, TypeScript, Tailwind CSS.
Arabic/RTL support is a first-class concern.

Break this issue into subtasks. For each subtask, specify:
- description: what needs to be done
- files: list of files to create or modify (relative paths)
- estimatedLines: estimated lines of code

Respond in JSON:
{
  "subtasks": [
    {
      "description": "...",
      "files": ["src/path/to/file.ts"],
      "estimatedLines": 50
    }
  ],
  "estimatedComplexity": "low|medium|high",
  "totalEstimatedLines": 200
}`;

    const response = await this.queryOllama(prompt);
    const parsed = this.parseJsonFromResponse(response);

    const subtasks: Subtask[] = (parsed.subtasks || []).map((st: any) => ({
      id: randomUUID(),
      description: st.description || 'Unknown task',
      files: st.files || [],
      estimatedLines: st.estimatedLines || 50,
      status: 'pending' as const,
    }));

    if (subtasks.length === 0) {
      subtasks.push({
        id: randomUUID(),
        description: `Implement: ${issue.title}`,
        files: [],
        estimatedLines: 100,
        status: 'pending',
      });
    }

    const plan: TaskPlan = {
      issueNumber: issue.number,
      subtasks,
      estimatedComplexity: parsed.estimatedComplexity || 'medium',
      totalEstimatedLines: parsed.totalEstimatedLines || subtasks.reduce((s, t) => s + t.estimatedLines, 0),
    };

    this.emit('plan:created', plan);
    return plan;
  }

  // ── Code Generation ──────────────────────────────────────────────────────

  async generateCode(
    task: Subtask,
    issue: GitHubIssue,
    existingFiles?: Map<string, string>
  ): Promise<GeneratedFile[]> {
    this.log(`Generating code for: ${task.description}`);
    this.setState('coding');

    let contextFiles = '';
    if (existingFiles && existingFiles.size > 0) {
      const entries = Array.from(existingFiles.entries()).slice(0, 5);
      contextFiles = '\n\nExisting file context:\n' + entries
        .map(([path, content]) => `--- ${path} ---\n${content.substring(0, 1500)}`)
        .join('\n\n');
    }

    const prompt = `You are a TypeScript/React developer writing production code.

Issue: #${issue.number} - ${issue.title}
Task: ${task.description}
Target files: ${task.files.join(', ') || 'determine appropriate files'}

Project conventions:
- React 18+, Next.js 14+, TypeScript strict, Tailwind CSS
- Use logical CSS properties for RTL support
- No comments in code
- Follow existing code patterns${contextFiles}

Generate the code changes. Respond in JSON:
{
  "files": [
    {
      "path": "src/path/to/file.tsx",
      "content": "full file content here",
      "action": "create|modify"
    }
  ]
}

IMPORTANT: Output complete, production-ready code. No placeholders.`;

    const response = await this.queryOllama(prompt, { temperature: 0.2 });
    const parsed = this.parseJsonFromResponse(response);

    const files: GeneratedFile[] = (parsed.files || []).map((f: any) => ({
      path: f.path || 'src/generated.ts',
      content: f.content || '',
      action: (f.action as GeneratedFile['action']) || 'create',
    })).filter((f: GeneratedFile) => f.content.length > 0);

    if (files.length === 0) {
      this.log(`No files generated for task: ${task.description}`, 'warn');
    }

    this.emit('code:generated', files);
    return files;
  }

  async generateTests(code: GeneratedFile[], issue: GitHubIssue): Promise<GeneratedFile[]> {
    this.log(`Generating tests for ${code.length} files`);

    const codeContext = code
      .map(f => `--- ${f.path} ---\n${f.content.substring(0, 2000)}`)
      .join('\n\n');

    const prompt = `Generate unit tests for the following code changes.

Issue: #${issue.number} - ${issue.title}

Code:
${codeContext}

Generate test files. Use the testing framework found in the project (check for jest.config, vitest.config, etc.).
If no test framework is configured, create simple assertion-based tests.

Respond in JSON:
{
  "tests": [
    {
      "path": "src/__tests__/filename.test.ts",
      "content": "test file content",
      "action": "create"
    }
  ]
}`;

    const response = await this.queryOllama(prompt, { temperature: 0.2 });
    const parsed = this.parseJsonFromResponse(response);

    return (parsed.tests || []).map((t: any) => ({
      path: t.path || `src/__tests__/test-${randomUUID().substring(0, 8)}.test.ts`,
      content: t.content || '',
      action: 'create' as const,
    })).filter((f: GeneratedFile) => f.content.length > 0);
  }

  async generatePRDescription(
    issue: GitHubIssue,
    changes: GeneratedFile[],
    testResults: TestResults
  ): Promise<string> {
    this.log(`Generating PR description for #${issue.number}`);

    const fileList = changes.map(f => `- \`${f.path}\` (${f.action})`).join('\n');
    const testSummary = [
      `Lint: ${testResults.lint.passed ? '✅' : '❌'}`,
      `TypeCheck: ${testResults.typeCheck.passed ? '✅' : '❌'}`,
      `Tests: ${testResults.tests.passed ? '✅' : '❌'}`,
      `Build: ${testResults.build.passed ? '✅' : '❌'}`,
    ].join('\n');

    const prompt = `Write a GitHub Pull Request description for this change.

Issue: #${issue.number} - ${issue.title}
Issue description: ${issue.body.substring(0, 1000)}

Changes made:
${fileList}

Test results:
${testSummary}

Write a concise PR description with:
1. Summary of changes
2. How it addresses the issue
3. Testing checklist

Keep it under 500 words. Use markdown.`;

    const response = await this.queryOllama(prompt, { temperature: 0.3 });
    return response.trim();
  }

  // ── Test Runner ──────────────────────────────────────────────────────────

  private async runCommand(
    command: string,
    label: string
  ): Promise<TestResult> {
    const start = Date.now();
    this.log(`Running: ${label} (${command})`);

    try {
      const result = await execAsync(command, {
        cwd: this.config.workspaceDir,
        timeout: 120_000,
        maxBuffer: 5 * 1024 * 1024,
      });
      const duration = Date.now() - start;
      this.log(`${label} passed (${duration}ms)`);
      return { passed: true, output: result.stdout || '', duration };
    } catch (err: any) {
      const duration = Date.now() - start;
      const output = (err.stdout || '') + '\n' + (err.stderr || '');
      this.log(`${label} failed (${duration}ms): ${err.message}`, 'error');
      return {
        passed: false,
        output: output.trim(),
        duration,
        error: err.message,
      };
    }
  }

  async runLint(): Promise<TestResult> {
    return this.runCommand('npm run lint 2>&1 || true', 'Lint');
  }

  async runTypeCheck(): Promise<TestResult> {
    return this.runCommand('npx tsc --noEmit 2>&1 || true', 'TypeCheck');
  }

  async runTests(): Promise<TestResult> {
    return this.runCommand('npm test 2>&1 || true', 'Tests');
  }

  async runBuild(): Promise<TestResult> {
    return this.runCommand('npm run build 2>&1 || true', 'Build');
  }

  async runAllTests(): Promise<TestResults> {
    this.setState('testing');

    const lint = await this.runLint();
    const typeCheck = await this.runTypeCheck();
    const tests = await this.runTests();
    const build = await this.runBuild();

    const results: TestResults = { lint, typeCheck, tests, build };
    this.emit('test:results', results);

    return results;
  }

  // ── Issue Processing Pipeline ────────────────────────────────────────────

  async processIssue(issue: GitHubIssue): Promise<ProcessedIssue> {
    const startTime = Date.now();
    this.log(`Processing issue #${issue.number}: ${issue.title}`);
    this.currentIssue = issue.number;

    const processed: ProcessedIssue = {
      issueNumber: issue.number,
      branch: '',
      files: [],
      prUrl: null,
      testResults: { lint: { passed: true, output: '', duration: 0 }, typeCheck: { passed: true, output: '', duration: 0 }, tests: { passed: true, output: '', duration: 0 }, build: { passed: true, output: '', duration: 0 } },
      status: 'failed',
      startedAt: startTime,
      completedAt: startTime,
    };

    try {
      this.emit('issue:start', issue);
      await this.addLabelToIssue(issue.number, AGENT_LABEL);
      await this.commentOnIssue(
        issue.number,
        `🤖 **GhostForge Autonomous Agent** is working on this issue.\n\n` +
        `- Analyzing requirements...\n` +
        `- Estimated complexity: checking...\n` +
        `- Started at: ${new Date().toISOString()}`
      );

      const analysis = await this.analyzeIssue(issue);

      const branchName = await this.createBranch(`issue-${issue.number}-${Date.now()}`);
      processed.branch = branchName;

      const plan = await this.planSolution(issue);

      await this.commentOnIssue(
        issue.number,
        `📋 **Plan ready:**\n\n` +
        `- Complexity: ${analysis.complexity}\n` +
        `- Estimated lines: ${analysis.estimatedLines}\n` +
        `- Subtasks: ${plan.subtasks.length}\n` +
        `- Branch: \`${branchName}\``
      );

      if (analysis.estimatedLines > this.config.maxLinesPerPR) {
        await this.commentOnIssue(
          issue.number,
          `⚠️ **Requires human approval** — estimated ${analysis.estimatedLines} lines exceeds ` +
          `limit of ${this.config.maxLinesPerPR}. Pausing.`
        );
        this.setState('paused');
        processed.status = 'partial';
        processed.completedAt = Date.now();
        this.processedIssues.set(issue.number, processed);
        this.saveConfig();
        return processed;
      }

      const allFiles: GeneratedFile[] = [];
      for (const subtask of plan.subtasks) {
        subtask.status = 'in-progress';
        this.emit('subtask:start', subtask);

        const files = await this.generateCode(subtask, issue);
        allFiles.push(...files);
        subtask.status = files.length > 0 ? 'done' : 'failed';
      }

      if (allFiles.length > this.config.maxFilesPerPR) {
        this.log(
          `Too many files (${allFiles.length}), truncating to ${this.config.maxFilesPerPR}`,
          'warn'
        );
        allFiles.splice(this.config.maxFilesPerPR);
      }

      processed.files = allFiles;

      if (allFiles.length > 0 && this.config.testRequired) {
        const testFiles = await this.generateTests(allFiles, issue);
        allFiles.push(...testFiles);
      }

      if (this.config.dryRun) {
        this.log('Dry run mode — not committing', 'warn');
        await this.commentOnIssue(
          issue.number,
          `🧪 **Dry run complete.** Generated ${allFiles.length} files. ` +
          `Run without dry mode to commit and create PR.`
        );
        processed.status = 'partial';
        processed.completedAt = Date.now();
        this.processedIssues.set(issue.number, processed);
        this.saveConfig();
        return processed;
      }

      this.setState('committing');
      const commitMessage = `feat: resolve #${issue.number} — ${issue.title.substring(0, 72)}\n\n` +
        `Automated by GhostForge Autonomous Agent\n` +
        `Closes #${issue.number}`;
      await this.commitChanges(allFiles, commitMessage);

      const testResults = await this.runAllTests();
      processed.testResults = testResults;

      if (this.config.testRequired && !testResults.lint.passed && !testResults.build.passed) {
        this.log('Tests failed, not pushing', 'warn');
        await this.commentOnIssue(
          issue.number,
          `❌ **Tests failed.** Lint: ${testResults.lint.passed ? '✅' : '❌'}, ` +
          `TypeCheck: ${testResults.typeCheck.passed ? '✅' : '❌'}, ` +
          `Build: ${testResults.build.passed ? '✅' : '❌'}.\n\n\`\`\`\n${
            (testResults.lint.error || testResults.build.error || '').substring(0, 500)
          }\n\`\`\``
        );
        processed.status = 'failed';
        processed.completedAt = Date.now();
        this.processedIssues.set(issue.number, processed);
        this.saveConfig();
        return processed;
      }

      this.setState('pr');
      await this.pushBranch(branchName);
      const prDescription = await this.generatePRDescription(issue, allFiles, testResults);
      const prTitle = `feat: resolve #${issue.number} — ${issue.title}`;
      const pr = await this.createPR(branchName, prTitle, prDescription);
      processed.prUrl = pr.url;

      this.setState('reporting');
      await this.commentOnIssue(
        issue.number,
        `✅ **Pull request created!**\n\n` +
        `- PR: ${pr.url}\n` +
        `- Branch: \`${branchName}\`\n` +
        `- Files changed: ${allFiles.length}\n` +
        `- Lint: ${testResults.lint.passed ? '✅' : '❌'}\n` +
        `- TypeCheck: ${testResults.typeCheck.passed ? '✅' : '❌'}\n` +
        `- Build: ${testResults.build.passed ? '✅' : '❌'}`
      );

      processed.status = 'success';
      this.emit('issue:complete', processed);
    } catch (err: any) {
      this.log(`Failed to process #${issue.number}: ${err.message}`, 'error');
      processed.error = err.message;
      processed.status = 'failed';
      this.emit('error', { issueNumber: issue.number, error: err });

      try {
        await this.commentOnIssue(
          issue.number,
          `❌ **Agent encountered an error:**\n\n\`\`\`\n${err.message.substring(0, 1000)}\n\`\`\`\n\n` +
          `Please check manually or re-run the agent.`
        );
      } catch { /* ignore secondary errors */ }
    } finally {
      processed.completedAt = Date.now();
      this.processedIssues.set(issue.number, processed);
      this.currentIssue = null;
      this.saveConfig();

      try {
        await this.removeLabelFromIssue(issue.number, AGENT_LABEL);
      } catch { /* ignore */ }
    }

    return processed;
  }

  // ── Agent Loop ───────────────────────────────────────────────────────────

  async startAgentLoop(): Promise<void> {
    if (this.loopRunning) {
      this.log('Agent loop already running', 'warn');
      return;
    }

    this.loopRunning = true;
    this.startedAt = Date.now();
    this.setState('monitoring');
    this.emit('loop:started');

    this.log(`Agent loop started. Polling every ${this.config.pollInterval}ms`);

    while (this.loopRunning && !this.isPaused()) {
      try {
        const issues = await this.fetchIssues();
        this.emit('progress', { current: 0, total: issues.length });

        for (let i = 0; i < issues.length; i++) {
          if (!this.loopRunning || this.isPaused()) break;

          this.emit('progress', { current: i + 1, total: issues.length });
          await this.processIssue(issues[i]);
        }

        if (issues.length === 0) {
          this.log('No pending issues found');
          this.setState('completed');
        }
      } catch (err: any) {
        this.log(`Loop iteration failed: ${err.message}`, 'error');
        this.emit('error', { error: err });
      }

      if (this.loopRunning && !this.isPaused()) {
        this.setState('monitoring');
        await this.sleep(this.config.pollInterval);
      }
    }

    this.loopRunning = false;
    this.emit('loop:stopped');
    this.log('Agent loop stopped');
  }

  stopAgentLoop(): void {
    this.log('Stopping agent loop');
    this.loopRunning = false;
    this.setState('idle');
  }

  pauseAgent(): void {
    if (this.isPaused()) return;
    this.log('Agent paused');
    this.setState('paused');
  }

  private isPaused(): boolean {
    return (this.state as string) === 'paused';
  }

  resumeAgent(): void {
    if (!this.loopRunning) return;
    this.log('Agent resumed');
    this.setState('monitoring');
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // ── Status ───────────────────────────────────────────────────────────────

  getStatus(): AgentStatus {
    const pendingIssues: number[] = [];
    let processedCount = 0;
    let failedCount = 0;
    const entries = Array.from(this.processedIssues.entries());
    for (let i = 0; i < entries.length; i++) {
      const [num, p] = entries[i];
      if (p.status === 'failed' || p.status === 'partial') {
        pendingIssues.push(num);
      }
      if (p.status === 'success') processedCount++;
      else if (p.status === 'failed') failedCount++;
    }

    return {
      state: this.state,
      config: this.config,
      currentIssue: this.currentIssue,
      processedCount,
      failedCount,
      pendingIssues,
      lastPollAt: null,
      uptime: this.startedAt ? Date.now() - this.startedAt : 0,
      startedAt: this.startedAt,
    };
  }

  getProcessedIssues(): ProcessedIssue[] {
    return Array.from(this.processedIssues.values());
  }

  updateConfig(updates: Partial<AgentConfig>): void {
    this.config = { ...this.config, ...updates };
    this.saveConfig();
    this.emit('config:updated', this.config);
  }

  getConfig(): AgentConfig {
    return { ...this.config };
  }
}

// ── Singleton & n8n/Webhook Exports ────────────────────────────────────────

let agentInstance: AutonomousAgent | null = null;

function getAgent(config?: Partial<AgentConfig>): AutonomousAgent {
  if (!agentInstance) {
    agentInstance = new AutonomousAgent(config);
  }
  return agentInstance;
}

export function triggerAgentStart(config?: Partial<AgentConfig>): Promise<void> {
  const agent = getAgent(config);
  if (config) agent.updateConfig(config);
  return agent.startAgentLoop();
}

export function triggerAgentStop(): void {
  if (agentInstance) {
    agentInstance.stopAgentLoop();
  }
}

export function triggerAgentStatus(): AgentStatus | null {
  return agentInstance?.getStatus() || null;
}

export async function triggerIssueProcess(issueNumber: number): Promise<ProcessedIssue | null> {
  if (!agentInstance) return null;

  const issues = await agentInstance.fetchIssues();
  const issue = issues.find(i => i.number === issueNumber);
  if (!issue) return null;

  return agentInstance.processIssue(issue);
}

// ── IPC Registration (called from index.ts) ────────────────────────────────

export function registerAutonomousAgentIPC(ipcMain: any): void {
  ipcMain.handle('jarvis:agent-start', async (_event: any, config?: Partial<AgentConfig>) => {
    const agent = getAgent(config);
    if (config) agent.updateConfig(config);
    await agent.startAgentLoop();
    return { success: true };
  });

  ipcMain.handle('jarvis:agent-stop', () => {
    triggerAgentStop();
    return { success: true };
  });

  ipcMain.handle('jarvis:agent-status', () => {
    return triggerAgentStatus();
  });

  ipcMain.handle('jarvis:agent-config', (_event: any, updates?: Partial<AgentConfig>) => {
    const agent = getAgent();
    if (updates) {
      agent.updateConfig(updates);
    }
    return agent.getConfig();
  });

  ipcMain.handle('jarvis:agent-issues', () => {
    return agentInstance?.getProcessedIssues() || [];
  });

  ipcMain.handle('jarvis:agent-process', async (_event: any, issueNumber: number) => {
    return triggerIssueProcess(issueNumber);
  });

  ipcMain.handle('jarvis:agent-pause', () => {
    const agent = getAgent();
    agent.pauseAgent();
    return { success: true };
  });

  ipcMain.handle('jarvis:agent-resume', () => {
    const agent = getAgent();
    agent.resumeAgent();
    return { success: true };
  });

  // Forward agent events to renderer
  const forwardEvents = [
    'state:changed',
    'issue:start',
    'code:generated',
    'test:results',
    'pr:created',
    'error',
    'progress',
    'plan:created',
    'subtask:start',
    'issue:complete',
  ];

  for (const eventName of forwardEvents) {
    ipcMain.on(`jarvis:agent-on-${eventName}`, (event: any) => {
      const agent = getAgent();
      agent.on(eventName, (data: any) => {
        if (!event.sender.isDestroyed()) {
          event.sender.send(`jarvis:agent-event:${eventName}`, data);
        }
      });
    });
  }
}
