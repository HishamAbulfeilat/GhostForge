export function normalizeBridgeBaseUrl(baseUrl = 'http://127.0.0.1:4747') {
  return String(baseUrl).trim() || 'http://127.0.0.1:4747';
}

function bridgeUrl(baseUrl, pathname) {
  const normalized = normalizeBridgeBaseUrl(baseUrl).replace(/\/+$/, '');
  return new URL(pathname, `${normalized}/`).toString();
}

export async function fetchBridgeHealth({ baseUrl = 'http://127.0.0.1:4747', token = '' } = {}) {
  const headers = {
    Accept: 'application/json',
    ...(token ? { Authorization: String(token) } : {}),
  };

  const response = await fetch(bridgeUrl(baseUrl, '/health'), { headers });
  if (!response.ok) {
    throw new Error(`Bridge health probe failed with ${response.status}: ${response.statusText}`);
  }
  return response.json();
}

export async function executeBridgeCommand({ baseUrl = 'http://127.0.0.1:4747', token = '', command = '' } = {}) {
  if (!command || !String(command).trim()) {
    throw new Error('A command is required for the bridge client');
  }

  const response = await fetch(bridgeUrl(baseUrl, '/execute'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(token ? { Authorization: String(token) } : {}),
    },
    body: JSON.stringify({ command: String(command) }),
  });

  if (!response.ok) {
    throw new Error(`Bridge execution failed with ${response.status}: ${response.statusText}`);
  }

  return response.json();
}
