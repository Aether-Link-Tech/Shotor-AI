import { isMeetingEmail, realFiles, seniorTitle } from '../src/lib/mail/rules';
import { findMeetingTime } from '../src/lib/meetingParse';

describe('important email signals', () => {
  it('finds a senior title in the signature', () => {
    expect(seniorTitle('Please see the proposal.\n\nBest regards,\nAli Khan\nCEO, Gulf Trade LLC\n+971 50 123 4567')).toBe('CEO');
    expect(seniorTitle('Thanks!\nOmar Haddad\nManaging Director | Haddad Logistics')).toBe('Managing Director');
    expect(seniorTitle('Hi Sarah,\nThanks for the visit.\nLeyla')).toBeNull();
    // A long sentence that mentions a CEO is not a signature.
    expect(seniorTitle('I spoke with our CEO yesterday and he agreed that we should review the whole supply contract before the end of the month.\nLeyla')).toBeNull();
  });

  it('counts real files but not signature logos or calendar invites', () => {
    const files = realFiles([
      { name: 'Proposal Q1.pdf', mime: 'application/pdf', size: 420000, ref: '1' },
      { name: 'logo.png', mime: 'image/png', size: 8000, ref: '2' },
      { name: 'invite.ics', mime: 'text/calendar', size: 900, ref: '3' },
      { name: 'site photo.jpg', mime: 'image/jpeg', size: 900000, ref: '4' },
    ]);
    expect(files.map((f) => f.name)).toEqual(['Proposal Q1.pdf', 'site photo.jpg']);
  });

  it('recognises meeting requests and invites', () => {
    expect(isMeetingEmail('Can we meet next week?', 'Hi Sarah', [])).toBe(true);
    expect(isMeetingEmail('Board call', 'Teams link below', [])).toBe(true);
    expect(isMeetingEmail('Updated invitation', '', [{ name: 'invite.ics', mime: 'text/calendar', size: 1, ref: '1' }])).toBe(true);
    expect(isMeetingEmail('Thank you', 'Thanks for hosting us yesterday.', [])).toBe(false);
  });

  it('finds the meeting time in the email for "Add to calendar"', () => {
    const sent = new Date(2026, 10, 2, 9, 0); // Monday 2 Nov 2026
    const t = findMeetingTime('Could we meet on Thursday at 2pm at your office?', sent, 'en-GB')!;
    expect(t.start.toString()).toBe(new Date(2026, 10, 5, 14, 0).toString());
    expect(t.end.getTime() - t.start.getTime()).toBe(3600000);
    expect(findMeetingTime('Thanks for the meeting last week.', sent, 'en-GB')).toBeNull();
  });
});
