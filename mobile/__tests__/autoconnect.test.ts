const mockSettings: Record<string, string> = {};
jest.mock('../src/lib/db', () => ({
  getSetting: (k: string, f: string | null = null) => (k in mockSettings ? mockSettings[k] : f),
  setSetting: (k: string, v: string) => (mockSettings[k] = v),
  notify: jest.fn(),
}));
jest.mock('expo-secure-store', () => ({ setItemAsync: jest.fn(async () => {}) }));

// A fake mail provider: which mockServer/port/login combinations work.
let mockServer: { imap: (h: string, p: number, user: string) => string | null; smtp: (h: string, p: number, user: string) => string | null };
const mockTried: string[] = [];
jest.mock('../src/lib/mail/imap', () => ({
  IMAP_PASSWORD_KEY: 'imap.password',
  cleanError: (e: unknown) => (e instanceof Error ? e.message : String(e)),
  imapNative: () => ({
    testImap: async (c: any) => {
      mockTried.push(`IN ${c.imapHost}:${c.imapPort} ${c.username || c.email}`);
      const err = mockServer.imap(c.imapHost, c.imapPort, c.username || c.email);
      if (err) throw new Error(err);
      return true;
    },
    testSmtp: async (c: any) => {
      mockTried.push(`OUT ${c.smtpHost}:${c.smtpPort} ${c.username || c.email}`);
      const err = mockServer.smtp(c.smtpHost, c.smtpPort, c.username || c.email);
      if (err) throw new Error(err);
      return true;
    },
  }),
}));

import { autoConnect, ConnectError } from '../src/lib/mail/autoconnect';

const WRONG = 'Wrong email or password, or the mail mockServer refused the sign-in.';
const NOT_FOUND = 'Mail mockServer not found. Check the mockServer name and your internet connection.';
const BLOCKED = 'Could not reach the mail mockServer. Check the mockServer, port and your internet connection.';
const HOSTINGER = { imapHost: 'imap.hostinger.com', imapPort: 993, imapSecurity: 'ssl' as const, smtpHost: 'smtp.hostinger.com', smtpPort: 465, smtpSecurity: 'ssl' as const };

beforeEach(() => {
  mockTried.length = 0;
  for (const k of Object.keys(mockSettings)) delete mockSettings[k];
});

describe('autoConnect', () => {
  it('connects with the detected servers straight away when they work', async () => {
    mockServer = { imap: () => null, smtp: () => null };
    const r = await autoConnect('ceo@saibaan.org.pk', 'pw', HOSTINGER);
    expect(r.canSend).toBe(true);
    expect(mockTried).toEqual(['IN imap.hostinger.com:993 ceo@saibaan.org.pk', 'OUT smtp.hostinger.com:465 ceo@saibaan.org.pk']);
    expect(JSON.parse(mockSettings['imap.servers'])).toMatchObject({ imapHost: 'imap.hostinger.com', smtpPort: 465, username: '' });
    expect(mockSettings['imap.canSend']).toBe('1');
  });

  it('tries the short login name when the mockServer wants it', async () => {
    mockServer = { imap: (_h, _p, u) => (u === 'ceo' ? null : WRONG), smtp: (_h, _p, u) => (u === 'ceo' ? null : WRONG) };
    const r = await autoConnect('ceo@firm.example', 'pw', null);
    expect(r.canSend).toBe(true);
    expect(JSON.parse(mockSettings['imap.servers']).username).toBe('ceo');
  });

  it('finds the right mockServer name for the domain and skips names that do not exist', async () => {
    mockServer = {
      imap: (h, p) => (h === 'mail.firm.example' && p === 993 ? null : h === 'imap.firm.example' ? NOT_FOUND : BLOCKED),
      smtp: (h) => (h === 'mail.firm.example' ? null : NOT_FOUND),
    };
    await autoConnect('aqsa@firm.example', 'pw', null);
    expect(mockTried.filter((t) => t.startsWith('IN imap.firm.example'))).toHaveLength(1); // not-found host is not mockTried again on 143
    expect(JSON.parse(mockSettings['imap.servers'])).toMatchObject({ imapHost: 'mail.firm.example', smtpHost: 'mail.firm.example' });
  });

  it('uses port 587 when the network blocks 465', async () => {
    mockServer = { imap: () => null, smtp: (_h, p) => (p === 587 ? null : BLOCKED) };
    const r = await autoConnect('zahoor@saibaan.org.pk', 'pw', HOSTINGER);
    expect(r.canSend).toBe(true);
    expect(JSON.parse(mockSettings['imap.servers'])).toMatchObject({ smtpHost: 'smtp.hostinger.com', smtpPort: 587, smtpSecurity: 'starttls' });
  });

  it('still connects for reading when every sending port is blocked', async () => {
    mockServer = { imap: () => null, smtp: () => BLOCKED };
    const r = await autoConnect('zahoor@saibaan.org.pk', 'pw', HOSTINGER);
    expect(r.canSend).toBe(false);
    expect(mockSettings['imap.canSend']).toBe('0');
    expect(JSON.parse(mockSettings['imap.servers']).smtpHost).toBe('smtp.hostinger.com');
  });

  it('explains a wrong password and lists what each server answered', async () => {
    mockServer = { imap: () => WRONG, smtp: () => null };
    const e = await autoConnect('ceo@saibaan.org.pk', 'bad', HOSTINGER).catch((x) => x);
    expect(e).toBeInstanceOf(ConnectError);
    expect(e.message).toMatch(/email or password is wrong/);
    expect(e.attempts[0]).toMatchObject({ server: 'imap.hostinger.com:993', result: 'password' });
    expect(mockSettings['imap.email']).toBeUndefined();
  });

  it('says it cannot reach a server when nothing answers', async () => {
    mockServer = { imap: () => BLOCKED, smtp: () => BLOCKED };
    const e = await autoConnect('ceo@saibaan.org.pk', 'pw', HOSTINGER).catch((x) => x);
    expect(e.message).toMatch(/Could not reach a mail server/);
  });
});
