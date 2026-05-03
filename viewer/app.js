const DEFAULT_API_BASE = 'https://mail.berich.xyz';
const DEFAULT_API_KEY = 'bcbdda72f675614a8e2b7d2f6747ee750d84519b67d0a9ba6be712364c8985be';

const state = {
  mailboxes: [],
  selectedMailbox: 'all',
  messages: [],
  selectedMessageId: '',
  refreshTimer: null,
  isRefreshing: false,
  filters: {
    sender: '',
    keyword: '',
    limit: 50
  }
};

const nodes = {
  statusText: document.querySelector('#statusText'),
  apiBaseInput: document.querySelector('#apiBaseInput'),
  apiKeyInput: document.querySelector('#apiKeyInput'),
  senderInput: document.querySelector('#senderInput'),
  keywordInput: document.querySelector('#keywordInput'),
  limitInput: document.querySelector('#limitInput'),
  autoRefreshInput: document.querySelector('#autoRefreshInput'),
  searchForm: document.querySelector('#searchForm'),
  refreshButton: document.querySelector('#refreshButton'),
  mailboxList: document.querySelector('#mailboxList'),
  messageTitle: document.querySelector('#messageTitle'),
  messageCount: document.querySelector('#messageCount'),
  messageList: document.querySelector('#messageList'),
  messageDetail: document.querySelector('#messageDetail'),
  toast: document.querySelector('#toast')
};

nodes.apiBaseInput.value = localStorage.getItem('automail.apiBase') || DEFAULT_API_BASE;
nodes.apiKeyInput.value = localStorage.getItem('automail.apiKey') || DEFAULT_API_KEY;

function setStatus(message, isError = false) {
  nodes.statusText.textContent = message;
  nodes.statusText.classList.toggle('error', isError);
}

function showToast(message) {
  window.clearTimeout(showToast.timer);
  nodes.toast.textContent = message;
  nodes.toast.classList.add('show');
  showToast.timer = window.setTimeout(() => {
    nodes.toast.classList.remove('show');
  }, 1500);
}

async function copyText(value) {
  const text = String(value || '').trim();

  if (!text || text === 'all') {
    return;
  }

  await navigator.clipboard.writeText(text);
  setStatus(`Copied ${text}`);
  showToast(`Copied ${text}`);
}

function apiBase() {
  return nodes.apiBaseInput.value.replace(/\/+$/, '');
}

function apiKey() {
  return nodes.apiKeyInput.value.trim();
}

async function request(path) {
  const response = await fetch(`${apiBase()}${path}`, {
    headers: {
      'x-api-key': apiKey()
    }
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`${response.status} ${text}`);
  }

  return response.json();
}

function formatAddressList(value) {
  if (!Array.isArray(value)) {
    return '';
  }

  return value.map((item) => item.name ? `${item.name} <${item.address}>` : item.address).join(', ');
}

function formatAddressChips(value) {
  if (!Array.isArray(value) || value.length === 0) {
    return '';
  }

  return value.map((item) => {
    const address = item.address || '';
    const label = item.name ? `${item.name} <${address}>` : address;
    return `<span class="copy-email" data-copy="${escapeHtml(address)}" title="Click to copy">${escapeHtml(label)}</span>`;
  }).join(', ');
}

