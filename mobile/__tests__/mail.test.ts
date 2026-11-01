jest.mock('@react-native-community/netinfo', () => ({ fetch: jest.fn() }));
jest.mock('../src/lib/gmail/auth', () => ({ accessToken: jest.fn(), isGmailConnected: jest.fn(), AuthExpiredError: class extends Error {} }));
jest.mock('../src/lib/db', () => ({ db: {}, notify: jest.fn(), setSetting: jest.fn() }));

import { buildMime, findBody, htmlToText, parseFrom } from '../src/lib/gmail/gmail';
import { toBase64Url } from '../src/lib/encoding';

function parseMime(mime: string) {
  const [head, body] = mime.split('\r\n\r\n');
  const headers: Record<string, string> = {};
  for (const line of head.split('\r\n')) {
    const i = line.indexOf(':');
    headers[line.slice(0, i).toLowerCase()] = line.slice(i + 1).trim();
  }
  return { headers, body: Buffer.from(body.replace(/\r\n/g, ''), 'base64').toString('utf8') };
}

describe('buildMime', () => {
  it('builds a threaded UTF-8 reply that decodes back exactly', () => {
    const body = 'Merhaba Ali,\n\nTeşekkürler — Tuesday 10am works.\n\n' + 'Long line '.repeat(30);
    const mime = buildMime({ to: 'ali@example.com', subject: 'Re: Bütçe planı', body, inReplyTo: '<abc@mail>', references: '<root@mail>' });
    const { headers, body: decoded } = parseMime(mime);
    expect(headers['to']).toBe('ali@example.com');
    expect(headers['subject']).toMatch(/^=\?UTF-8\?B\?.+\?=$/);
    expect(Buffer.from(headers['subject'].slice(10, -2), 'base64').toString('utf8')).toBe('Re: Bütçe planı');
    expect(headers['in-reply-to']).toBe('<abc@mail>');
    expect(headers['references']).toBe('<root@mail> <abc@mail>');
    expect(headers['content-type']).toContain('charset="UTF-8"');
    expect(decoded).toBe(body);
    for (const line of mime.split('\r\n')) expect(line.length).toBeLessThanOrEqual(998); // RFC 5322 limit
  });

  it('omits threading headers for new mail and keeps ASCII subjects readable', () => {
    const mime = buildMime({ to: 'a@b.c', subject: 'Hello', body: 'Hi' });
    expect(mime).not.toMatch(/In-Reply-To|References/);
    expect(mime).toContain('Subject: Hello\r\n');
    expect(parseMime(mime).body).toBe('Hi');
  });
});

describe('Gmail message parsing', () => {
  const part = (mimeType: string, text: string) => ({ mimeType, body: { data: toBase64Url(text) } });

  it('finds the plain-text part inside nested multiparts', () => {
    const payload = { mimeType: 'multipart/mixed', parts: [{ mimeType: 'multipart/alternative', parts: [part('text/html', '<b>Hi</b>'), part('text/plain', 'Hi there')] }] };
    expect(findBody(payload, 'text/plain')).toBe('Hi there');
    expect(findBody(payload, 'text/html')).toBe('<b>Hi</b>');
    expect(findBody({ mimeType: 'text/plain' }, 'text/html')).toBeNull();
  });

  it('turns HTML mail into readable text and drops scripts/styles', () => {
    const html = '<style>p{color:red}</style><p>Hello&nbsp;Sarah,</p><p>Q3 &amp; Q4</p><script>alert(1)</script><br>Thanks';
    expect(htmlToText(html)).toBe('Hello Sarah,\nQ3 & Q4\n\nThanks');
  });

  it('parses From headers', () => {
    expect(parseFrom('"Ali Veli" <ali@example.com>')).toEqual({ name: 'Ali Veli', addr: 'ali@example.com' });
    expect(parseFrom('<x@y.z>')).toEqual({ name: 'x@y.z', addr: 'x@y.z' });
    expect(parseFrom('plain@addr.com')).toEqual({ name: 'plain@addr.com', addr: 'plain@addr.com' });
  });
});
