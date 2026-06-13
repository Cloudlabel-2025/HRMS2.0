import { getToken, getRefreshToken, setToken } from '@/lib/auth';

let refreshPromise = null;

async function tryRefresh() {
  // Deduplicate concurrent refresh calls
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    const refreshToken = getRefreshToken();
    if (!refreshToken) throw new Error('Session expired');
    const res = await fetch('/api/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error('Session expired');
    setToken(json.data.token);
    return json.data.token;
  })();
  try {
    return await refreshPromise;
  } finally {
    refreshPromise = null;
  }
}

async function request(url, options = {}, retry = true) {
  const token = getToken();
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });

  // Auto-refresh on 401 then retry once
  if (res.status === 401 && retry) {
    try {
      await tryRefresh();
      return request(url, options, false);
    } catch {
      // Refresh failed — redirect to login
      if (typeof window !== 'undefined') {
        localStorage.removeItem('hrms_token');
        localStorage.removeItem('hrms_refresh');
        localStorage.removeItem('hrms_user');
        window.location.replace('/login?reason=expired');
      }
      throw new Error('Session expired');
    }
  }

  const json = await res.json();
  if (!res.ok) {
    const message = typeof json.error === 'object'
      ? JSON.stringify(json.error)
      : (json.error || 'Request failed');
    throw new Error(message);
  }
  return json.data;
}

export const api = {
  get:    (url)        => request(url),
  post:   (url, body)  => request(url, { method: 'POST',   body: JSON.stringify(body) }),
  put:    (url, body)  => request(url, { method: 'PUT',    body: JSON.stringify(body) }),
  patch:  (url, body)  => request(url, { method: 'PATCH',  body: JSON.stringify(body) }),
  delete: (url, body)  => request(url, { method: 'DELETE', body: JSON.stringify(body) }),
};
