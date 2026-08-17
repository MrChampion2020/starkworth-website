// Builds js/site-index.json — the corpus Mena searches when a question
// doesn't match anything in her curated knowledge base. Run this again any
// time page content changes meaningfully:
//
//   node scripts/build-mena-index.js
//
// It walks every page under pages/ (including pages/guides/), pulls every
// FAQPage JSON-LD block already embedded in those pages (they're
// structured Q&A pairs written for SEO, which happens to make them a
// ready-made answer corpus), and falls back to title + meta description
// for pages that don't have FAQ schema.

const fs = require('fs');
const path = require('path');

const ROOT = process.env.MENA_INDEX_ROOT || path.resolve(__dirname, '..');
const PAGES_DIR = path.join(ROOT, 'pages');
const OUT_FILE = path.join(ROOT, 'js', 'site-index.json');

function urlFor(absPath) {
  return path.relative(ROOT, absPath).split(path.sep).join('/');
}

function extractJsonLdBlocks(html) {
  const blocks = [];
  const re = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g;
  let m;
  while ((m = re.exec(html))) {
    try {
      blocks.push(JSON.parse(m[1]));
    } catch {
      // Skip malformed blocks rather than failing the whole build.
    }
  }
  return blocks;
}

function extractTitle(html) {
  const m = /<title>([\s\S]*?)<\/title>/.exec(html);
  return m ? m[1].trim() : '';
}

function extractMetaDescription(html) {
  const m = /<meta name="description" content="([\s\S]*?)"\s*\/?>/.exec(html);
  return m ? m[1].trim() : '';
}

function decodeEntities(str) {
  return String(str)
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function processFile(absPath) {
  const html = fs.readFileSync(absPath, 'utf8');
  const url = urlFor(absPath);
  const title = decodeEntities(extractTitle(html));
  const description = decodeEntities(extractMetaDescription(html));
  const entries = [];

  const jsonLd = extractJsonLdBlocks(html);
  let faqCount = 0;
  for (const block of jsonLd) {
    if (block['@type'] === 'FAQPage' && Array.isArray(block.mainEntity)) {
      for (const q of block.mainEntity) {
        if (!q || q['@type'] !== 'Question') continue;
        const question = q.name || '';
        const answer = q.acceptedAnswer && q.acceptedAnswer.text ? q.acceptedAnswer.text : '';
        if (!question || !answer) continue;
        entries.push({
          url,
          pageTitle: title,
          question: decodeEntities(question),
          answer: decodeEntities(answer),
        });
        faqCount++;
      }
    }
  }

  // Always add one page-level fallback entry too (title + meta description),
  // so pages without FAQ schema (About, Home, Terms, etc.) are still
  // searchable, and so a very broad query has something page-level to land
  // on even for FAQ-heavy pages.
  if (title || description) {
    entries.push({
      url,
      pageTitle: title,
      question: title,
      answer: description || title,
    });
  }

  return entries;
}

function walk(dir, out) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      walk(full, out);
    } else if (name.endsWith('.html')) {
      out.push(full);
    }
  }
}

const files = [];
walk(PAGES_DIR, files);
// Also include the homepage.
const indexHtml = path.join(ROOT, 'index.html');
if (fs.existsSync(indexHtml)) files.push(indexHtml);

let allEntries = [];
for (const f of files) {
  // Skip admin/private pages — nothing in them should be surfaced to an
  // anonymous chat visitor as a "here's what I found on our site" answer.
  if (f.includes(`${path.sep}admin.html`)) continue;
  allEntries = allEntries.concat(processFile(f));
}

fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
fs.writeFileSync(OUT_FILE, JSON.stringify(allEntries), 'utf8');
console.log(`Wrote ${allEntries.length} indexed entries from ${files.length} pages to ${urlFor(OUT_FILE)}`);
