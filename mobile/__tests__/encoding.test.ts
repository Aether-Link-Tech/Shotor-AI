import { base64ToBytes, bytesToBase64, fromBase64Url, toBase64Url, utf8Encode } from '../src/lib/encoding';

describe('base64', () => {
  it('matches Node for every padding length and random bytes', () => {
    for (let len = 0; len < 70; len++) {
      const bytes = new Uint8Array(len).map(() => Math.floor(Math.random() * 256));
      const expected = Buffer.from(bytes).toString('base64');
      expect(bytesToBase64(bytes)).toBe(expected);
      expect(Array.from(base64ToBytes(expected))).toEqual(Array.from(bytes));
    }
  });

  it('handles large inputs (PDF-sized) without corruption', () => {
    const bytes = new Uint8Array(3 * 1024 * 1024 + 7).map((_, i) => (i * 31) & 255);
    expect(bytesToBase64(bytes)).toBe(Buffer.from(bytes).toString('base64'));
  });

  it('round-trips UTF-8 text through Gmail base64url', () => {
    const text = 'Toplantı yarın 10:00 — Merhaba 👋 ünïcødé / + = ?';
    const encoded = toBase64Url(text);
    expect(encoded).not.toMatch(/[+/=]/);
    expect(fromBase64Url(encoded)).toBe(text);
    expect(Buffer.from(encoded, 'base64url').toString('utf8')).toBe(text);
    expect(utf8Encode('é').length).toBe(2);
  });
});
