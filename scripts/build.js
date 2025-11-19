// scripts/build.js
// Reads ./entries/*.md/.html and injects content into data.html's <main id="projectContent">,
// writing full pages to ./dist (or change OUT_DIR to overwrite entries).

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const { marked } = require('marked');
const slugify = require('slugify');
const matter = require('gray-matter');

const ROOT = process.cwd();
const ENTRIES_DIR = path.join(ROOT, 'entries');
const TEMPLATE_PATH = path.join(ROOT, 'data.html');
const OUT_DIR = path.join(ROOT, 'dist'); // change this to 'entries' if you want to overwrite
const SUPPORTED = ['.md', '.html', '.htm'];

if (!fs.existsSync(TEMPLATE_PATH)) {
  console.error('Template (data.html) not found at', TEMPLATE_PATH);
  process.exit(1);
}
if (!fs.existsSync(ENTRIES_DIR)) {
  console.error('Entries directory not found at', ENTRIES_DIR);
  process.exit(1);
}
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

const templateHtml = fs.readFileSync(TEMPLATE_PATH, 'utf8');

function renderEntry(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const raw = fs.readFileSync(filePath, 'utf8');

  if (ext === '.md') {
    // allow front-matter (title, date, etc.)
    const parsed = matter(raw);
    const html = marked.parse(parsed.content);
    return { html, meta: parsed.data || {} };
  }

  // .html snippet (treat as already HTML)
  return { html: raw, meta: {} };
}

function injectIntoTemplate(template, entryHtml) {
  // Use JSDOM to replace innerHTML of #projectContent
  const dom = new JSDOM(template);
  const doc = dom.window.document;
  const target = doc.querySelector('#projectContent');

  if (!target) {
    // fallback: try to replace comment <!--ENTRY_CONTENT--> or append to body
    if (template.includes('<!--ENTRY_CONTENT-->')) {
      return template.replace('<!--ENTRY_CONTENT-->', entryHtml);
    }
    if (template.includes('<!--CONTENT-->')) {
      return template.replace('<!--CONTENT-->', entryHtml);
    }
    if (doc.body) {
      const wrapper = doc.createElement('div');
      wrapper.id = 'entry-content';
      wrapper.innerHTML = entryHtml;
      doc.body.appendChild(wrapper);
      return dom.serialize();
    }
    // last resort
    return template + '\n' + entryHtml;
  }

  target.innerHTML = entryHtml;
  return dom.serialize();
}

function extractTitleFromHtml(html) {
  try {
    const dom = new JSDOM(html);
    const doc = dom.window.document;
    const h = doc.querySelector('h1, h2');
    if (h && h.textContent.trim()) return h.textContent.trim();
  } catch (e) {}
  return null;
}

function setTitleInDocument(fullHtml, title) {
  if (!title) return fullHtml;
  const dom = new JSDOM(fullHtml);
  const doc = dom.window.document;
  if (doc.querySelector('title')) {
    doc.querySelector('title').textContent = title;
  } else {
    const t = doc.createElement('title');
    t.textContent = title;
    doc.head.appendChild(t);
  }
  return dom.serialize();
}

function build() {
  const files = fs.readdirSync(ENTRIES_DIR);
  const entryFiles = files.filter(f => SUPPORTED.includes(path.extname(f).toLowerCase()));
  if (entryFiles.length === 0) {
    console.log('No entry files found in', ENTRIES_DIR);
    return;
  }

  const generated = [];

  for (const file of entryFiles) {
    const full = path.join(ENTRIES_DIR, file);
    const basename = path.basename(file, path.extname(file));
    const slug = slugify(basename, { lower: true, strict: true });

    const { html: entryHtml, meta } = renderEntry(full);

    // If entryHtml is a snippet which references relative assets, you may need to adjust paths.
    // Consider adding <base href="../"> to the template head if you output to dist/.
    let finalHtml = injectIntoTemplate(templateHtml, entryHtml);

    // Title priority: front-matter title -> first heading in entry -> filename
    let title = meta.title || extractTitleFromHtml(entryHtml) || basename;
    finalHtml = setTitleInDocument(finalHtml, title);

    // Write file
    const outFilename = `${slug}.html`;
    const outPath = path.join(OUT_DIR, outFilename);
    fs.writeFileSync(outPath, finalHtml, 'utf8');
    console.log('Wrote', outPath);
    generated.push(outFilename);
  }

  console.log('Generated', generated.length, 'files:', generated.join(', '));
}

build();
