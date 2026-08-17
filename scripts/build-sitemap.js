// Regenerates sitemap.xml with a <lastmod> date for every URL, taken from
// the matching file's filesystem mtime. Run this after any content update
// that should be reflected as "changed" to crawlers:
//
//   node scripts/build-sitemap.js
//
// Preserves the existing URL list and <priority> values already in
// sitemap.xml — this only adds/refreshes <lastmod>, it doesn't decide
// which pages are included (add new pages to sitemap.xml manually, same
// as before, then re-run this).

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SITEMAP_PATH = path.join(ROOT, 'sitemap.xml');
const SITE_ORIGIN = 'https://starkworth.org';

const xml = fs.readFileSync(SITEMAP_PATH, 'utf8');
const urlBlocks = [...xml.matchAll(/<url>([\s\S]*?)<\/url>/g)];

const rebuilt = urlBlocks.map((block) => {
  const inner = block[1];
  const locMatch = /<loc>(.*?)<\/loc>/.exec(inner);
  const priorityMatch = /<priority>(.*?)<\/priority>/.exec(inner);
  const loc = locMatch[1];
  const priority = priorityMatch ? priorityMatch[1] : '0.5';

  const relativePath = loc.startsWith(SITE_ORIGIN) ? loc.slice(SITE_ORIGIN.length) : loc;
  const filePath = relativePath === '/' ? path.join(ROOT, 'index.html') : path.join(ROOT, relativePath.replace(/^\//, ''));

  let lastmod = new Date().toISOString().slice(0, 10);
  try {
    lastmod = fs.statSync(filePath).mtime.toISOString().slice(0, 10);
  } catch {
    console.warn(`Warning: no local file for ${loc} (expected at ${filePath}) — using today's date.`);
  }

  return `  <url><loc>${loc}</loc><lastmod>${lastmod}</lastmod><priority>${priority}</priority></url>`;
}).join('\n');

const output = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${rebuilt}\n</urlset>\n`;

fs.writeFileSync(SITEMAP_PATH, output, 'utf8');
console.log(`Updated ${urlBlocks.length} URLs in sitemap.xml with lastmod dates.`);
