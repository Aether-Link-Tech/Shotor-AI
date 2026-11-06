/**
 * Shrinks an email before it goes to the online AI: drops old quoted messages and the
 * signature block, and hides phone, bank and card numbers. Amounts, percentages and dates
 * stay, because summaries and answers need them. Runs on the phone.
 */

const QUOTE_START = [
  /^On .{4,200} wrote:\s*$/im, // Gmail / Apple Mail
  /^-{2,}\s*Original Message\s*-{2,}/im, // Outlook
  /^From:\s.+\n(Sent|Date):\s.+/im, // Outlook header block
  /^_{10,}\s*$/m, // Outlook separator line
];

/** Text before the first quoted earlier message, without ">" quoted lines. */
export function stripQuoted(body: string): string {
  let text = body.replace(/\r/g, '');
  let cut = text.length;
  for (const re of QUOTE_START) {
    const m = re.exec(text);
    if (m && m.index > 0 && m.index < cut) cut = m.index;
  }
  text = text.slice(0, cut);
  return text
    .split('\n')
    .filter((l) => !/^\s*>/.test(l))
    .join('\n')
    .trim();
}

/** Signature block: after a "-- " line, or after a closing like "Best regards," near the end. */
export function stripSignature(body: string): string {
  const lines = body.split('\n');
  const dash = lines.findIndex((l) => /^--\s?$/.test(l));
  if (dash > 0) return lines.slice(0, dash).join('\n').trim();
  for (let i = Math.max(0, lines.length - 12); i < lines.length; i++) {
    if (/^\s*(best( regards)?|kind regards|regards|warm regards|thanks( and regards)?|thank you|sincerely|cheers|br),?\s*$/i.test(lines[i])) {
      // Keep the closing and the name on the next line; drop titles, phones and addresses below.
      return lines.slice(0, Math.min(lines.length, i + 2)).join('\n').trim();
    }
  }
  return body.trim();
}

/** Hides phone, IBAN, card and long account numbers. */
export function maskNumbers(text: string): string {
  return text
    .replace(/\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){2,7}(?:\s?[A-Z0-9]{1,4})?\b/g, '[bank account]')
    .replace(/\b(?:\d[ -]?){13,19}\b/g, '[card or account number]')
    .replace(/(?:\+|00)\d[\d\s().-]{7,}\d/g, '[phone]')
    .replace(/\(?\b0\d{2,4}\)?[\s.-]?\d{3,4}[\s.-]?\d{3,4}\b/g, '[phone]')
    .replace(/\b\d{9,}\b/g, '[number]');
}

/** Everything above, for an email body sent to the online AI. */
export function redactForCloud(body: string): string {
  return maskNumbers(stripSignature(stripQuoted(body))).slice(0, 6000);
}
