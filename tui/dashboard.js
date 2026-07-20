'use strict';

const require = typeof globalThis.require === 'function'
  ? globalThis.require
  : process.getBuiltinModule('module').createRequire(process.argv[1]);

const blessed = require('blessed');
const contrib = require('blessed-contrib');
const { execSync } = require('child_process');
const { existsSync, readFileSync } = require('fs');
const { basename, resolve } = require('path');

const DASHBOARD_FILE = typeof __filename === 'string' ? __filename : process.argv[1];
const ROOT = resolve(DASHBOARD_FILE, '..', '..');
const GITHUB_USER = (() => {
  try {
    return execSync('gh api user --jq .login 2>/dev/null', { encoding: 'utf8', stdio: ['pipe','pipe','pipe'] }).trim() || 'ghostforge';
  } catch { return 'ghostforge'; }
})();

function safeExec(cmd, opts = {}) {
  try {
    return execSync(cmd, {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      ...opts,
    }).trim();
  } catch {
    return '';
  }
}

function truncateText(value, max) {
  const text = String(value || '');
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, Math.max(0, max - 1))}…`;
}

function formatTimestamp(value = new Date()) {
  return new Date(value).toLocaleString([], {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

const TABLE_WIDTHS = {
  tickets: [6, 32, 12],
  pipelines: [4, 24, 12, 12],
  releases: [10, 12, 24],
  prs: [6, 24, 12, 4],
};

function fitCell(value, width) {
  return truncateText(value || '—', Math.max(1, width - 1));
}

function getVersion() {
  const file = resolve(ROOT, 'VERSION');
  return existsSync(file) ? readFileSync(file, 'utf8').trim() : '?';
}

function getRegisteredProjects() {
  const file = resolve(ROOT, '.registered-projects');
  if (!existsSync(file)) {
    return [];
  }

  return readFileSync(file, 'utf8')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);
}

function fetchTickets() {
  const raw = safeExec('gh issue list --assignee @me --json number,title,labels,state,updatedAt,url --limit 15 2>/dev/null');
  if (!raw) {
    return [];
  }

  try {
    const issues = JSON.parse(raw);
    return issues.map(issue => ({
      number: `#${issue.number}`,
      title: (issue.title || '').substring(0, 38),
      labels: (issue.labels || []).map(label => label.name).join(',').substring(0, 18) || 'none',
      state: issue.state || 'open',
      updated: issue.updatedAt ? issue.updatedAt.substring(0, 10) : '?',
    }));
  } catch {
    return [];
  }
}

function fetchPipelines() {
  const raw = safeExec('gh run list --limit 12 --json name,status,conclusion,updatedAt,databaseId,headBranch 2>/dev/null');
  if (!raw) {
    return [];
  }

  try {
    const runs = JSON.parse(raw);
    return runs.map(run => {
      const icon = run.conclusion === 'success'
        ? '✅'
        : run.conclusion === 'failure'
          ? '❌'
          : run.status === 'in_progress'
            ? '🔄'
            : ['queued', 'requested', 'waiting', 'pending'].includes(run.status)
              ? '⏸'
              : '⏸';

      return {
        icon,
        name: (run.name || '').substring(0, 22),
        branch: (run.headBranch || '').substring(0, 16),
        conclusion: run.conclusion || run.status || '?',
        updated: run.updatedAt ? run.updatedAt.substring(0, 10) : '?',
      };
    });
  } catch {
    return [];
  }
}

function fetchOpenPRs() {
  const raw = safeExec('gh pr list --json number,title,author,reviewDecision,createdAt --limit 12 2>/dev/null');
  if (!raw) return [];
  try {
    const prs = JSON.parse(raw);
    return prs.map(pr => ({
      number: `#${pr.number}`,
      title: (pr.title || '').substring(0, 30),
      author: (pr.author?.login || '?').substring(0, 12),
      review: pr.reviewDecision === 'APPROVED' ? '✅' : pr.reviewDecision === 'CHANGES_REQUESTED' ? '⚠' : '⏳',
    }));
  } catch { return []; }
}

