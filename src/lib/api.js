let refreshPromise = null;

async function tryRefresh() {
  // Deduplicate concurrent refresh calls
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    const res = await fetch('/api/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
    });
    try {
      await res.json();
    } catch {
      throw new Error('Session expired');
    }
    if (!res.ok) throw new Error('Session expired');
    return true;
  })();
  try {
    return await refreshPromise;
  } finally {
    refreshPromise = null;
  }
}

async function request(url, options = {}, retry = true) {
  const isFormData = options.body instanceof FormData;
  const headers = {
    ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
    ...options.headers,
  };
  if (typeof window !== 'undefined' && window.__impersonatedUser?._id) {
    headers['X-Impersonate'] = window.__impersonatedUser._id;
  }
  const res = await fetch(url, { ...options, headers, credentials: 'same-origin' });

  // Auto-refresh on 401 then retry once
  if (res.status === 401 && retry) {
    try {
      await tryRefresh();
      return request(url, options, false);
    } catch {
      // Refresh failed — redirect to login
      if (typeof window !== 'undefined') {
        localStorage.removeItem('hrms_user');
        window.location.replace('/login?reason=expired');
      }
      throw new Error('Session expired');
    }
  }

  let json;
  try {
    json = await res.json();
  } catch {
    throw new Error(`Server error (${res.status})`);
  }
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
  post:   (url, body)  => request(url, { method: 'POST',   body: body instanceof FormData ? body : JSON.stringify(body) }),
  put:    (url, body)  => request(url, { method: 'PUT',    body: body instanceof FormData ? body : JSON.stringify(body) }),
  patch:  (url, body)  => request(url, { method: 'PATCH',  body: body instanceof FormData ? body : JSON.stringify(body) }),
  delete: (url, body)  => request(url, { method: 'DELETE', body: body instanceof FormData ? body : JSON.stringify(body) }),
};
