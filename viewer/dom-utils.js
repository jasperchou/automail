export function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

export function escapeAttribute(value) {
  return escapeHtml(value);
}

export function formatTime(value) {
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

export function fullTime(value) {
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

export function splitEmail(value) {
  const text = String(value || '');
  const atIndex = text.indexOf('@');

  if (atIndex <= 0) {
    return {
      prefix: text,
      domain: ''
    };
  }

  return {
    prefix: text.slice(0, atIndex),
    domain: text.slice(atIndex)
  };
}

export function formatAddressChips(value) {
  if (!Array.isArray(value) || value.length === 0) {
    return '';
  }

  return value.map((item) => {
    const address = item.address || '';
    const label = item.name ? `${item.name} <${address}>` : address;
    return `<span class="copy-email" data-copy="${escapeHtml(address)}" title="Click to copy">${escapeHtml(label)}</span>`;
  }).join(', ');
}
