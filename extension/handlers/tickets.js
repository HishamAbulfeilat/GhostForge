import { sendChunk, sendDone, sendError } from '../utils/sse.js';

const PRIORITY_ORDER = ['critical', 'high', 'medium', 'low', 'unlabeled'];
const PRIORITY_META = {
  critical: { icon: '🔴', label: 'Critical' },
  high: { icon: '🟠', label: 'High' },
  medium: { icon: '🟡', label: 'Medium' },
  low: { icon: '🟢', label: 'Low' },
  unlabeled: { icon: '⚪', label: 'Unlabeled' },
};

function detectPriority(labels = []) {
  const names = labels.map((label) => label.name.toLowerCase());
  if (names.some((name) => ['critical', 'p0', 'blocker'].includes(name))) return 'critical';
  if (names.some((name) => ['high', 'p1', 'major'].includes(name))) return 'high';
  if (names.some((name) => ['medium', 'p2'].includes(name))) return 'medium';
  if (names.some((name) => ['low', 'p3', 'minor', 'trivial'].includes(name))) return 'low';
  return 'unlabeled';
}

function renderTable(issues) {
  const rows = issues
    .map((issue) => {
      const priority = PRIORITY_META[detectPriority(issue.labels)];
      const title = issue.title.replace(/\|/g, '\\|');
      return `| #${issue.number} | ${title} | ${priority.icon} ${priority.label} | ${issue.html_url} |`;
    })
    .join('\n');

  return `${rows}\n`;
}

export default async function ticketsHandler(args, context, res) {
  try {
    if (!context.owner || !context.repo) {
      sendError(res, 'Repository context is required for `/tickets`. Open the chat from a repository, issue, or pull request.');
      return;
    }

    sendChunk(res, `🎫 **Assigned Tickets for ${context.owner}/${context.repo}**\n\n`);
    sendChunk(res, 'Fetching open issues assigned to you from GitHub Issues...\n\n');

    const response = await context.octokit.request('GET /repos/{owner}/{repo}/issues', {
      owner: context.owner,
      repo: context.repo,
      assignee: '@me',
      state: 'open',
      per_page: 100,
    });

    const issues = response.data.filter((issue) => !issue.pull_request);

    if (!issues.length) {
      sendChunk(res, '✅ No open assigned issues were found.\n\n');
      sendChunk(res, 'Try `@ghostforge /review` for PR help or `@ghostforge /optimize` for proactive improvements.');
      sendDone(res);
      return;
    }

    const isFixMode = /^\/fix-tickets/i.test(context.rawMessage || '');

    const grouped = issues.reduce((acc, issue) => {
      const priority = detectPriority(issue.labels);
      acc[priority] ??= [];
      acc[priority].push(issue);
      return acc;
    }, {});

    for (const key of PRIORITY_ORDER) {
      const bucket = grouped[key];
      if (!bucket?.length) continue;
      const meta = PRIORITY_META[key];
      sendChunk(res, `### ${meta.icon} ${meta.label} (${bucket.length})\n\n`);
      sendChunk(res, '| Issue | Title | Priority | Link |\n|------|-------|----------|------|\n');
      sendChunk(res, renderTable(bucket));
      sendChunk(res, '\n');
    }

    if (args.includes('dry-run')) {
      sendChunk(res, '> 👀 Dry run requested — review the list above and choose a single issue to fix locally with `ghostforge-ai`.\n\n');
    } else if (isFixMode) {
      sendChunk(res, '> 🛠️ Automated ticket fixing should stay local so the existing GhostForge toolkit can inspect your workspace safely.\n\n');
    }

    sendChunk(res, 'Next steps: `@ghostforge /review` for PR context, or run `ghostforge-ai` → **Tickets & Issues** for guided fixes.');
    sendDone(res);
  } catch (error) {
    sendError(res, error?.message || 'Unable to fetch assigned tickets.');
  }
}
