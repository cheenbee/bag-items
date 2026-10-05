let accessToken = '';

export const setAccessToken = token => {
  accessToken = token || '';
};

export const clearAccessToken = () => {
  accessToken = '';
};

// 所有业务页面共用同一套鉴权和令牌刷新逻辑。
export const api = async (path, options = {}, allowRefresh = true) => {
  const headers = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    ...(options.headers || {}),
  };
  const response = await fetch(`/api${path}`, {
    cache: 'no-store',
    credentials: 'include',
    ...options,
    headers,
  });

  if (response.status === 401 && allowRefresh && !path.startsWith('/v1/auth/')) {
    const refresh = await fetch('/api/v1/auth/refresh', {
      method: 'POST',
      credentials: 'include',
      headers: { Accept: 'application/json' },
    });
    if (refresh.ok) {
      const session = await refresh.json();
      setAccessToken(session.accessToken);
      return api(path, options, false);
    }
    window.dispatchEvent(new CustomEvent('bpms-auth-expired'));
  }

  if (!response.ok) {
    const body = await response.text();
    let message = '';
    try {
      message = JSON.parse(body).message || '';
    } catch {
      message = body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    }
    throw new Error(message || `请求失败（HTTP ${response.status}）`);
  }
  return response.status === 204 ? null : response.json();
};
