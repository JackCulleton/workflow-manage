export async function readApiJson(response, actionName) {
  const text = await response.text();
  let data = null;

  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    if (!response.ok) {
      throw new Error(`${actionName} (${response.status}): ${text || 'Invalid server response'}`);
    }
    throw new Error(`Server returned invalid JSON: ${text || 'Invalid server response'}`);
  }

  if (!response.ok) {
    const requestId = (data && data.requestId) || response.headers.get('X-Request-Id');
    const detail = (data && (data.error || data.message)) || text || 'Unknown error';
    throw new Error(`${actionName} (${response.status}): ${detail}${requestId ? ` [request ${requestId}]` : ''}`);
  }

  return data || {};
}
