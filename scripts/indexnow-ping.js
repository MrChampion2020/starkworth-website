// Pushes every URL in sitemap.xml to the IndexNow API, which Bing, Yandex,
// and Seznam use to index new/changed pages within minutes instead of
// waiting for their next crawl. Google does not participate in IndexNow
// (it has no equivalent open protocol), so this specifically helps
// everywhere Google doesn't — Bing (and, downstream, Copilot and
// DuckDuckGo/Yahoo's blended results), Yandex, and Seznam.
//
// Run this after deploying any content change worth re-indexing quickly:
//
//   node scripts/indexnow-ping.js
//
// One-time setup already done: the key below matches
// <root>/5592d178960a6eeb49380225a53ed73f.txt, which must stay published
// at https://starkworth.org/5592d178960a6eeb49380225a53ed73f.txt — that
// file *is* the ownership proof IndexNow checks. If you ever rotate the
// key, regenerate both together (see README note below).

const fs = require('fs');
const path = require('path');
const https = require('https');

const HOST = 'starkworth.org';
const KEY = '5592d178960a6eeb49380225a53ed73f';
const KEY_LOCATION = `https://${HOST}/${KEY}.txt`;
const SITEMAP_PATH = path.join(__dirname, '..', 'sitemap.xml');

const xml = fs.readFileSync(SITEMAP_PATH, 'utf8');
const urlList = [...xml.matchAll(/<loc>(.*?)<\/loc>/g)].map((m) => m[1]);

if (!urlList.length) {
  console.error('No URLs found in sitemap.xml — nothing to submit.');
  process.exit(1);
}

const payload = JSON.stringify({
  host: HOST,
  key: KEY,
  keyLocation: KEY_LOCATION,
  urlList,
});

const req = https.request(
  {
    hostname: 'api.indexnow.org',
    path: '/indexnow',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(payload),
    },
  },
  (res) => {
    let body = '';
    res.on('data', (chunk) => (body += chunk));
    res.on('end', () => {
      // IndexNow returns 200/202 on success and doesn't send a useful
      // body — the status code is what matters.
      console.log(`IndexNow responded ${res.statusCode} for ${urlList.length} URLs.`);
      if (body) console.log(body);
      if (res.statusCode >= 400) process.exitCode = 1;
    });
  },
);

req.on('error', (err) => {
  console.error('IndexNow request failed:', err.message);
  process.exitCode = 1;
});

req.write(payload);
req.end();
