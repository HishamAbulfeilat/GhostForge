import { sendChunk, sendDone, sendError } from '../utils/sse.js';

function summarizeFiles(files) {
  return files
    .slice(0, 10)
    .map(
      (file) =>
        `| \`${file.filename}\` | ${file.status} | +${file.additions} / -${file.deletions} |`,
    )
    .join('\n');
}

export default async function reviewHandler(args, context, res) {
  try {
    sendChunk(res, '🧑‍💻 **GhostForge Review Assistant**\n\n');

    if (!context.owner || !context.repo) {
      sendChunk(res, 'No repository context was detected, so here is the standard PR checklist.\n\n');
    }

    if (context.owner && context.repo && context.pullNumber) {
      sendChunk(res, `Inspecting pull request #${context.pullNumber} in ${context.owner}/${context.repo}...\n\n`);

      const [prResponse, filesResponse, diffResponse] = await Promise.all([
        context.octokit.request('GET /repos/{owner}/{repo}/pulls/{pull_number}', {
          owner: context.owner,
          repo: context.repo,
          pull_number: context.pullNumber,
        }),
        context.octokit.request('GET /repos/{owner}/{repo}/pulls/{pull_number}/files', {
          owner: context.owner,
          repo: context.repo,
          pull_number: context.pullNumber,
          per_page: 100,
        }),
        context.octokit.request('GET /repos/{owner}/{repo}/pulls/{pull_number}', {
          owner: context.owner,
          repo: context.repo,
          pull_number: context.pullNumber,
          mediaType: { format: 'diff' },
        }),
      ]);

      const pr = prResponse.data;
      const files = filesResponse.data;
      const diffText = typeof diffResponse.data === 'string' ? diffResponse.data : '';
      const riskyFiles = files.filter((file) => /auth|security|payment|config|env/i.test(file.filename));

      sendChunk(res, `### PR Summary\n\n- **Title**: ${pr.title}\n- **State**: ${pr.state}\n- **Files changed**: ${files.length}\n- **Additions / deletions**: +${pr.additions} / -${pr.deletions}\n- **Diff size**: ${diffText.length.toLocaleString()} characters\n\n`);

      if (files.length) {
        sendChunk(res, '| File | Status | Delta |\n|------|--------|-------|\n');
        sendChunk(res, `${summarizeFiles(files)}\n\n`);
      }

      if (riskyFiles.length) {
        sendChunk(res, `> 🟡 Extra review attention suggested for: ${riskyFiles.map((file) => `\`${file.filename}\``).join(', ')}\n\n`);
      }
    }

    sendChunk(res, '### Review checklist\n\n');
    sendChunk(res, '- 🔴 Critical — auth, secrets, or validation regressions\n');
    sendChunk(res, '- 🟡 Warning — performance hotspots, missing tests, or risky dependency changes\n');
    sendChunk(res, '- 🟢 Suggestion — maintainability, DX, or readability improvements\n');
    sendChunk(res, '- ℹ️ Info — rollout, migration, or compatibility notes\n\n');

    sendChunk(res, 'Use `@ghostforge /security` for an OWASP pass, or run local `/review` workflows via `ghostforge-ai` for workspace-aware analysis.');
    sendDone(res);
  } catch (error) {
    sendError(res, error?.message || 'Unable to complete the PR review.');
  }
}
