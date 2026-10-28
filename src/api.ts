export async function request(path: string, method = 'GET', data?: unknown) {
  const response = await fetch('/api/' + path, {
    method,
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    ...(data !== undefined ? { body: JSON.stringify(data) } : {}),
  });
  const result = await response.json();
  if (!response.ok) {
    if (response.status === 401 && !['auth/login', 'auth/setup'].includes(path)) window.dispatchEvent(new Event('session-expired'));
    throw new Error(result.error || 'Please try again.');
  }
  return result;
}