function formatTime(value) {
  if (!value) {
    return '-';
  }

  return new Intl.DateTimeFormat('en', {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(new Date(value));
}

function fullTime(value) {
  if (!value) {
    return '-';
  }

  return new Intl.DateTimeFormat('en', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).format(new Date(value));
}

function stripHtml(value) {
  const template = document.createElement('template');
  template.innerHTML = value || '';
  return template.content.textContent || '';
}

function extractHtmlLinks(value) {
  const template = document.createElement('template');
  template.innerHTML = value || '';
  return [...template.content.querySelectorAll('a[href^="http://"], a[href^="https://"]')]
    .filter((anchor) => anchor.textContent.trim())
    .map((anchor) => anchor.href);
}

function extractStructuredItems(message) {
  if (message.structuredData?.items?.length) {
    return message.structuredData.items
      .filter((item) => item?.type !== 'link' || !isIgnoredResourceLink(item.value))
      .map((item) => ({
        label: item.label || (item.type === 'link' ? 'Link' : 'Verification code'),
        value: item.value,
        type: item.type || 'unknown'
      }));
  }

  const source = [
    message.subject,
    message.text,
    stripHtml(message.html),
    ...extractHtmlLinks(message.html)
  ].filter(Boolean).join('\n');
  const codes = new Set();
  const links = new Set();
  const codePattern = /(?<!\d)\d{6}(?!\d)/g;
  const linkPattern = /\bhttps?:\/\/[^\s<>"')\]]+/gi;

  for (const match of source.matchAll(codePattern)) {
    codes.add(match[0]);
  }

  for (const match of source.matchAll(linkPattern)) {
    const link = match[0].replace(/[.,;:!?]+$/, '');
    if (!isIgnoredResourceLink(link)) {
      links.add(link);
    }
  }

  return [
    ...[...codes].map((value) => ({
      label: 'Verification code',
      value,
      type: 'verification_code'
    })),
    ...[...links].map((value) => ({
      label: 'Link',
      value,
      type: 'link'
    }))
  ];
}

const ignoredResourceExtensionPattern = /\.(?:avif|bmp|gif|ico|jpe?g|png|svg|webp|woff2?|ttf|otf|eot|css|js|mjs|map|wasm|webmanifest|manifest)(?:$|[?#])/i;
const ignoredResourceHosts = new Set([
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'p.typekit.net',
  'use.typekit.net'
]);

function isSendGridHost(hostname) {
  return hostname === 'sendgrid.net' || hostname.endsWith('.sendgrid.net');
}

function isIgnoredResourceLink(value = '') {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    const pathname = url.pathname.toLowerCase();
    return (
      ignoredResourceHosts.has(hostname) ||
      ignoredResourceExtensionPattern.test(pathname) ||
      (isSendGridHost(hostname) && /^\/wf\/open(?:$|[/?#])/.test(pathname))
    );
  } catch {
    return ignoredResourceExtensionPattern.test(String(value));
  }
}

function renderMailboxes() {
  const items = [
    { email: 'all', label: 'All', count: state.messages.length },
    ...state.mailboxes.map((email) => ({ email, label: email, count: '' }))
  ];

  nodes.mailboxList.replaceChildren(...items.map((item) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `mailbox-item${state.selectedMailbox === item.email ? ' active' : ''}`;
    button.innerHTML = `
      <span class="${item.email === 'all' ? '' : 'copy-email'}" data-copy="${escapeHtml(item.email)}" title="Click to copy">${escapeHtml(item.label)}</span>
      <span class="mailbox-count">${item.count}</span>
    `;
    const copyTarget = button.querySelector('[data-copy]');
    if (copyTarget && item.email !== 'all') {
      copyTarget.addEventListener('click', (event) => {
        event.stopPropagation();
        copyText(item.email);
      });
    }
    button.addEventListener('click', () => {
      state.selectedMailbox = item.email;
      state.selectedMessageId = '';
      renderMailboxes();
      loadMessages();
    });
    return button;
  }));
}

function renderMessages() {
  const title = state.selectedMailbox === 'all' ? 'All Mail' : state.selectedMailbox;
  nodes.messageTitle.textContent = title;
  nodes.messageCount.textContent = `${state.messages.length} shown`;

  if (state.messages.length === 0) {
    nodes.messageList.innerHTML = '<div class="detail-inner empty"><p>No messages found.</p></div>';
    renderEmptyDetail();
    return;
  }

  nodes.messageList.replaceChildren(...state.messages.map((message) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `message-item${state.selectedMessageId === message.id ? ' active' : ''}`;
    button.innerHTML = `
      <div class="message-meta">
        <span class="copy-email" data-copy="${escapeHtml(message.mailbox)}" title="Click to copy">${escapeHtml(message.mailbox)}</span>
        <time>${formatTime(message.storedAt)}</time>
      </div>
      <div class="message-subject">${message.subject || '(no subject)'}</div>
      <div class="message-meta">
        <span>${formatAddressChips(message.from)}</span>
      </div>
      <div class="message-preview">${message.textPreview || ''}</div>
    `;
    button.querySelectorAll('[data-copy]').forEach((item) => {
      item.addEventListener('click', (event) => {
        event.stopPropagation();
        copyText(item.dataset.copy);
      });
    });
    button.addEventListener('click', () => {
      state.selectedMessageId = message.id;
      renderMessages();
      loadMessageDetail(message);
    });
    return button;
  }));
}

function renderEmptyDetail() {
  nodes.messageDetail.className = 'detail-inner empty';
  nodes.messageDetail.innerHTML = '<p>Select a message to inspect it.</p>';
}

function renderMessageDetail(message) {
  const structuredItems = extractStructuredItems(message);
  const structuredHtml = structuredItems.length > 0
    ? `
      <section class="extracted">
        ${structuredItems.map((item) => `
          <div class="extract-item ${item.type === 'link' ? 'link-item' : ''}">
            <button class="extract-copy" type="button" data-copy="${escapeHtml(item.value)}">
              <span>${escapeHtml(item.label)}</span>
              <strong>${escapeHtml(item.value)}</strong>
            </button>
            ${item.type === 'link' ? `<a class="extract-open" href="${escapeAttribute(item.value)}" target="_blank" rel="noopener noreferrer">Open</a>` : ''}
          </div>
        `).join('')}
      </section>
    `
    : '';

  nodes.messageDetail.className = 'detail-inner';
  nodes.messageDetail.innerHTML = `
    <h2 class="detail-title">${message.subject || '(no subject)'}</h2>
    ${structuredHtml}
    <div class="detail-grid">
      <strong>Mailbox</strong><span>${message.mailbox}</span>
      <strong>From</strong><span>${formatAddressChips(message.from)}</span>
      <strong>To</strong><span>${formatAddressChips(message.to)}</span>
      <strong>Stored</strong><span>${fullTime(message.storedAt)}</span>
      <strong>Date</strong><span>${fullTime(message.date)}</span>
    </div>
    ${message.html ? `<iframe class="html-frame" sandbox srcdoc="${escapeAttribute(message.html)}"></iframe>` : `<div class="mail-body">${escapeHtml(message.text || '')}</div>`}
  `;
  nodes.messageDetail.querySelectorAll('[data-copy]').forEach((item) => {
    item.addEventListener('click', (event) => {
      event.preventDefault();
      copyText(item.dataset.copy);
    });
  });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function escapeAttribute(value) {
  return escapeHtml(value);
}

function buildMessageQuery() {
  const params = new URLSearchParams({
    mailbox: state.selectedMailbox,
    limit: String(state.filters.limit)
  });

  if (state.filters.sender) {
    params.set('sender', state.filters.sender);
  }

  if (state.filters.keyword) {
    params.set('keyword', state.filters.keyword);
  }

  return params.toString();
}

async function loadMailboxes() {
  const data = await request('/mailboxes');
  state.mailboxes = data.mailboxes || [];
  renderMailboxes();
}

async function loadMessages() {
  setStatus('Loading messages...');
  const previousSelectedId = state.selectedMessageId;
  const data = await request(`/messages?${buildMessageQuery()}`);
  state.messages = data.messages || [];
  renderMailboxes();
  renderMessages();

  const stillSelected = state.messages.find((message) => message.id === previousSelectedId);
  const nextSelected = stillSelected || state.messages[0];

  if (nextSelected) {
    state.selectedMessageId = nextSelected.id;
    renderMessages();
    if (!stillSelected || !nodes.messageDetail.dataset.messageId) {
      await loadMessageDetail(nextSelected);
    }
  } else {
    state.selectedMessageId = '';
  }

  setStatus(`Loaded ${state.messages.length} messages${nodes.autoRefreshInput.checked ? ' • auto 5s' : ''}`);
}

async function loadMessageDetail(summary) {
  setStatus('Loading detail...');
  const params = new URLSearchParams({
    mailbox: summary.mailbox
  });
  const message = await request(`/messages/${summary.id}?${params.toString()}`);
  renderMessageDetail(message);
  nodes.messageDetail.dataset.messageId = summary.id;
  setStatus('Ready');
}

async function refresh({ silent = false } = {}) {
  if (state.isRefreshing) {
    return;
  }

  state.isRefreshing = true;
  try {
    localStorage.setItem('automail.apiBase', apiBase());
    localStorage.setItem('automail.apiKey', apiKey());
    localStorage.setItem('automail.autoRefresh', String(nodes.autoRefreshInput.checked));
    await loadMailboxes();
    await loadMessages();
  } catch (error) {
    console.error(error);
    if (!silent) {
      setStatus(error.message, true);
    }
  } finally {
    state.isRefreshing = false;
  }
}

function updateAutoRefresh() {
  if (state.refreshTimer) {
    clearInterval(state.refreshTimer);
    state.refreshTimer = null;
  }

  if (!nodes.autoRefreshInput.checked) {
    setStatus('Ready');
    return;
  }

  state.refreshTimer = setInterval(() => {
    refresh({ silent: true });
  }, 5000);
  setStatus('Auto refresh every 5s');
}

nodes.searchForm.addEventListener('submit', (event) => {
  event.preventDefault();
  state.filters = {
    sender: nodes.senderInput.value.trim(),
    keyword: nodes.keywordInput.value.trim(),
    limit: Math.max(1, Math.min(Number(nodes.limitInput.value || 50), 100))
  };
  state.selectedMessageId = '';
  refresh();
});

nodes.autoRefreshInput.checked = localStorage.getItem('automail.autoRefresh') !== 'false';
nodes.autoRefreshInput.addEventListener('change', () => {
  localStorage.setItem('automail.autoRefresh', String(nodes.autoRefreshInput.checked));
  updateAutoRefresh();
});

nodes.refreshButton.addEventListener('click', () => refresh());

refresh();
updateAutoRefresh();
