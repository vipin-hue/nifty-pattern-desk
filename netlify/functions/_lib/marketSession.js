// NSE regular session: 9:15am - 3:30pm IST = 375 minutes total.
// Used to describe HOW EARLY in the session a range threshold was crossed —
// hitting the daily average range by 11am is a very different situation
// than hitting it at 3:15pm, even though the point total is the same.

const SESSION_OPEN_MIN = 9 * 60 + 15; // 555
const SESSION_CLOSE_MIN = 15 * 60 + 30; // 930
const SESSION_LENGTH_MIN = SESSION_CLOSE_MIN - SESSION_OPEN_MIN; // 375

function sessionElapsedPct(isoTimestamp) {
  const t = new Date(isoTimestamp);
  const istMs = t.getTime() + 5.5 * 60 * 60 * 1000;
  const ist = new Date(istMs);
  const minutesSinceMidnight = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  const elapsed = Math.min(Math.max(minutesSinceMidnight - SESSION_OPEN_MIN, 0), SESSION_LENGTH_MIN);
  return (elapsed / SESSION_LENGTH_MIN) * 100;
}

function paceNote(elapsedPct) {
  if (elapsedPct < 40) return 'well ahead of a typical full session — unusually fast';
  if (elapsedPct < 70) return 'faster than a typical full session';
  return 'roughly typical pace for a full session';
}

module.exports = { sessionElapsedPct, paceNote };
