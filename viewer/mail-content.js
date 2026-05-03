export function stripHtml(value) {
  const template = document.createElement('template');
  template.innerHTML = value || '';
  return template.content.textContent || '';
}

export function messageBodyText(message) {
  const text = String(message.text || '').trim();

  if (text) {
    return text;
  }

  return stripHtml(message.html).trim();
}

export function renderableHtmlDocument(value = '') {
  const source = String(value || '');
  const headContent = [
    '<meta charset="utf-8">',
    '<meta http-equiv="Content-Security-Policy" content="script-src \'none\'">',
    '<base target="_blank">',
    '<style>html,body{overflow:visible!important;min-height:0!important;}</style>'
  ].join('');

  if (/<head\b[^>]*>/i.test(source)) {
    return source.replace(/<head\b([^>]*)>/i, `<head$1>${headContent}`);
  }

  if (/<html\b[^>]*>/i.test(source)) {
    return source.replace(/<html\b([^>]*)>/i, `<html$1><head>${headContent}</head>`);
  }

  return `<!doctype html><html><head>${headContent}</head><body>${source}</body></html>`;
}

export function extractHtmlLinks(value) {
  const template = document.createElement('template');
  template.innerHTML = value || '';
  return [...template.content.querySelectorAll('a[href^="http://"], a[href^="https://"]')]
    .filter((anchor) => anchor.textContent.trim())
    .map((anchor) => anchor.href);
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

export function isIgnoredResourceLink(value = '') {
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

export function isTrackingLink(value = '') {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    const pathSegments = url.pathname
      .toLowerCase()
      .split('/')
      .filter(Boolean);
    const tokenPattern = /^(?:t|track|tracking|trk|click|clicks|clickthrough|click-through|redirect|redir|r)$/;

    return (
      pathSegments.some((segment) => tokenPattern.test(segment)) ||
      /(?:^|[.-])(?:track|tracking|trk|click)(?:[.-]|$)/.test(hostname)
    );
  } catch {
    return /(?:^|[/?#&_.-])(?:track|tracking|trk|click|clicks|clickthrough|redirect|redir)(?:$|[/?#&_.-])/i.test(String(value));
  }
}

export function extractStructuredItems(message) {
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

export function fitIframeToContent(frame) {
  function relaxDocumentScroll(doc) {
    for (const element of [doc.documentElement, doc.body].filter(Boolean)) {
      element.style.setProperty('overflow', 'visible', 'important');
      element.style.setProperty('min-height', '0', 'important');
    }
  }

  function resize() {
    try {
      const doc = frame.contentDocument;
      if (!doc) {
        return;
      }

      relaxDocumentScroll(doc);
      const body = doc.body;
      const root = doc.documentElement;
      const height = Math.max(
        body?.scrollHeight || 0,
        body?.offsetHeight || 0,
        root?.scrollHeight || 0,
        root?.offsetHeight || 0,
        240
      );
      frame.style.height = `${height + 2}px`;
    } catch {
      frame.style.height = '640px';
    }
  }

  frame.addEventListener('load', () => {
    resize();

    try {
      const doc = frame.contentDocument;
      if (!doc) {
        return;
      }

      const resizeObserver = new ResizeObserver(resize);
      resizeObserver.observe(doc.documentElement);
      if (doc.body) {
        resizeObserver.observe(doc.body);
      }

      for (const image of doc.images) {
        image.addEventListener('load', resize, { once: true });
        image.addEventListener('error', resize, { once: true });
      }

      setTimeout(resize, 200);
      setTimeout(resize, 1000);
    } catch {
      resize();
    }
  });
}
