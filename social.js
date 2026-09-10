/**
 * NEW: the organiser's channels, on every public screen.
 *
 * A block of links and QR codes placed wherever the organiser asked for it,
 * at the size and in the style they chose. Rendered by one module so the
 * board, the welcome screen and the prize screen cannot drift apart.
 *
 * The marks below are plain category symbols — a camera, a globe, a play
 * button — rather than the platforms' own logos. They say what kind of place
 * a link goes to; the channel's name, which sits beside every one of them,
 * says which.
 */
(function attachSocial(global, document) {
  'use strict';

  const SIZES = { small: 48, medium: 80, large: 128, xl: 180 };

  const CHANNELS = {
    instagram: {
      name: 'Instagram',
      color: '#e1306c',
      icon: '<rect x="3" y="3" width="18" height="18" rx="5" fill="none" stroke="currentColor" stroke-width="2"/>' +
        '<circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" stroke-width="2"/>' +
        '<circle cx="17.2" cy="6.8" r="1.3"/>',
    },
    facebook: {
      name: 'Facebook',
      color: '#1877f2',
      icon: '<rect x="3" y="3" width="18" height="18" rx="5" fill="none" stroke="currentColor" stroke-width="2"/>' +
        '<path d="M14.6 8.4h1.6V5.9h-2.3c-1.9 0-3 1.2-3 3.1v1.6H9v2.5h1.9V21h2.7v-7.9h2l.3-2.5h-2.3V9.3c0-.6.3-.9 1-.9z"/>',
    },
    x: {
      name: 'X',
      color: '#111111',
      icon: '<rect x="3" y="3" width="18" height="18" rx="5" fill="none" stroke="currentColor" stroke-width="2"/>' +
        '<path d="M7.6 7.2h2.2l2.4 3.3 2.7-3.3h1.6l-3.5 4.3 3.8 5.3h-2.2l-2.6-3.6-3 3.6H6.9l3.9-4.7z"/>',
    },
    youtube: {
      name: 'YouTube',
      color: '#ff0000',
      icon: '<rect x="2" y="5" width="20" height="14" rx="4" fill="none" stroke="currentColor" stroke-width="2"/>' +
        '<path d="M10.4 9.2 15.2 12l-4.8 2.8z"/>',
    },
    tiktok: {
      name: 'TikTok',
      color: '#25f4ee',
      icon: '<path d="M14 3h2.2c.2 1.9 1.4 3.2 3.3 3.5v2.3c-1.3 0-2.4-.4-3.3-1v5.9c0 3-2.2 5.3-5.1 5.3S6 16.7 6 13.7c0-2.8 2-5 4.7-5.2v2.4c-1.3.2-2.3 1.3-2.3 2.8 0 1.6 1.2 2.9 2.7 2.9s2.9-1.3 2.9-3z"/>',
    },
    linkedin: {
      name: 'LinkedIn',
      color: '#0a66c2',
      icon: '<rect x="3" y="3" width="18" height="18" rx="4" fill="none" stroke="currentColor" stroke-width="2"/>' +
        '<circle cx="7.6" cy="7.6" r="1.5"/><rect x="6.4" y="10.2" width="2.4" height="7.4"/>' +
        '<path d="M11.3 10.2h2.3v1a2.9 2.9 0 0 1 2.5-1.2c2 0 2.9 1.2 2.9 3.4v4.2h-2.4v-3.8c0-1-.3-1.6-1.2-1.6s-1.7.6-1.7 1.8v3.6h-2.4z"/>',
    },
    whatsapp: {
      name: 'WhatsApp',
      color: '#25d366',
      icon: '<path d="M12 3a9 9 0 0 0-7.7 13.6L3 21l4.5-1.2A9 9 0 1 0 12 3z" fill="none" stroke="currentColor" stroke-width="2"/>' +
        '<path d="M9.4 8.2c.2-.5.4-.5.7-.5h.5c.2 0 .4 0 .6.5l.7 1.7c.1.3 0 .5-.1.7l-.4.5c-.1.2-.3.3-.1.6a7 7 0 0 0 3 2.6c.3.1.5.1.7-.1l.6-.7c.2-.2.4-.2.6-.1l1.6.8c.3.1.4.3.4.5 0 .9-.7 1.7-1.5 1.8-.7.1-1.6.1-4-1.4a9 9 0 0 1-3.4-4c-.4-1-.4-1.9-.1-2.5z"/>',
    },
    telegram: {
      name: 'Telegram',
      color: '#2aabee',
      icon: '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/>' +
        '<path d="M7 12.1 16.4 8l-1.6 8.4-3-2.3-1.6 1.5-.3-2.7z"/>',
    },
    discord: {
      name: 'Discord',
      color: '#5865f2',
      icon: '<path d="M5 17.5c-1.4-3-1.3-6 .3-9.2A11 11 0 0 1 8.8 7l.5.9a13 13 0 0 1 5.4 0l.5-.9c1.2.3 2.4.8 3.5 1.3 1.6 3.2 1.7 6.2.3 9.2-1.3.9-2.7 1.5-4.2 1.8l-.8-1.3a9 9 0 0 1-3.6 0l-.8 1.3c-1.5-.3-2.9-.9-4.2-1.8z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>' +
        '<circle cx="9.4" cy="13.2" r="1.3"/><circle cx="14.6" cy="13.2" r="1.3"/>',
    },
    website: {
      name: 'Website',
      color: '#7c9cff',
      icon: '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/>' +
        '<path d="M3 12h18M12 3c2.6 2.6 2.6 15.4 0 18M12 3c-2.6 2.6-2.6 15.4 0 18" fill="none" stroke="currentColor" stroke-width="1.8"/>',
    },
    custom: {
      name: 'Link',
      color: '#9aa4c4',
      icon: '<path d="M10.3 13.7a4 4 0 0 0 5.7 0l2.6-2.6a4 4 0 0 0-5.7-5.7l-1.3 1.3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' +
        '<path d="M13.7 10.3a4 4 0 0 0-5.7 0l-2.6 2.6a4 4 0 0 0 5.7 5.7l1.3-1.3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
    },
  };

  function channelInfo(type) {
    return CHANNELS[type] || CHANNELS.custom;
  }

  function displayName(channel) {
    return channel.label || channelInfo(channel.type).name;
  }

  function escapeHtml(value) {
    return String(value === null || value === undefined ? '' : value).replace(
      /[&<>"']/g,
      (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]
    );
  }

  /** The ink a code is drawn in, which depends on the chosen style. */
  function qrColor(qr, channel) {
    if (qr.style !== 'colored') return '#0b0d18';
    return qr.color || channelInfo(channel.type).color;
  }

  function qrMarkup(channel, qr) {
    if (!global.pickoraQr) return '';
    try {
      return global.pickoraQr.toSvg(channel.url, {
        style: qr.style,
        color: qrColor(qr, channel),
        background: '#ffffff',
        label: `QR code for ${displayName(channel)}`,
        logo: qr.style === 'logo' ? channelInfo(channel.type).icon : '',
      });
    } catch (_error) {
      // A payload too long for a code is not worth breaking the page over;
      // the link beside it still works.
      return '';
    }
  }

  function channelMarkup(channel, qr) {
    const info = channelInfo(channel.type);
    const name = displayName(channel);
    const showIcon = qr.display !== 'qr';
    const showQr = qr.display !== 'icons';

    return `
      <a class="social-item" href="${escapeHtml(channel.url)}" target="_blank" rel="noopener noreferrer"
         style="--channel-color:${escapeHtml(info.color)}">
        ${showQr ? `<span class="social-qr">${qrMarkup(channel, qr)}</span>` : ''}
        <span class="social-face">
          ${showIcon ? `<span class="social-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="currentColor">${info.icon}</svg></span>` : ''}
          <span class="social-name">${escapeHtml(name)}</span>
        </span>
      </a>`;
  }

  /**
   * Draws the block into `mount`.
   *
   * With nothing configured the block leaves no trace at all — no empty box,
   * no gap where it would have been.
   */
  function renderSocial(mount, settings) {
    const target = typeof mount === 'string' ? document.getElementById(mount) : mount;
    if (!target) return;

    const social = (settings && settings.social) || { channels: [], qr: {} };
    const channels = Array.isArray(social.channels) ? social.channels : [];

    if (channels.length === 0) {
      target.innerHTML = '';
      target.hidden = true;
      return;
    }

    const qr = social.qr || {};
    target.hidden = false;
    target.dataset.position = qr.position || 'bottom-right';
    target.dataset.display = qr.display || 'both';
    target.dataset.style = qr.style || 'standard';
    target.style.setProperty('--qr-size', `${SIZES[qr.size] || SIZES.medium}px`);

    target.innerHTML =
      (social.heading ? `<p class="social-heading">${escapeHtml(social.heading)}</p>` : '') +
      `<div class="social-items">${channels.map((channel) => channelMarkup(channel, qr)).join('')}</div>`;
  }

  global.pickoraSocial = { render: renderSocial, CHANNELS, SIZES, channelInfo, displayName };
})(window, document);
