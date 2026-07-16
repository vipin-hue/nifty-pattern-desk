// Shared across every NSE-scraping function in this project. NSE requires
// a session cookie from a homepage load before it'll answer API requests,
// and actively rate-limits/blocks traffic it flags as automated — that's
// true for allIndices, and it's true here too, possibly more so since the
// option-chain endpoint returns a much larger payload.

const NSE_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  Accept: 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  Referer: 'https://www.nseindia.com/',
};

async function nseSession() {
  const homeRes = await fetch('https://www.nseindia.com/', { headers: NSE_HEADERS });
  if (!homeRes.ok) throw new Error(`NSE homepage returned ${homeRes.status}`);
  const cookies =
    typeof homeRes.headers.getSetCookie === 'function'
      ? homeRes.headers.getSetCookie()
      : [homeRes.headers.get('set-cookie')].filter(Boolean);
  if (!cookies.length) throw new Error('NSE gave no session cookie — likely blocked this request');
  return cookies.map((c) => c.split(';')[0]).join('; ');
}

module.exports = { NSE_HEADERS, nseSession };
