import { createApiClient } from './api.js';
import { DEFAULT_API_BASE, DEFAULT_API_KEY } from './config.js';
import {
  escapeAttribute,
  escapeHtml,
  formatAddressChips,
  formatTime,
  fullTime,
  splitEmail
} from './dom-utils.js';
import {
  extractStructuredItems,
  fitIframeToContent,
  isTrackingLink,
  messageBodyText,
  renderableHtmlDocument
} from './mail-content.js';

const DEFAULT_BODY_MODE_KEY = 'automail.viewer.defaultBodyMode';

function readDefaultBodyMode() {
  const value = localStorage.getItem(DEFAULT_BODY_MODE_KEY);
  return value === 'text' ? 'text' : 'html';
}

const state = {
  mailboxes: [],
  selectedMailbox: 'all',
  messages: [],
  selectedMessageId: '',
  defaultBodyMode: readDefaultBodyMode(),
  bodyModeByMessageId: new Map(),
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
  apiBaseText: document.querySelector('#apiBaseText'),
  senderInput: document.querySelector('#senderInput'),
  keywordInput: document.querySelector('#keywordInput'),
  limitInput: document.querySelector('#limitInput'),
  autoRefreshInput: document.querySelector('#autoRefreshInput'),
  searchForm: document.querySelector('#searchForm'),
  refreshButton: document.querySelector('#refreshButton'),
  settingsButton: document.querySelector('#settingsButton'),
  settingsCloseButton: document.querySelector('#settingsCloseButton'),
  settingsBackdrop: document.querySelector('#settingsBackdrop'),
  settingsPanel: document.querySelector('#settingsPanel'),
  defaultBodyModeInputs: document.querySelectorAll('input[name="defaultBodyMode"]'),
  mailboxList: document.querySelector('#mailboxList'),
  messageTitle: document.querySelector('#messageTitle'),
  messageCount: document.querySelector('#messageCount'),
  messageList: document.querySelector('#messageList'),
  messageDetail: document.querySelector('#messageDetail'),
  toast: document.querySelector('#toast')
};

nodes.apiBaseText.value = DEFAULT_API_BASE;

const api = createApiClient({
  apiBase: () => DEFAULT_API_BASE,
  apiKey: () => DEFAULT_API_KEY
});

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

function setDefaultBodyMode(value) {
  state.defaultBodyMode = value === 'html' ? 'html' : 'text';
  localStorage.setItem(DEFAULT_BODY_MODE_KEY, state.defaultBodyMode);
  nodes.defaultBodyModeInputs.forEach((input) => {
    input.checked = input.value === state.defaultBodyMode;
  });
}

