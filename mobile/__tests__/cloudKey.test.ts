jest.mock('expo-secure-store', () => ({}));
jest.mock('../src/lib/db', () => ({ getSetting: () => null, setSetting: jest.fn(), notify: jest.fn() }));
jest.mock('../src/lib/ai/engine', () => ({ generate: jest.fn() }));

import { cleanCloudKey } from '../src/lib/ai/cloud';

const ID = 'e5d1d600692181a65ede8a1a338b9951';
const TOKEN = 'cfat_' + 'A'.repeat(48);

describe('cleanCloudKey (what people paste on the phone)', () => {
  it('keeps clean values as they are', () => {
    expect(cleanCloudKey(ID, TOKEN)).toEqual({ accountId: ID, token: TOKEN });
  });
  it('removes labels like "accountid=" and "Account ID:"', () => {
    expect(cleanCloudKey(`accountid=${ID}`, TOKEN).accountId).toBe(ID);
    expect(cleanCloudKey(`Account ID: ${ID.toUpperCase()}`, TOKEN).accountId).toBe(ID);
  });
  it('removes token labels, spaces and line breaks copied from a chat app', () => {
    expect(cleanCloudKey(ID, `token: ${TOKEN}`).token).toBe(TOKEN);
    expect(cleanCloudKey(ID, `  ${TOKEN.slice(0, 20)}\n${TOKEN.slice(20)}  `).token).toBe(TOKEN);
    expect(cleanCloudKey(ID, `API token = ${TOKEN}`).token).toBe(TOKEN);
  });
});
