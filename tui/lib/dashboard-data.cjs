'use strict';

// Data fetchers for tui/dashboard.js. Every external command runs through
// execFileSync with an argument array (no shell), so repository data such as
// tag names can never be expanded as shell syntax, and every call has a
// timeout so a hung `gh` (network, auth prompt) can't freeze the dashboard.

const { execFileSync } = require('child_process');

const EXEC_TIMEOUT_MS = 10000;

function runFile(file, args, opts = {}) {
  try {
    return execFileSync(file, args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: EXEC_TIMEOUT_MS,
      windowsHide: true,
      ...opts,
    }).trim();
  } catch {
    return '';
  }
}

function fetchGithubUser(run = runFile) {
  return run('gh', ['api', 'user', '--jq', '.login']) || 'ghostforge';
}

function parseJson(raw) {
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

function fetchTickets(root, run = runFile) {
  const issues = parseJson(run('gh', ['issue', 'list', '--assignee', '@me', '--json', 'number,title,labels,state,updatedAt,url', '--limit', '15'], { cwd: root }));
  if (!Array.isArray(issues)) return [];
  return issues.map(issue => ({
    number: `#${issue.number}`,
    title: (issue.title || '').substring(0, 38),
    labels: (issue.labels || []).map(label => label.name).join(',').substring(0, 18) || 'none',
    state: issue.state || 'open',
    updated: issue.updatedAt ? issue.updatedAt.substring(0, 10) : '?',
  }));
}

function fetchPipelines(root, run = runFile) {
  const runs = parseJson(run('gh', ['run', 'list', '--limit', '12', '--json', 'name,status,conclusion,updatedAt,databaseId,headBranch'], { cwd: root }));
  if (!Array.isArray(runs)) return [];
  return runs.map(item => {
    const icon = item.conclusion === 'success'
      ? '✅'
      : item.conclusion === 'failure'
        ? '❌'
        : item.status === 'in_progress'
          ? '🔄'
          : '⏸';
    return {
      icon,
      name: (item.name || '').substring(0, 22),
      branch: (item.headBranch || '').substring(0, 16),
      conclusion: item.conclusion || item.status || '?',
      updated: item.updatedAt ? item.updatedAt.substring(0, 10) : '?',
    };
  });
}

function fetchOpenPRs(root, run = runFile) {
  const prs = parseJson(run('gh', ['pr', 'list', '--json', 'number,title,author,reviewDecision,createdAt', '--limit', '12'], { cwd: root }));
  if (!Array.isArray(prs)) return [];
  return prs.map(pr => ({
    number: `#${pr.number}`,
    title: (pr.title || '').substring(0, 30),
    author: (pr.author?.login || '?').substring(0, 12),
    review: pr.reviewDecision === 'APPROVED' ? '✅' : pr.reviewDecision === 'CHANGES_REQUESTED' ? '⚠' : '⏳',
  }));
}

// One for-each-ref call returns name, date and subject for the newest 8 tags,
// so tag names are only ever read, never passed back into a command.
function fetchReleases(root, run = runFile) {
  const raw = run('git', [
    '-C', root,
    'for-each-ref',
    '--sort=-version:refname',
    '--count=8',
    '--format=%(refname:strip=2)%00%(creatordate:short)%00%(contents:subject)',
    'refs/tags',
  ]);
  if (!raw) return [];
  return raw
    .split('\n')
    .filter(Boolean)
    .map(line => {
      const [tag, date = '', subject = ''] = line.split('\0');
      return { tag, date: date.substring(0, 10), msg: subject.trim().substring(0, 35) || 'Release' };
    });
}

function fetchActivity(root, run = runFile) {
  const raw = run('git', ['-C', root, 'log', '--oneline', '-20', '--no-merges']);
  if (!raw) return ['No commits found'];
  return raw
    .split('\n')
    .filter(Boolean)
    .map(line => {
      const [hash, ...rest] = line.split(' ');
      return `{cyan-fg}${hash}{/cyan-fg} ${rest.join(' ').substring(0, 60)}`;
    });
}

function hasCodecarbon(run = runFile) {
  return run('python3', ['-c', 'import codecarbon; print("ok")']) === 'ok';
}

// The PID comes from ~/.ghostforge/carbon/monitor.pid: accept digits only and
// probe it with process.kill(pid, 0) rather than a shell command.
function isPidRunning(pidText) {
  const text = String(pidText ?? '').trim();
  if (!/^\d+$/.test(text)) return false;
  const pid = Number(text);
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

module.exports = {
  EXEC_TIMEOUT_MS,
  runFile,
  fetchGithubUser,
  fetchTickets,
  fetchPipelines,
  fetchOpenPRs,
  fetchReleases,
  fetchActivity,
  hasCodecarbon,
  isPidRunning,
};
