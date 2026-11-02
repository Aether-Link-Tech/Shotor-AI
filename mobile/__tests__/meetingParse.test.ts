import { parseMeeting } from '../src/lib/meetingParse';

const NOW = new Date(2026, 10, 2, 9, 20); // Monday 2 November 2026, 09:20
const fmt = (d: Date) => `${d.toDateString()} ${d.toTimeString().slice(0, 5)}`;
const p = (q: string, locale = 'en-GB') => parseMeeting(q, NOW, { locale });

describe('parseMeeting (calendar quick add)', () => {
  it('reads relative day, pm time and place', () => {
    const m = p('Board call with Ali tomorrow 3pm at HQ');
    expect(m.title).toBe('Board call with Ali');
    expect(fmt(m.start)).toBe('Tue Nov 03 2026 15:00');
    expect(fmt(m.end)).toBe('Tue Nov 03 2026 16:00');
    expect(m.location).toBe('HQ');
  });

  it('treats 1–7 o’clock without am/pm as afternoon and reads the duration', () => {
    const m = p('Lunch with the Gulfstar team next Thursday at 1:30 for 90 minutes at Hilton');
    expect(m.start.getHours()).toBe(13);
    expect(m.start.getMinutes()).toBe(30);
    expect(m.start.getDay()).toBe(4); // Thursday
    expect((m.end.getTime() - m.start.getTime()) / 60000).toBe(90);
    expect(m.location).toBe('Hilton');
    expect(m.title).toBe('Lunch with the Gulfstar team');
  });

  it('handles short forms like "friday 11"', () => {
    const m = p('budget review friday 11');
    expect(fmt(m.start)).toBe('Fri Nov 06 2026 11:00');
    expect(m.title).toBe('Budget review');
    expect(m.location).toBe('');
  });

  it('uses day/month order outside the US and month/day in the US', () => {
    expect(fmt(p('sales meeting 12/11 10am in room 4').start)).toBe('Thu Nov 12 2026 10:00');
    expect(p('sales meeting 12/11 10am in room 4').location).toBe('room 4');
    expect(fmt(p('sales meeting 12/11 10am', 'en-US').start)).toBe('Fri Dec 11 2026 10:00');
  });

  it('keeps explicit 24-hour and am times', () => {
    expect(fmt(p('Call Murat on 5 Nov at 16:30').start)).toBe('Thu Nov 05 2026 16:30');
    expect(p('Call Murat on 5 Nov at 16:30').title).toBe('Call Murat');
    expect(fmt(p('gym tomorrow 7am').start)).toBe('Tue Nov 03 2026 07:00');
  });

  it('falls back to the next hour today when no date is given', () => {
    const m = p('Quick sync with HR');
    expect(fmt(m.start)).toBe('Mon Nov 02 2026 10:00');
    expect(m.hasTime).toBe(false);
    expect(m.title).toBe('Quick sync with HR');
  });

  it('accepts hours as duration', () => {
    const m = p('Strategy offsite friday 9am for 2 hours at the Ritz');
    expect((m.end.getTime() - m.start.getTime()) / 60000).toBe(120);
    expect(m.location).toBe('the Ritz');
  });
});
