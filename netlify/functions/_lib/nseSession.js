// Shared across every NSE-scraping function in this project. NSE requires
// a session cookie from a homepage load before it'll answer API requests,
// and actively rate-limits/blocks traffic it flags as automated, that's
// true for allIndices, and it's true here too, possibly more so since the
// option-chain endpoint returns a much larger payload.
//
// Two things worth knowing if this starts throwing 403s regularly:
// 1. Fuller, more browser-realistic headers (below) sometimes help against
//    basic bot-signature checks, but not against IP-level blocking.
// 2. Netlify functions run from shared cloud infrastructure (AWS), and NSE
//    is known to rate-limit or block entire cloud IP ranges outright, no
//    header combination fixes that, since it's not about how the request
//    looks, it's about where it came from. If 403s persist across retries,
//    that's the more likely explanation, and there's no free workaround
//    for the option-chain feature specifically (unlike price/VIX/daily
//    close, it has no Yahoo fallback), checking nseindia.com directly in
//    a browser is the fallback until NSE's blocking eases up or a paid
//    data source replaces this endpoint.

const NSE_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  Accept: 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  Referer: 'https://www.nseindia.com/',
  Origin: 'https://www.nseindia.com',
  Connection: 'keep-alive',
  'Sec-Fetch-Dest': 'empty',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Site': 'same-origin',
  'sec-ch-ua': '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Windows"',
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function nseSession(attempt = 1) {
  const homeRes = await fetch('https://www.nseindia.com/', { headers: NSE_HEADERS });
  if (!homeRes.ok) {
    // One retry with a short backoff, cheap insurance against a
    // transient block, won't help at all against a hard IP-level block.
    if (attempt < 2) {
      await sleep(800);
      return nseSession(attempt + 1);
    }
    throw new Error(`NSE homepage returned ${homeRes.status} (after ${attempt} attempt(s))`);
  }
  const cookies =
    typeof homeRes.headers.getSetCookie === 'function'
      ? homeRes.headers.getSetCookie()
      : [homeRes.headers.get('set-cookie')].filter(Boolean);
  if (!cookies.length) {
    if (attempt < 2) {
      await sleep(800);
      return nseSession(attempt + 1);
    }
    throw new Error(`NSE gave no session cookie after ${attempt} attempt(s), likely blocked this request`);
  }
  return cookies.map((c) => c.split(';')[0]).join('; ');
}

module.exports = { NSE_HEADERS, nseSession };
