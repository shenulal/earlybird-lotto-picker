/**
 * Thin client over the lottery API. Every call returns the parsed body and
 * throws an Error carrying the server's own message, so callers can surface
 * something meaningful instead of a generic failure.
 */
(function attachApi(global) {
  'use strict';

  async function request(path, options) {
    const config = {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
      ...options,
    };

    if (config.body !== undefined && typeof config.body !== 'string') {
      config.headers = { ...config.headers, 'Content-Type': 'application/json' };
      config.body = JSON.stringify(config.body);
    }

    let response;
    try {
      response = await fetch(path, config);
    } catch (networkError) {
      throw new Error('Cannot reach the server. Check the connection and try again.');
    }

    const isJson = (response.headers.get('content-type') || '').includes('application/json');
    const payload = isJson ? await response.json().catch(() => ({})) : {};

    if (!response.ok) {
      const error = new Error(payload.error || payload.message || `Request failed (${response.status})`);
      error.status = response.status;
      error.payload = payload;
      throw error;
    }

    return payload;
  }

  global.lotteryApi = {
    getSettings: () => request('/api/settings'),
    getPool: () => request('/api/pool'),
    getState: () => request('/api/state'),
    drawWinner: () => request('/api/draw', { method: 'POST', body: {} }),
    resetFromBoard: () => request('/api/draw/reset', { method: 'POST', body: {} }),

    getSession: () => request('/api/auth/session'),
    login: (username, password) => request('/api/auth/login', { method: 'POST', body: { username, password } }),
    logout: () => request('/api/auth/logout', { method: 'POST', body: {} }),

    getOverview: () => request('/api/admin/overview'),
    saveSettings: (appSettings) => request('/api/admin/settings', { method: 'PUT', body: { appSettings } }),
    changePassword: (payload) => request('/api/admin/password', { method: 'POST', body: payload }),
    fetchSheet: (url) => request('/api/admin/tickets/sheet', { method: 'POST', body: { url } }),
    previewTickets: (payload) => request('/api/admin/tickets/preview', { method: 'POST', body: payload }),
    uploadTickets: (payload) => request('/api/admin/tickets', { method: 'POST', body: payload }),
    clearTickets: (force) => request('/api/admin/tickets', { method: 'DELETE', body: { force: Boolean(force) } }),
    uploadAsset: (kind, payload) => request(`/api/admin/assets/${kind}`, { method: 'POST', body: payload }),
    deleteAsset: (kind) => request(`/api/admin/assets/${kind}`, { method: 'DELETE' }),
    addWelcomeImage: (payload) => request('/api/admin/welcome/images', { method: 'POST', body: payload }),
    removeWelcomeImage: (src) => request('/api/admin/welcome/images', { method: 'DELETE', body: { src } }),
    addPrizeImage: (id, payload) => request(`/api/admin/prizes/${encodeURIComponent(id)}/images`, { method: 'POST', body: payload }),
    removePrizeImage: (id, src) => request(`/api/admin/prizes/${encodeURIComponent(id)}/images`, { method: 'DELETE', body: { src } }),
    undoLastDraw: () => request('/api/admin/draw/undo', { method: 'POST', body: {} }),
    resetDraw: () => request('/api/admin/draw/reset', { method: 'POST', body: {} }),
    winnersCsvUrl: '/api/admin/export/winners.csv',
  };
})(window);
