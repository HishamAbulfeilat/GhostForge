import { Octokit } from '@octokit/core';
import { existsSync } from 'fs';
import { resolve } from 'path';
import * as z from 'zod/v4';
import { readModelCache, selectBestModel } from './models.js';

function asToolResult(payload) {
  return {
    content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
    structuredContent: payload
  };
}

function requireGithub(provider, githubToken) {
  if ((provider || 'github').toLowerCase() !== 'github') {
    throw new Error('Only provider=github is supported in this MCP server version.');
  }
  if (!githubToken) {
    throw new Error('GITHUB_TOKEN is required for GitHub ticket tools.');
  }
}

function getPriorityRank(labels) {
  const normalized = labels.map(label => label.toLowerCase());
  if (normalized.some(label => ['critical', 'p0', 'blocker'].includes(label))) return 0;
  if (normalized.some(label => ['high', 'p1', 'major'].includes(label))) return 1;
  if (normalized.some(label => ['medium', 'p2'].includes(label))) return 2;
  return 3;
}

function inferTaskType(issue) {
  const corpus = `${issue.title} ${issue.body ?? ''} ${(issue.labels || []).join(' ')}`.toLowerCase();
  if (/(security|auth|oauth|token|owasp|vulnerability|xss|csrf|sql injection)/.test(corpus)) return 'security';
  if (/(sql|query|report|database|migration|schema)/.test(corpus)) return 'sql';
  if (/(copy|typo|docs|readme|text|label)/.test(corpus)) return 'quick';
  return 'feature';
}

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
}

export function registerTicketTools(server, { repoRoot, githubToken }) {
  server.tool(
    'get_tickets',
    'Fetch GitHub issues assigned to the authenticated user for a repository.',
    {
      provider: z.string().default('github').describe('Ticket provider, currently github only'),
      repo: z.string().describe('Repository name'),
      owner: z.string().describe('Repository owner or organization')
    },
    async ({ provider, repo, owner }) => {
      requireGithub(provider, githubToken);
      const octokit = new Octokit({ auth: githubToken });
      const { data: viewer } = await octokit.request('GET /user');
      const { data } = await octokit.request('GET /repos/{owner}/{repo}/issues', {
        owner,
        repo,
        state: 'open',
        assignee: viewer.login,
        per_page: 100
      });

      const issues = data
        .filter(issue => !issue.pull_request)
        .map(issue => ({
          number: issue.number,
          title: issue.title,
          state: issue.state,
          url: issue.html_url,
          labels: (issue.labels ?? []).map(label => (typeof label === 'string' ? label : label.name)).filter(Boolean),
          updatedAt: issue.updated_at
        }))
        .sort((a, b) => getPriorityRank(a.labels) - getPriorityRank(b.labels));

      return asToolResult({
        assignee: viewer.login,
        owner,
        repo,
        count: issues.length,
        issues
      });
    }
  );

  server.tool(
    'fix_ticket',
    'Fetch a GitHub issue and return a branch name, model recommendation, and fix checklist for Copilot.',
    {
      provider: z.string().default('github').describe('Ticket provider, currently github only'),
      repo: z.string().describe('Repository name'),
      owner: z.string().describe('Repository owner or organization'),
      issueNumber: z.number().int().positive().describe('GitHub issue number'),
      projectPath: z.string().optional().describe('Optional local project path for context checks')
    },
    async ({ provider, repo, owner, issueNumber, projectPath }) => {
      requireGithub(provider, githubToken);
      const octokit = new Octokit({ auth: githubToken });
      const { data } = await octokit.request('GET /repos/{owner}/{repo}/issues/{issue_number}', {
        owner,
        repo,
        issue_number: issueNumber
      });

      const issue = {
        number: data.number,
        title: data.title,
        body: data.body ?? '',
        url: data.html_url,
        labels: (data.labels ?? []).map(label => (typeof label === 'string' ? label : label.name)).filter(Boolean)
      };

      const taskType = inferTaskType(issue);
      const modelCache = readModelCache(repoRoot);
      const recommendation = selectBestModel(modelCache.models, taskType);
      const suggestedBranch = `ticket/${issue.number}-${slugify(issue.title)}`;
      const localProjectPath = projectPath ? resolve(projectPath) : null;

      return asToolResult({
        issue,
        taskType,
        suggestedBranch,
        recommendedModel: recommendation.model,
        effort: recommendation.effort,
        safeModeRecommended: true,
        localContext: {
          checked: Boolean(localProjectPath),
          path: localProjectPath,
          packageJsonFound: localProjectPath ? existsSync(resolve(localProjectPath, 'package.json')) : false
        },
        checklist: [
          'Review the issue description, acceptance criteria, and linked screenshots/logs.',
          'Enable /safe on before code changes if production logic or auth is involved.',
          'Inspect the affected module and identify tests to update first.',
          'Implement the fix in small, verifiable steps.',
          'Run targeted tests after each step, then update docs if behavior changed.',
          'Create a focused commit and reference the issue number in the PR.'
        ]
      });
    }
  );
}