function setSettingsOpen(open) {
  nodes.settingsPanel.hidden = !open;
  nodes.settingsBackdrop.hidden = !open;
  nodes.settingsButton.setAttribute('aria-expanded', String(open));

  if (open) {
    nodes.settingsPanel.querySelector('input:checked')?.focus();
  } else {
    nodes.settingsButton.focus();
  }
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

function renderMailboxes() {
  const items = [
    { email: 'all', label: 'All', count: state.messages.length },
    ...state.mailboxes.map((email) => ({ email, label: email, count: '' }))
  ];

  nodes.mailboxList.replaceChildren(...items.map((item) => {
    const row = document.createElement('div');
    const emailParts = splitEmail(item.email);
    row.className = `mailbox-item${state.selectedMailbox === item.email ? ' active' : ''}`;
    row.innerHTML = `
      <button class="mailbox-select" type="button">
        <span class="mailbox-name">
          ${item.email === 'all'
            ? escapeHtml(item.label)
            : `<span class="mailbox-prefix" data-copy="${escapeHtml(item.email)}" title="点击前缀复制完整邮箱">${escapeHtml(emailParts.prefix)}</span><span class="mailbox-domain">${escapeHtml(emailParts.domain)}</span>`
          }
        </span>
        ${item.email === 'all' ? `<span class="mailbox-count">${item.count}</span>` : ''}
      </button>
    `;
    const prefix = row.querySelector('.mailbox-prefix');
    if (prefix) {
      prefix.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        copyText(item.email);
      });
    }
    function selectMailbox() {
      state.selectedMailbox = item.email;
      state.selectedMessageId = '';
      renderMailboxes();
      loadMessages();
    }
    row.querySelector('.mailbox-select').addEventListener('click', selectMailbox);
    return row;
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
  const visibleStructuredItems = [];
  const foldedTrackingItems = [];

  for (const item of structuredItems) {
    if (item.type === 'link' && isTrackingLink(item.value)) {
      foldedTrackingItems.push(item);
      continue;
    }
    visibleStructuredItems.push(item);
  }

  const bodyText = messageBodyText(message);
  const hasHtml = Boolean(String(message.html || '').trim());
  const selectedBodyMode = state.bodyModeByMessageId.get(message.id) || state.defaultBodyMode;
  const bodyMode = hasHtml ? selectedBodyMode : 'text';
  const bodyToggleHtml = hasHtml
    ? `
      <div class="body-toolbar" role="group" aria-label="Message body view mode">
        <button class="body-mode${bodyMode === 'text' ? ' active' : ''}" type="button" data-body-mode="text">Text</button>
        <button class="body-mode${bodyMode === 'html' ? ' active' : ''}" type="button" data-body-mode="html">Render HTML</button>
      </div>
    `
    : '';
  const bodyHtml = bodyMode === 'html'
    ? `
      <iframe
        class="html-frame"
        title="Rendered email HTML"
        sandbox="allow-forms allow-popups allow-popups-to-escape-sandbox allow-same-origin allow-top-navigation-by-user-activation"
        referrerpolicy="no-referrer"
        csp="script-src 'none'"
        scrolling="no"
        srcdoc="${escapeAttribute(renderableHtmlDocument(message.html))}"
      ></iframe>
    `
    : `<div class="mail-body">${escapeHtml(bodyText || '(empty body)')}</div>`;
  const structuredHtml = visibleStructuredItems.length > 0
    ? `
      <section class="extracted">
        ${visibleStructuredItems.map((item) => `
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
  const foldedTrackingHtml = foldedTrackingItems.length > 0
    ? `
      <details class="folded-links">
        <summary>${foldedTrackingItems.length} tracking link${foldedTrackingItems.length === 1 ? '' : 's'} folded</summary>
        <div class="folded-link-list">
          ${foldedTrackingItems.map((item) => `
            <button class="folded-link" type="button" data-copy="${escapeHtml(item.value)}">${escapeHtml(item.value)}</button>
          `).join('')}
        </div>
      </details>
    `
    : '';

  nodes.messageDetail.className = 'detail-inner';
  nodes.messageDetail.dataset.messageId = message.id || '';
  nodes.messageDetail.innerHTML = `
    <h2 class="detail-title">${message.subject || '(no subject)'}</h2>
    ${structuredHtml}
    ${foldedTrackingHtml}
    <div class="detail-grid">
      <strong>Mailbox</strong><span>${message.mailbox}</span>
      <strong>From</strong><span>${formatAddressChips(message.from)}</span>
      <strong>To</strong><span>${formatAddressChips(message.to)}</span>
      <strong>Stored</strong><span>${fullTime(message.storedAt)}</span>
      <strong>Date</strong><span>${fullTime(message.date)}</span>
    </div>
    ${bodyToggleHtml}
    ${bodyHtml}
  `;
  nodes.messageDetail.querySelectorAll('[data-copy]').forEach((item) => {
    item.addEventListener('click', (event) => {
      event.preventDefault();
      copyText(item.dataset.copy);
    });
  });
  nodes.messageDetail.querySelectorAll('[data-body-mode]').forEach((item) => {
    item.addEventListener('click', () => {
      state.bodyModeByMessageId.set(message.id, item.dataset.bodyMode === 'html' ? 'html' : 'text');
      renderMessageDetail(message);
    });
  });

  const frame = nodes.messageDetail.querySelector('.html-frame');
  if (frame) {
    fitIframeToContent(frame);
  }
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
  const data = await api.request('/mailboxes');
  state.mailboxes = data.mailboxes || [];
  renderMailboxes();
}

async function loadMessages() {
  setStatus('Loading messages...');
  const previousSelectedId = state.selectedMessageId;
  const data = await api.request(`/messages?${buildMessageQuery()}`);
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
  const message = await api.request(`/messages/${summary.id}?${params.toString()}`);
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
nodes.settingsButton.addEventListener('click', () => setSettingsOpen(true));
nodes.settingsCloseButton.addEventListener('click', () => setSettingsOpen(false));
nodes.settingsBackdrop.addEventListener('click', () => setSettingsOpen(false));
nodes.defaultBodyModeInputs.forEach((input) => {
  input.addEventListener('change', () => {
    setDefaultBodyMode(input.value);
    state.bodyModeByMessageId.clear();
    if (nodes.messageDetail.dataset.messageId) {
      const selectedMessage = state.messages.find((message) => message.id === nodes.messageDetail.dataset.messageId);
      if (selectedMessage) {
        loadMessageDetail(selectedMessage);
      }
    }
    showToast(`Default body mode: ${state.defaultBodyMode === 'html' ? 'Render HTML' : 'Text'}`);
  });
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !nodes.settingsPanel.hidden) {
    setSettingsOpen(false);
  }
});

setDefaultBodyMode(state.defaultBodyMode);
refresh();
updateAutoRefresh();
