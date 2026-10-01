import type { N8nWorkflow } from '../shared/types';
import { N8N } from '../shared/constants';
import { validateOutboundUrl } from './outbound-url';

interface N8nConfig {
  baseUrl: string;
  apiKey?: string;
}

interface WorkflowTrigger {
  workflowId: string;
  event: string;
  callback: (data: unknown) => void;
}

export class N8nIntegration {
  private config: N8nConfig;
  private workflows: N8nWorkflow[] = [];
  private triggers: WorkflowTrigger[] = [];

  constructor(config?: Partial<N8nConfig>) {
    this.config = {
      baseUrl: config?.baseUrl || N8N.defaultUrl,
      apiKey: config?.apiKey,
    };
    this.validateBaseUrl();
  }

  private validateBaseUrl(): URL {
    return validateOutboundUrl(
      this.config.baseUrl,
      ['localhost', '127.0.0.1', '::1'],
      'n8n',
      ['http:', 'https:'],
      ['5678'],
    );
  }

  // ── Connection ─────────────────────────────────────────────────────────────

  async isConnected(): Promise<boolean> {
    try {
      const response = await fetch(`${this.config.baseUrl}/healthz`, {
        signal: AbortSignal.timeout(5000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async getVersion(): Promise<string | null> {
    try {
      const response = await this.request('GET', '/api/v1/workflows');
      if (response.ok) {
        const data: any = await response.json();
        return data.version || 'unknown';
      }
    } catch {}
    return null;
  }

  // ── Workflow Management ────────────────────────────────────────────────────

  async listWorkflows(): Promise<N8nWorkflow[]> {
    try {
      const response = await this.request('GET', '/api/v1/workflows');
      if (!response.ok) throw new Error('Failed to fetch workflows');

      const data: any = await response.json();
      this.workflows = (data.data || []).map((w: any) => ({
        id: w.id,
        name: w.name,
        webhookUrl: w.nodes?.find((n: any) => n.type === 'n8n-nodes-base.webhook')?.webhookPath || '',
        active: w.active,
        trigger: w.nodes?.[0]?.type || 'manual',
      }));

      return this.workflows;
    } catch (error: any) {
      console.error('Failed to list n8n workflows:', error);
      return [];
    }
  }

  async getWorkflow(id: string): Promise<unknown> {
    const response = await this.request('GET', `/api/v1/workflows/${id}`);
    if (!response.ok) throw new Error('Workflow not found');
    const data: any = await response.json();
    return data;
  }

  async createWorkflow(workflow: {
    name: string;
    nodes: unknown[];
    connections: Record<string, unknown>;
  }): Promise<N8nWorkflow | null> {
    try {
      const response = await this.request('POST', '/api/v1/workflows', workflow);
      if (!response.ok) throw new Error('Failed to create workflow');

      const data: any = await response.json();
      return {
        id: data.id,
        name: data.name,
        webhookUrl: '',
        active: false,
        trigger: 'manual',
      };
    } catch (error: any) {
      console.error('Failed to create workflow:', error);
      return null;
    }
  }

  async activateWorkflow(id: string): Promise<boolean> {
    try {
      const response = await this.request('PATCH', `/api/v1/workflows/${id}`, { active: true });
      return response.ok;
    } catch {
      return false;
    }
  }

  async deactivateWorkflow(id: string): Promise<boolean> {
    try {
      const response = await this.request('PATCH', `/api/v1/workflows/${id}`, { active: false });
      return response.ok;
    } catch {
      return false;
    }
  }

  // ── Webhook Execution ──────────────────────────────────────────────────────

  async triggerWebhook(
    workflowId: string,
    data: Record<string, unknown>
  ): Promise<unknown> {
    const webhookPath = `${N8N.webhookBase}/${workflowId}`;
    const response = await fetch(`${this.config.baseUrl}${webhookPath}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      throw new Error(`Webhook trigger failed: ${response.statusText}`);
    }

    return response.json();
  }

  async triggerByName(
    workflowName: string,
    data: Record<string, unknown>
  ): Promise<unknown> {
    const workflow = this.workflows.find(w => w.name === workflowName);
    if (!workflow) {
      throw new Error(`Workflow "${workflowName}" not found`);
    }
    return this.triggerWebhook(workflow.id, data);
  }

  // ── Built-in JARVIS Workflows ──────────────────────────────────────────────

  async deployWorkflow(
    action: 'test' | 'build' | 'deploy',
    project: string,
    branch: string = 'main'
  ): Promise<unknown> {
    return this.triggerByName('ghostforge-deploy', {
      action,
      project,
      branch,
      timestamp: Date.now(),
    });
  }

  async notifyWorkflow(
    channel: string,
    message: string,
    priority: 'low' | 'medium' | 'high' = 'medium'
  ): Promise<unknown> {
    return this.triggerByName('ghostforge-notify', {
      channel,
      message,
      priority,
      timestamp: Date.now(),
    });
  }

  async prWorkflow(
    action: 'review' | 'merge' | 'comment',
    prNumber: number,
    repo: string,
    comment?: string
  ): Promise<unknown> {
    return this.triggerByName('ghostforge-pr', {
      action,
      prNumber,
      repo,
      comment,
      timestamp: Date.now(),
    });
  }

  // ── HTTP Request Helper ────────────────────────────────────────────────────

  private async request(
    method: string,
    path: string,
    body?: unknown
  ): Promise<Response> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.config.apiKey) {
      headers['X-N8N-API-KEY'] = this.config.apiKey;
    }

    return fetch(`${this.config.baseUrl}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  // ── Status ─────────────────────────────────────────────────────────────────

  getStatus(): {
    connected: boolean;
    url: string;
    workflowCount: number;
    activeWorkflows: number;
  } {
    return {
      connected: false, // updated async
      url: this.config.baseUrl,
      workflowCount: this.workflows.length,
      activeWorkflows: this.workflows.filter(w => w.active).length,
    };
  }

  updateConfig(updates: Partial<N8nConfig>): void {
    this.config = { ...this.config, ...updates };
    this.validateBaseUrl();
  }
}
