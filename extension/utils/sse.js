export function sendChunk(res, content) {
  const data = JSON.stringify({
    choices: [{ delta: { content, role: 'assistant' }, finish_reason: null }],
  });
  res.write(`data: ${data}\n\n`);
}

export function sendDone(res) {
  const data = JSON.stringify({
    choices: [{ delta: { content: '' }, finish_reason: 'stop' }],
  });
  res.write(`data: ${data}\n\n`);
  res.write('data: [DONE]\n\n');
  res.end();
}

export function sendError(res, message) {
  sendChunk(res, `❌ **Error**: ${message}\n\nTry \`@ghostforge /help\` for available commands.`);
  sendDone(res);
}
