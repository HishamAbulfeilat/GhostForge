import { sendChunk, sendDone, sendError } from '../utils/sse.js';

async function getRepositorySnapshot(context) {
  if (!context.owner || !context.repo) {
    return null;
  }

  const [repoResponse, workflowsResponse] = await Promise.allSettled([
    context.octokit.request('GET /repos/{owner}/{repo}', {
      owner: context.owner,
      repo: context.repo,
    }),
    context.octokit.request('GET /repos/{owner}/{repo}/contents/{path}', {
      owner: context.owner,
      repo: context.repo,
      path: '.github/workflows',
    }),
  ]);

  return {
    repo: repoResponse.status === 'fulfilled' ? repoResponse.value.data : null,
    hasWorkflows:
      workflowsResponse.status === 'fulfilled' && Array.isArray(workflowsResponse.value.data)
        ? workflowsResponse.value.data.length > 0
        : false,
  };
}

export default async function healthHandler(args, context, res) {
  try {
    sendChunk(res, '💊 **GhostForge Health Check**\n\n');
    sendChunk(res, 'Running a lightweight repository assessment for Copilot Chat.\n\n');

    const snapshot = await getRepositorySnapshot(context);

    if (context.owner && context.repo) {
      sendChunk(res, `📦 **Repository**: ${context.owner}/${context.repo}\n\n`);
    } else {
      sendChunk(res, 'ℹ️ No repository context was detected, so this is a generic health checklist.\n\n');
    }

    if (snapshot?.repo) {
      const repo = snapshot.repo;
      sendChunk(
        res,
        `- **Default branch**: \`${repo.default_branch}\`\n- **Open issues**: ${repo.open_issues_count ?? 'n/a'}\n- **Primary language**: ${repo.language || 'Unknown'}\n- **CI workflows detected**: ${snapshot.hasWorkflows ? 'Yes' : 'No'}\n\n`,
      );
    }

    sendChunk(res, '### Health Checklist\n\n');
    sendChunk(res, '| Category | Status | Action |\n|----------|--------|--------|\n');
    sendChunk(res, '| 🔒 Security | Review dependencies and policies | `@ghostforge /security` |\n');
    sendChunk(res, '| 📦 Dependencies | Inspect drift and bundle impact | `@ghostforge /optimize --deps` |\n');
    sendChunk(res, '| 🧪 Tests | Verify unit/E2E coverage locally | `ghostforge-ai` → Run Tests |\n');
    sendChunk(res, '| 📝 Lint & quality | Run linting and error review locally | `ghostforge-ai` → Project Health Check |\n\n');

    if (args.includes('--fix')) {
      sendChunk(
        res,
        '> ⚠️ The hosted extension reports guidance only. For safe automated fixes, run `ghostforge-ai --command health --fix` locally.\n\n',
      );
    }

    sendChunk(
      res,
      '> 💡 **Tip**: Run `ghostforge-ai` locally for the full weighted scorecard with `npm audit`, dependency drift, tests, bundle analysis, and lint metrics.\n',
    );
    sendDone(res);
  } catch (error) {
    sendError(res, error?.message || 'Unable to complete the health check.');
  }
}
