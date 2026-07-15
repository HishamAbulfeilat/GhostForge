import express from 'express';
import dotenv from 'dotenv';
import { Octokit } from '@octokit/core';
import { route } from './handlers/router.js';
import { sendChunk, sendDone, sendError } from './utils/sse.js';

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT || 3000);
const VERSION = '1.0.0';
const NAME = '@ghostforge';

app.use(express.json({ limit: '1mb' }));

function normalizeMessageContent(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (typeof part?.text === 'string') return part.text;
        if (typeof part?.content === 'string') return part.content;
        return '';
      })
      .join('\n')
      .trim();
  }
  if (typeof content?.text === 'string') return content.text;
  if (typeof content?.content === 'string') return content.content;
  return '';
}

function parseCommand(messages = []) {
  const lastUserMessage = messages.filter((message) => message?.role === 'user').pop();
  const text = normalizeMessageContent(lastUserMessage?.content || '');
  const match = text.match(/^\/(\w[\w-]*)(.*)?/);
  if (match) {
    return {
      command: match[1].toLowerCase(),
      args: match[2]?.trim() || '',
      raw: text,
    };
  }
  return { command: 'chat', args: text, raw: text };
}

function collectReferenceCandidates(body = {}) {
  const refs = [
    body.repository?.full_name,
    body.repository?.html_url,
    body.repository?.url,
    body.context?.repository?.full_name,
    body.context?.repository?.html_url,
    body.repo,
  ];

  const referenceArrays = [body.references, body.copilot_references, body.context?.references].filter(Array.isArray);
  for (const referenceArray of referenceArrays) {
    for (const ref of referenceArray) {
      refs.push(ref?.full_name, ref?.repository, ref?.url, ref?.html_url, ref?.id);
    }
  }

  return refs.filter(Boolean);
}

function parseOwnerRepo(candidate) {
  if (!candidate || typeof candidate !== 'string') return null;
  if (/^[\w.-]+\/[\w.-]+$/.test(candidate)) {
    const [owner, repo] = candidate.split('/');
    return { owner, repo: repo.replace(/\.git$/, '') };
  }

  const match = candidate.match(/github\.com[:/]([^/\s]+)\/([^/\s#?]+?)(?:\.git)?(?:\/|$)/i);
  if (!match) return null;
  return { owner: match[1], repo: match[2] };
}

function extractRepoContext(body = {}) {
  const direct = body.repository?.full_name ? parseOwnerRepo(body.repository.full_name) : null;
  if (direct) return direct;

  for (const candidate of collectReferenceCandidates(body)) {
    const parsed = parseOwnerRepo(candidate);
    if (parsed) return parsed;
  }

  return {
    owner: body.repository?.owner?.login || body.repository?.owner?.name || null,
    repo: body.repository?.name || body.context?.repository?.name || null,
  };
}

function extractPullNumber(body = {}) {
  const direct = body.pull_request?.number || body.context?.pull_request?.number;
  if (direct) return Number(direct);

  for (const candidate of collectReferenceCandidates(body)) {
    if (typeof candidate !== 'string') continue;
    const match = candidate.match(/\/pull\/(\d+)/i);
    if (match) return Number(match[1]);
  }

  return null;
}

function createOctokit(token) {
  return new Octokit({ auth: token });
}

function ensureAllowedOrg(owner) {
  const allowedOrg = process.env.ALLOWED_ORG?.trim();
  if (!allowedOrg || !owner) return true;
  return owner.toLowerCase() === allowedOrg.toLowerCase();
}

function initializeSse(res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();
}

app.get('/', (_req, res) => {
  res.json({ status: 'ok', version: VERSION, name: NAME });
});

app.post('/', async (req, res) => {
  initializeSse(res);

  const token = req.header('X-GitHub-Token');
  if (!token) {
    sendError(res, 'Missing `X-GitHub-Token` header.');
    return;
  }

  try {
    const { command, args, raw } = parseCommand(req.body?.messages || []);
    const { owner, repo } = extractRepoContext(req.body);
    const pullNumber = extractPullNumber(req.body);

    if (!ensureAllowedOrg(owner)) {
      sendError(res, `This extension is restricted to the \`${process.env.ALLOWED_ORG}\` organization.`);
      return;
    }

    const context = {
      token,
      octokit: createOctokit(token),
      owner,
      repo,
      pullNumber,
      rawMessage: raw,
      requestBody: req.body,
    };

    sendChunk(res, `🤖 **${NAME}** received \`/${command}\`.\n\n`);
    await route(command, args, context, res);
  } catch (error) {
    sendError(res, error?.message || 'Unexpected extension error.');
  }
});

app.use((error, _req, res, _next) => {
  if (res.headersSent) {
    res.end();
    return;
  }

  if (error instanceof SyntaxError) {
    res.status(400).json({ error: 'Invalid JSON payload.' });
    return;
  }

  res.status(500).json({ error: 'Internal server error.' });
});

if (process.env.VERCEL !== '1') {
  app.listen(PORT, () => {
    console.log(`${NAME} extension listening on port ${PORT}`);
  });
}

export default app;
