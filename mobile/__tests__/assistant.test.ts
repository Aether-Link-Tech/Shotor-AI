const reports = [
  { id: 1, title: 'Q3 Sales Report', source: 'pdf', original_text: '', summary: 'Revenue up 12% in Europe. Hiring freeze.', created_at: 3 },
  { id: 2, title: 'Security Audit', source: 'docx', original_text: '', summary: 'Two critical findings in VPN setup.', created_at: 2 },
  { id: 3, title: 'Board Minutes', source: 'paste', original_text: '', summary: 'Approved budget for Europe expansion.', created_at: 1 },
];
jest.mock('../src/lib/db', () => ({
  db: { getAllSync: () => reports },
  notify: jest.fn(),
  getSetting: (_k: string, f = '') => f,
  dayKey: () => '2026-11-01',
}));
jest.mock('../src/lib/calendar', () => ({}));
jest.mock('../src/lib/ai/models', () => ({ activeModel: () => null }));

import { findRelevantReports } from '../src/lib/assistant';

describe('findRelevantReports (offline search for chat context)', () => {
  it('ranks title matches above body matches', () => {
    const r = findRelevantReports('What did the sales report say about Europe?');
    expect(r[0].title).toBe('Q3 Sales Report');
    expect(r.map((x) => x.id)).toContain(3);
  });

  it('finds reports by content words', () => {
    expect(findRelevantReports('any VPN problems?')[0].title).toBe('Security Audit');
  });

  it('falls back to the latest report for vague questions', () => {
    expect(findRelevantReports('what is it?').map((r) => r.id)).toEqual([1]);
  });

  it('returns nothing when no report matches', () => {
    expect(findRelevantReports('weather tomorrow in Tokyo')).toEqual([]);
  });
});