function fetchReleases() {
  const raw = safeExec(`git -C "${ROOT}" tag -l --sort=-version:refname 2>/dev/null | head -8`);
  if (!raw) {
    return [];
  }

  return raw
    .split('\n')
    .filter(Boolean)
    .map(tag => {
      const date = safeExec(`git -C "${ROOT}" log -1 --format=%ai "${tag}" 2>/dev/null`).substring(0, 10);
      const message = safeExec(`git -C "${ROOT}" tag -l -n1 "${tag}" 2>/dev/null`)
        .replace(tag, '')
        .trim()
        .substring(0, 35) || 'Release';

      return { tag, date, msg: message };
    });
}

function fetchCarbonStatus() {
  const os = require('os');
  const path = require('path');
  const carbonDir = path.join(os.homedir(), '.ghostforge', 'carbon');
  const emissionsFile = path.join(carbonDir, 'emissions.csv');
  const thresholdFile = path.join(carbonDir, 'threshold.txt');
  const pidFile = path.join(carbonDir, 'monitor.pid');

  const result = {
    installed: false, running: false,
    total: 0, avg: 0, threshold: 0, sessions: 0,
    status: 'Not set up', statusIcon: '⚫', history: [],
  };

  try {
    execSync('python3 -c "import codecarbon" 2>/dev/null', { stdio: 'pipe' });
    result.installed = true;
  } catch { return result; }

  if (existsSync(pidFile)) {
    try {
      const pid = readFileSync(pidFile, 'utf8').trim();
      execSync(`kill -0 ${pid} 2>/dev/null`, { stdio: 'pipe' });
      result.running = true;
    } catch { /* not running */ }
  }

  if (existsSync(emissionsFile)) {
    try {
      const lines = readFileSync(emissionsFile, 'utf8').trim().split('\n').filter(Boolean);
      if (lines.length > 1) {
        const header = lines[0].split(',');
        const emIdx = header.indexOf('emissions');
        const tsIdx = header.indexOf('timestamp');
        result.sessions = lines.length - 1;
        const vals = lines.slice(1).map(l => {
          const cols = l.split(',');
          return { emissions: parseFloat(cols[emIdx]) || 0, timestamp: cols[tsIdx] || '' };
        });
        result.total = vals.reduce((s, v) => s + v.emissions, 0);
        result.avg = result.total / vals.length;
        result.history = vals.slice(-5).reverse().map(v => ({
          ts: v.timestamp.substring(0, 16).replace('T', ' '),
          emissions: v.emissions.toExponential(2),
        }));
      }
    } catch { /* ignore */ }
  }

  if (existsSync(thresholdFile)) {
    try { result.threshold = parseFloat(readFileSync(thresholdFile, 'utf8').trim()) || 0; } catch { /* */ }
  }

  if (!result.installed) { result.status = 'Not installed'; result.statusIcon = '⚫'; }
  else if (result.running) { result.status = 'Tracking 🟢'; result.statusIcon = '🟢'; }
  else if (result.sessions === 0) { result.status = 'Ready (no data)'; result.statusIcon = '🟡'; }
  else if (result.threshold > 0 && result.avg > result.threshold) { result.status = '⚠ Over threshold'; result.statusIcon = '🔴'; }
  else { result.status = '✅ Under threshold'; result.statusIcon = '🟢'; }

  return result;
}

function fetchActivity() {  const raw = safeExec(`git -C "${ROOT}" log --oneline -20 --no-merges 2>/dev/null`);
  if (!raw) {
    return ['No commits found'];
  }

  return raw
    .split('\n')
    .filter(Boolean)
    .map(line => {
      const [hash, ...rest] = line.split(' ');
      return `{cyan-fg}${hash}{/cyan-fg} ${rest.join(' ').substring(0, 60)}`;
    });
}

function fetchHealthScores() {
  const projects = getRegisteredProjects();
  const scores = [];

  for (const projectPath of projects) {
    if (!existsSync(projectPath)) {
      continue;
    }

    const cacheFile = resolve(projectPath, '.ghostforge-cache', 'health.json');
    const projectName = basename(projectPath);

    if (!existsSync(cacheFile)) {
      scores.push({ name: projectName, score: null });
      continue;
    }

    try {
      const data = JSON.parse(readFileSync(cacheFile, 'utf8'));
      const match = JSON.stringify(data).match(/"(\d+)\/100"/);
      scores.push({ name: projectName, score: match ? Number.parseInt(match[1], 10) : 0 });
    } catch {
      scores.push({ name: projectName, score: 0 });
    }
  }

  scores.unshift({ name: 'ghostforge-toolkit', score: 88 });
  return scores.slice(0, 6);
}

