import { maskNumbers, redactForCloud, stripQuoted, stripSignature } from '../src/lib/mail/redact';

describe('redactForCloud', () => {
  it('drops the quoted earlier message', () => {
    const body = 'Sounds good, see you then.\n\nOn Mon, 2 Nov 2026 at 10:00, Sarah Khan <sarah@x.example> wrote:\n> Can we meet?\n> Sarah';
    expect(stripQuoted(body)).toBe('Sounds good, see you then.');
    expect(stripQuoted('Yes.\n-----Original Message-----\nFrom: a\nOld text')).toBe('Yes.');
  });

  it('keeps the closing and name but drops the signature details', () => {
    const body = 'Please review the attached proposal.\n\nBest regards,\nAli Khan\nCEO, Gulf Trade LLC\n+971 50 123 4567\nwww.gulftrade.example';
    expect(stripSignature(body)).toBe('Please review the attached proposal.\n\nBest regards,\nAli Khan');
    expect(stripSignature('Hi\n-- \nAli\nPhone 123')).toBe('Hi');
  });

  it('hides phone, bank and card numbers but keeps amounts, percentages and dates', () => {
    const t = maskNumbers('Pay to IBAN PK36 SCBL 0000 0011 2345 6702, card 4111 1111 1111 1111, call +92 300 1234567 or 0300-1234567. Total $18.4M, 7% lower, by 30 November 2026.');
    expect(t).toContain('[bank account]');
    expect(t).toContain('[card or account number]');
    expect(t).toContain('[phone]');
    expect(t).not.toMatch(/1234567|4111|0011/);
    expect(t).toContain('$18.4M');
    expect(t).toContain('7% lower');
    expect(t).toContain('30 November 2026');
  });

  it('does everything together', () => {
    const body = 'Thanks, received.\n\nRegards,\nOmar\nDirector\nTel: +90 532 111 22 33\n\nOn Tue, Omar wrote:\n> old';
    expect(redactForCloud(body)).toBe('Thanks, received.\n\nRegards,\nOmar');
  });
});
