import assert from 'node:assert/strict';
import test from 'node:test';
import {
  extractHtmlLinks,
  extractStructuredData,
  isImageLikeLink,
  isIgnoredResourceLink,
  normalizeStructuredData,
  stripHtml
} from '../src/structured.js';

test('stripHtml removes tags and normalizes whitespace', () => {
  assert.equal(stripHtml('<p>Hello <b>world</b></p>'), 'Hello world');
});

test('extractStructuredData extracts six digit verification codes and links', () => {
  const result = extractStructuredData({
    subject: 'Your code is 257535',
    text: 'Use 257535 to continue. Visit https://example.com/verify?token=abc.',
    html: '<a href="https://example.com/html">Open</a>'
  });

  assert.deepEqual(
    result.items.map((item) => [item.type, item.value]),
    [
      ['verification_code', '257535'],
      ['link', 'https://example.com/verify?token=abc'],
      ['link', 'https://example.com/html']
    ]
  );
});

test('extractHtmlLinks extracts only anchor href links', () => {
  assert.deepEqual(
    extractHtmlLinks('<a href="https://example.com/a">A</a><img src="https://example.com/b.png">'),
    ['https://example.com/a']
  );
});

test('extractHtmlLinks skips image-only anchors', () => {
  assert.deepEqual(
    extractHtmlLinks(`
      <a href="https://example.com/track"><img src="https://example.com/pixel.png"></a>
      <a href="https://example.com/action">Continue</a>
    `),
    ['https://example.com/action']
  );
});

test('extractStructuredData skips ignored resource links but keeps downloads', () => {
  const result = extractStructuredData({
    text: [
      'Logo https://cdn.example.com/logo.png',
      'Font https://cdn.example.com/font.woff2',
      'Styles https://cdn.example.com/app.css',
      'Package https://example.com/export.zip',
      'Action https://example.com/continue'
    ].join(' ')
  });

  assert.deepEqual(
    result.items.map((item) => [item.type, item.value]),
    [
      ['link', 'https://example.com/export.zip'],
      ['link', 'https://example.com/continue']
    ]
  );
});

test('isImageLikeLink detects common image extensions', () => {
  assert.equal(isImageLikeLink('https://example.com/logo.png?x=1'), true);
  assert.equal(isImageLikeLink('https://example.com/login'), false);
});

test('isIgnoredResourceLink detects static resources but keeps archives', () => {
  assert.equal(isIgnoredResourceLink('https://example.com/font.woff2'), true);
  assert.equal(isIgnoredResourceLink('https://fonts.googleapis.com/css?family=Inter'), true);
  assert.equal(isIgnoredResourceLink('https://example.com/app.js?v=1'), true);
  assert.equal(isIgnoredResourceLink('https://u20216706.ct.sendgrid.net/wf/open?upn=abc'), true);
  assert.equal(isIgnoredResourceLink('https://example.com/export.zip'), false);
  assert.equal(isIgnoredResourceLink('https://example.com/action'), false);
});

test('normalizeStructuredData filters ignored resource link items', () => {
  const result = normalizeStructuredData({
    version: 1,
    items: [
      { type: 'link', value: 'https://example.com/logo.svg' },
      { type: 'link', value: 'https://example.com/font.woff2' },
      { type: 'link', value: 'https://example.com/action' },
      { type: 'verification_code', value: '257535' }
    ]
  });

  assert.deepEqual(
    result.items.map((item) => [item.type, item.value]),
    [
      ['link', 'https://example.com/action'],
      ['verification_code', '257535']
    ]
  );
});