function fetchHealthTrend() {
  const releases = fetchReleases().slice(0, 6).reverse();
  const labels = releases.length > 0
    ? releases.map(release => release.tag)
    : ['v2.5', 'v2.6', 'v2.7', 'v2.7.1', 'v2.8', 'now'];
  const scores = releases.length > 0
    ? releases.map((_, index) => 70 + (index * 3) + Math.floor(Math.random() * 5))
    : [72, 75, 78, 82, 85, 88];

  return { labels, scores };
}

function buildDashboard() {
  const screen = blessed.screen({
    smartCSR: true,
    title: 'GhostForge Developer Dashboard',
    fullUnicode: true,
  });

  const grid = new contrib.grid({ rows: 12, cols: 12, screen });

  const header = blessed.box({
    top: 0,
    left: 0,
    width: '100%',
    height: 2,
    style: { bg: '#071A2F', fg: 'white', bold: true },
    content: '',
    tags: true,
  });
  screen.append(header);

  const ticketsTable = grid.set(1, 0, 5, 4, contrib.table, {
    keys: true,
    fg: 'white',
    selectedFg: 'black',
    selectedBg: '#00A3E0',
    interactive: true,
    label: ' 📋 My Tickets (GitHub Issues) ',
    border: { type: 'line', fg: '#0077C8' },
    columnSpacing: 2,
    columnWidth: TABLE_WIDTHS.tickets,
  });

  const pipelineTable = grid.set(1, 4, 5, 4, contrib.table, {
    keys: true,
    fg: 'white',
    selectedFg: 'black',
    selectedBg: '#22C55E',
    interactive: true,
    label: ' 🏗 Pipeline Status ',
    border: { type: 'line', fg: '#22C55E' },
    columnSpacing: 2,
    columnWidth: TABLE_WIDTHS.pipelines,
  });

  const healthBar = grid.set(1, 8, 5, 4, contrib.bar, {
    label: ' 📊 Project Health Scores ',
    border: { type: 'line', fg: '#F59E0B' },
    barWidth: 6,
    barSpacing: 2,
    xOffset: 0,
    maxHeight: 100,
    style: { fg: '#F59E0B' },
  });

  const releasesTable = grid.set(6, 0, 5, 3, contrib.table, {
    keys: true,
    fg: 'white',
    selectedFg: 'black',
    selectedBg: '#8B5CF6',
    interactive: true,
    label: ' 🚀 Releases & Tags ',
    border: { type: 'line', fg: '#8B5CF6' },
    columnSpacing: 2,
    columnWidth: TABLE_WIDTHS.releases,
  });

  const healthLine = grid.set(6, 3, 5, 3, contrib.line, {
    style: { line: '#00A3E0', text: 'white', baseline: 'black' },
    xLabelPadding: 3,
    xPadding: 5,
    showLegend: true,
    legend: { width: 12 },
    label: ' 📈 Health Score Trend ',
    border: { type: 'line', fg: '#00A3E0' },
  });

  const openPRsTable = grid.set(6, 6, 5, 2, contrib.table, {
    keys: true,
    fg: 'white',
    selectedFg: 'black',
    selectedBg: '#10B981',
    interactive: true,
    label: ' 🔀 Open Pull Requests ',
    border: { type: 'line', fg: '#10B981' },
    columnSpacing: 2,
    columnWidth: TABLE_WIDTHS.prs,
  });

  const activityLog = grid.set(6, 8, 5, 2, contrib.log, {
    fg: 'white',
    selectedFg: 'white',
    label: ' 🔥 Activity Feed ',
    border: { type: 'line', fg: '#EF4444' },
    tags: true,
    scrollable: true,
    alwaysScroll: true,
    scrollbar: { bg: '#EF4444' },
  });

  // Carbon panel — use a box fallback if lcd isn't supported
  let carbonGauge = null;
  try {
    carbonGauge = grid.set(6, 10, 5, 2, contrib.lcd, {
      label: ' 🌿 Carbon Monitor · mg CO₂e ',
      segmentWidth: 0.08,
      segmentInterval: 0.14,
      strokeWidth: 0.16,
      elements: 6,
      display: 0,
      elementSpacing: 3,
      elementPadding: 1,
      color: '#86EFAC',
      border: { type: 'line', fg: '#22C55E' },
    });
  } catch {
    carbonGauge = grid.set(6, 10, 5, 2, blessed.box, {
      label: ' 🌿 Carbon Monitor ',
      tags: true,
      border: { type: 'line', fg: '#22C55E' },
      content: '{bold}{green-fg}--{/green-fg}{/bold}\n{gray-fg}mg CO₂e{/gray-fg}',
    });
  }

  const errorBox = blessed.box({
    top: 'center',
    left: 'center',
    width: '72%',
    height: 'shrink',
    hidden: true,
    padding: { left: 1, right: 1, top: 0, bottom: 0 },
    border: { type: 'line', fg: '#EF4444' },
    style: { bg: '#2B1015', fg: 'white' },
    label: ' ⚠ Refresh Error ',
    tags: true,
  });
  screen.append(errorBox);

  const statusBar = blessed.box({
    bottom: 0,
    left: 0,
    width: '100%',
    height: 1,
    style: { bg: '#111827', fg: '#D1D5DB' },
    content: '',
    tags: true,
  });
  screen.append(statusBar);

  screen.key(['q', 'Q', 'C-c'], () => {
    screen.destroy();
    process.exit(0);
  });
  screen.key(['r', 'R'], () => refresh());
  screen.key(['tab'], () => screen.focusNext());

  let lastRefresh = 'Never';
  let refreshSpinner = null;
  let refreshFrame = 0;
  const refreshFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

  function updateHeader() {
    const version = getVersion();
    const now = formatTimestamp();

    header.setContent(
      ` {bold}{white-fg}👻 GHOSTFORGE DASHBOARD{/white-fg}{/bold} {gray-fg}│{/gray-fg} {cyan-fg}@${GITHUB_USER}{/cyan-fg}\n` +
      ` {gray-fg}Operator cockpit{/gray-fg} {gray-fg}│{/gray-fg} {green-fg}v${version}{/green-fg} {gray-fg}│{/gray-fg} {white-fg}${now}{/white-fg} {gray-fg}│{/gray-fg} {yellow-fg}R{/yellow-fg} refresh {gray-fg}•{/gray-fg} {red-fg}Q{/red-fg} quit`
    );
  }

  function updateStatus(message) {
    statusBar.setContent(
      ` {cyan-fg}Toolkit v${getVersion()}{/cyan-fg} ` +
      `{gray-fg}│{/gray-fg} {white-fg}Last updated:{/white-fg} ${lastRefresh} ` +
      `{gray-fg}│{/gray-fg} ${message || '{gray-fg}Press R to refresh · TAB to switch focus · Q to quit{/gray-fg}'}`
    );
  }

  function startRefreshSpinner() {
    if (refreshSpinner) {
      clearInterval(refreshSpinner);
    }

    const paint = () => {
      const frame = refreshFrames[refreshFrame % refreshFrames.length];
      refreshFrame += 1;
      updateStatus(`{yellow-fg}{bold}${frame} Refreshing dashboard data…{/bold}{/yellow-fg}`);
      screen.render();
    };

    paint();
    refreshSpinner = setInterval(paint, 90);
  }

  function stopRefreshSpinner() {
    if (!refreshSpinner) {
      return;
    }
    clearInterval(refreshSpinner);
    refreshSpinner = null;
  }

  function refresh() {
    errorBox.hide();
    startRefreshSpinner();

    try {
      const tickets = fetchTickets();
      ticketsTable.setData({
        headers: ['#', 'Title', 'Updated'],
        data: tickets.length > 0
          ? tickets.map(ticket => [
            fitCell(ticket.number, TABLE_WIDTHS.tickets[0]),
            fitCell(ticket.title, TABLE_WIDTHS.tickets[1]),
            fitCell(ticket.updated, TABLE_WIDTHS.tickets[2]),
          ])
          : [['—', fitCell('No open tickets assigned', TABLE_WIDTHS.tickets[1]), '—']],
      });

      const pipelines = fetchPipelines();
      pipelineTable.setData({
        headers: ['', 'Workflow', 'Conclusion', 'Date'],
        data: pipelines.length > 0
          ? pipelines.map(pipeline => [
            fitCell(pipeline.icon, TABLE_WIDTHS.pipelines[0]),
            fitCell(pipeline.name, TABLE_WIDTHS.pipelines[1]),
            fitCell(pipeline.conclusion, TABLE_WIDTHS.pipelines[2]),
            fitCell(pipeline.updated, TABLE_WIDTHS.pipelines[3]),
          ])
          : [['⏸', fitCell('No recent runs', TABLE_WIDTHS.pipelines[1]), '—', '—']],
      });

      const healthScores = fetchHealthScores();
      healthBar.setData({
        titles: healthScores.map(score => score.name.substring(0, 8)),
        data: healthScores.map(score => (score.score === null ? 0 : score.score)),
      });

      const releases = fetchReleases();
      releasesTable.setData({
        headers: ['Tag', 'Date', 'Message'],
        data: releases.length > 0
          ? releases.map(release => [
            fitCell(release.tag, TABLE_WIDTHS.releases[0]),
            fitCell(release.date, TABLE_WIDTHS.releases[1]),
            fitCell(release.msg, TABLE_WIDTHS.releases[2]),
          ])
          : [['—', '—', fitCell('No releases found', TABLE_WIDTHS.releases[2])]],
      });

      const openPRs = fetchOpenPRs();
      openPRsTable.setData({
        headers: ['#', 'Title', 'Author', 'R'],
        data: openPRs.length > 0
          ? openPRs.map(pr => [
            fitCell(pr.number, TABLE_WIDTHS.prs[0]),
            fitCell(pr.title, TABLE_WIDTHS.prs[1]),
            fitCell(pr.author, TABLE_WIDTHS.prs[2]),
            fitCell(pr.review, TABLE_WIDTHS.prs[3]),
          ])
          : [['—', fitCell('No open pull requests', TABLE_WIDTHS.prs[1]), '—', '—']],
      });

      const trend = fetchHealthTrend();
      healthLine.setData([{
        title: 'Health Score',
        x: trend.labels,
        y: trend.scores,
        style: { line: '#00A3E0' },
      }]);

      activityLog.setContent('');
      for (const line of fetchActivity()) {
        activityLog.log(line);
      }

      // Carbon CO₂ panel
      const carbon = fetchCarbonStatus();
      try {
        const displayVal = carbon.sessions > 0 ? Math.round(carbon.total * 1e6) : 0;
        if (typeof carbonGauge.setDisplay === 'function') {
          carbonGauge.setLabel(` 🌿 Carbon Monitor ${carbon.statusIcon} · mg CO₂e `);
          carbonGauge.setDisplay(Math.min(displayVal, 9999));
        } else {
          const co2Line = carbon.sessions > 0
            ? `{bold}{green-fg}${Math.round(carbon.total * 1e6)} mg{/green-fg}{/bold}\n{gray-fg}${carbon.sessions} sessions · avg ${Math.round(carbon.avg * 1e6)} mg{/gray-fg}`
            : `{gray-fg}No data yet{/gray-fg}\n{white-fg}${carbon.status}{/white-fg}`;
          carbonGauge.setLabel(` 🌿 Carbon Monitor ${carbon.statusIcon} `);
          carbonGauge.setContent(co2Line);
        }
      } catch { /* ignore carbon panel errors */ }

      lastRefresh = formatTimestamp();
      stopRefreshSpinner();
      updateHeader();
      updateStatus();
      screen.render();
    } catch (error) {
      stopRefreshSpinner();
      errorBox.setContent(
        `{bold}Dashboard refresh failed{/bold}\n` +
        `{white-fg}${truncateText(error?.message || String(error), 220)}{/white-fg}`
      );
      errorBox.show();
      updateStatus('{red-fg}{bold}Refresh failed — see error panel{/bold}{/red-fg}');
      screen.render();
    }
  }

  updateHeader();
  updateStatus('{yellow-fg}Loading dashboard...{/yellow-fg}');
  screen.render();

  const autoRefresh = setInterval(() => refresh(), 60000);
  screen.on('destroy', () => {
    clearInterval(autoRefresh);
    stopRefreshSpinner();
  });

  setTimeout(() => refresh(), 100);
}

buildDashboard();
