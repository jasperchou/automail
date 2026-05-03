export function stripHtml(value = '') {
  return String(value)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function extractHtmlLinks(value = '') {
  const links = [];
  const anchorPattern = /<a\b[^>]*\shref=["'](https?:\/\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;

  for (const match of String(value).matchAll(anchorPattern)) {
    const visibleText = stripHtml(match[2]);
    if (!visibleText) {
      continue;
    }
    links.push(match[1]);
  }

  return links;
}

const imageExtensionPattern = /\.(?:avif|bmp|gif|ico|jpe?g|png|svg|webp)(?:$|[?#])/i;
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

export function isImageLikeLink(value = '') {
  try {
    const url = new URL(value);
    return imageExtensionPattern.test(url.pathname);
  } catch {
    return imageExtensionPattern.test(String(value));
  }
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

function uniqueBy(items, keyFn) {
  const seen = new Set();
  const result = [];

  for (const item of items) {
    const key = keyFn(item);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(item);
  }

  return result;
}

export function extractStructuredData({ subject = '', text = '', html = '' } = {}) {
  const htmlLinks = extractHtmlLinks(html);
  const source = [subject, text, stripHtml(html), ...htmlLinks].filter(Boolean).join('\n');
  const verificationCodes = uniqueBy(
    [...source.matchAll(/(?<!\d)\d{6}(?!\d)/g)].map((match) => ({
      type: 'verification_code',
      label: 'Verification code',
      value: match[0],
      confidence: 0.9
    })),
    (item) => item.value
  );

  const links = uniqueBy(
    [...source.matchAll(/\bhttps?:\/\/[^\s<>"')\]]+/gi)]
      .map((match) => match[0].replace(/[.,;:!?]+$/, ''))
      .filter((value) => !isIgnoredResourceLink(value))
      .map((value) => ({
        type: 'link',
        label: 'Link',
        value,
        confidence: 0.8
      })),
    (item) => item.value
  );

  return {
    version: 1,
    extractedAt: new Date().toISOString(),
    items: [...verificationCodes, ...links]
  };
}

export function normalizeStructuredData(value = {}) {
  const items = Array.isArray(value?.items) ? value.items : [];

  return {
    version: value?.version || 1,
    extractedAt: value?.extractedAt,
    items: items.filter((item) => item?.type !== 'link' || !isIgnoredResourceLink(item.value))
  };
}
