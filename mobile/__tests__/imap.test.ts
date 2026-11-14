jest.mock('@react-native-community/netinfo', () => ({ fetch: async () => ({ isConnected: true, isInternetReachable: true }) }));
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(), setItemAsync: jest.fn(), deleteItemAsync: jest.fn() }));
jest.mock('../src/lib/db', () => ({ db: {}, getSetting: () => null, setSetting: jest.fn(), notify: jest.fn() }));

import { cleanError, detectServers, threadKey } from '../src/lib/mail/imap';

function mx(records: string[]) {
  (global as any).fetch = jest.fn(async () => ({ json: async () => ({ Answer: records.map((data) => ({ data })) }) }));
}

describe('work email server detection', () => {
  it('recognises Hostinger from the MX record (saibaan.org.pk)', async () => {
    mx(['5 mx1.hostinger.com.', '10 mx2.hostinger.com.']);
    const d = await detectServers('ceo@saibaan.org.pk');
    expect(d.label).toBe('Hostinger');
    expect(d.settings).toEqual({ imapHost: 'imap.hostinger.com', imapPort: 993, imapSecurity: 'ssl', smtpHost: 'smtp.hostinger.com', smtpPort: 465, smtpSecurity: 'ssl' });
    // Only the domain is looked up, never the address.
    expect(((global as any).fetch as jest.Mock).mock.calls[0][0]).toBe('https://cloudflare-dns.com/dns-query?name=saibaan.org.pk&type=MX');
  });

  it('tries the next DNS service when one is blocked (dns.google is blocked on some networks)', async () => {
    (global as any).fetch = jest.fn(async (url: string) => {
      if (url.includes('cloudflare')) throw new Error('blocked');
      return { json: async () => ({ Answer: [{ data: '5 mx1.hostinger.com.' }] }) };
    });
    expect((await detectServers('aqsa.riaz@saibaan.org.pk')).label).toBe('Hostinger');
  });

  it('recognises Google Workspace and points to Google sign-in or an app password', async () => {
    mx(['1 aspmx.l.google.com.']);
    const d = await detectServers('ali@company.example');
    expect(d.provider).toBe('gmail');
    expect(d.settings.imapHost).toBe('imap.gmail.com');
    expect(d.note).toMatch(/Connect Gmail/);
  });

  it('knows the big providers by address alone (no lookup needed)', async () => {
    (global as any).fetch = jest.fn();
    expect((await detectServers('a@yahoo.com')).settings.imapHost).toBe('imap.mail.yahoo.com');
    expect((await detectServers('a@icloud.com')).settings.smtpPort).toBe(587);
    expect((await detectServers('a@outlook.com')).note).toMatch(/Microsoft/);
    expect((await detectServers('a@gmail.com')).provider).toBe('gmail');
    expect((global as any).fetch).not.toHaveBeenCalled();
  });

  it('recognises company mail hosted at GoDaddy, Namecheap and Titan from the MX record', async () => {
    mx(['0 smtp.secureserver.net.']);
    expect((await detectServers('ceo@firm.example')).label).toBe('GoDaddy Email');
    mx(['10 mx1.privateemail.com.']);
    expect((await detectServers('ceo@firm.example')).settings.imapHost).toBe('mail.privateemail.com');
    mx(['10 mx1.titan.email.']);
    expect((await detectServers('ceo@firm.example')).settings.smtpHost).toBe('smtp.titan.email');
  });

  it('falls back to mail.<domain> for other hosting, or when offline', async () => {
    mx(['10 mx.someisp.example.']);
    expect((await detectServers('ali@firm.example')).settings.imapHost).toBe('mail.firm.example');
    (global as any).fetch = jest.fn(async () => {
      throw new Error('offline');
    });
    expect((await detectServers('ali@firm.example')).settings.smtpHost).toBe('mail.firm.example');
  });
});

describe('threadKey', () => {
  it('groups a conversation by its first message', () => {
    expect(threadKey({ references: '<a@x> <b@x>', 'in-reply-to': '<b@x>', 'message-id': '<c@x>' }, 'id')).toBe('<a@x>');
    expect(threadKey({ 'in-reply-to': '<b@x>', 'message-id': '<c@x>' }, 'id')).toBe('<b@x>');
    expect(threadKey({ 'message-id': '<c@x>' }, 'id')).toBe('<c@x>');
    expect(threadKey({}, 'imap:1:5')).toBe('imap:1:5');
  });
});

describe('cleanError', () => {
  it('keeps only the readable part of a native error', () => {
    expect(cleanError(new Error("Call to function 'ShotorMail.test' has been rejected.\n→ Caused by: Wrong email or password, or the mail server refused the sign-in."))).toBe(
      'Wrong email or password, or the mail server refused the sign-in.',
    );
  });
});
