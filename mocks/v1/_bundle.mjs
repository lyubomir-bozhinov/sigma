#!/usr/bin/env node
// Bundles all live pages into a single export/index.html SPA.
// Pages share one inlined stylesheet + one router. Cross-page links are
// rewritten from .html paths to hash routes; in-page anchors and inert
// `?sort=` filters are preserved (the latter become no-ops on the SPA).

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const ROOT = dirname(fileURLToPath(import.meta.url));

// Page slug → source file. Order = nav order on the bundled header.
const PAGES = [
  { slug: "home",          file: "index.html",        title: "Сигма — Платформа за прозрачни възлагания", nav: "Начало" },
  { slug: "authorities",   file: "authorities.html",  title: "Институции — Сигма",                       nav: "Институции" },
  { slug: "companies",     file: "companies.html",    title: "Компании — Сигма",                         nav: "Компании" },
  { slug: "contracts",     file: "contracts.html",    title: "Договори — Сигма",                         nav: "Договори" },
  { slug: "flows",         file: "flows.html",        title: "Потоци на пари — Сигма",                   nav: "Потоци" },
  { slug: "methodology",   file: "methodology.html",  title: "Методология и речник — Сигма",             nav: "Методология" },
  // Detail/list/search pages — addressable but not in the top nav.
  { slug: "authority",     file: "authority.html",    title: "Община Благоевград — Сигма",               nav: null },
  { slug: "company",       file: "company.html",      title: "ГБС Инфраструктурно строителство АД — Сигма", nav: null },
  { slug: "contract",      file: "contract.html",     title: "Инженеринг АМ „Хемус“ Лот 6 — Сигма",      nav: null },
  { slug: "search",        file: "search.html",       title: "Търсене — Сигма",                          nav: null },
];

const SLUGS = new Set(PAGES.map((p) => p.slug));
const FILE_TO_SLUG = new Map(PAGES.map((p) => [p.file, p.slug]));

const css = readFileSync(resolve(ROOT, "assets/styles.css"), "utf8");
const siteJs = readFileSync(resolve(ROOT, "assets/site.js"), "utf8");

function extractBetween(s, open, close) {
  const i = s.indexOf(open);
  if (i === -1) return "";
  const j = s.indexOf(close, i + open.length);
  if (j === -1) return "";
  return s.slice(i + open.length, j);
}

function extractTag(s, openRe, closeTag) {
  const m = s.match(openRe);
  if (!m) return "";
  const start = m.index;
  const closeIdx = s.indexOf(closeTag, start);
  if (closeIdx === -1) return "";
  return s.slice(start, closeIdx + closeTag.length);
}

// Pull all <style>…</style> blocks from <head>.
function extractHeadStyles(html) {
  const head = extractBetween(html, "<head>", "</head>");
  if (!head) return "";
  const out = [];
  const re = /<style[^>]*>([\s\S]*?)<\/style>/g;
  let m;
  while ((m = re.exec(head)) !== null) out.push(m[1]);
  return out.join("\n");
}

// Rewrite cross-page links + strip per-page aria-current from in-content anchors.
function rewriteLinks(html, currentSlug) {
  // href="file.html..." → href="#slug" data-page="slug" (drop the query string)
  let out = html.replace(/href="([a-z-]+)\.html(?:\?[^"]*)?"/g, (full, baseName) => {
    const fname = `${baseName}.html`;
    const slug = FILE_TO_SLUG.get(fname);
    if (!slug) return full; // unknown — leave alone
    return `href="#${slug}" data-page="${slug}"`;
  });

  // href="?…" (sort, page, filter querystrings without a base path) → keep on current page
  out = out.replace(/href="\?[^"]*"/g, `href="#${currentSlug}" data-page="${currentSlug}"`);

  // assets/styles.css link is dropped wholesale below; here also strip any stray
  // <link> referencing it that might appear elsewhere.
  out = out.replace(/<link[^>]+href="assets\/styles\.css"[^>]*>\s*/g, "");

  return out;
}

// Strip aria-current from in-page nav anchors — router will reassign.
function stripAriaCurrent(html) {
  return html.replace(/\s+aria-current="page"/g, "");
}

function extractMain(html) {
  // <main id="main"> … </main>
  const m = html.match(/<main[^>]*>[\s\S]*?<\/main>/);
  return m ? m[0] : "";
}

function extractCrumbs(html) {
  // crumbs sit between </header> and <main>; tag can be <div class="crumbs"> or <nav class="crumbs">.
  const headEnd = html.indexOf("</header>");
  const mainStart = html.indexOf("<main");
  if (headEnd === -1 || mainStart === -1 || mainStart < headEnd) return "";
  let slice = html.slice(headEnd + "</header>".length, mainStart);
  // Drop the per-page search drawer — bundle has a single shared one.
  slice = slice.replace(/<div class="search-drawer"[\s\S]*?<\/div>\s*/g, "");
  if (!/crumbs/.test(slice)) return "";
  return slice.trim();
}

// ---------- Build per-page sections ----------

const pageSections = [];
const allLocalStyles = [];
const titlesMap = {};

for (const p of PAGES) {
  const raw = readFileSync(resolve(ROOT, p.file), "utf8");
  const localCss = extractHeadStyles(raw);
  if (localCss.trim()) allLocalStyles.push(`/* ---- page-local: ${p.file} ---- */\n${localCss.trim()}`);

  const crumbs = stripAriaCurrent(rewriteLinks(extractCrumbs(raw), p.slug));
  // Make per-page <main id="main"> unique — the skip link is retargeted by the router.
  const mainRaw = extractMain(raw).replace(/<main id="main"/, `<main id="main-${p.slug}"`);
  const main = stripAriaCurrent(rewriteLinks(mainRaw, p.slug));

  titlesMap[p.slug] = p.title;

  pageSections.push(
    `  <div class="page" data-page="${p.slug}" id="page-${p.slug}">\n` +
    (crumbs ? `    ${crumbs}\n` : "") +
    `    ${main}\n` +
    `  </div>`
  );
}

// ---------- Build site header + footer (once) ----------

const navLinks = PAGES.filter((p) => p.nav).map(
  (p) => `        <a href="#${p.slug}" data-page="${p.slug}">${p.nav}</a>`
).join("\n");

const siteHeader = `  <header class="site-header" role="banner">
    <div class="site-header-inner">
      <a class="brand" href="#home" data-page="home" aria-label="Сигма — начална страница">
        <span class="brand-mark">Сигма</span>
        <span class="brand-sub">Платформа за прозрачни възлагания</span>
      </a>
      <nav class="site-nav" aria-label="Главна навигация">
${navLinks}
        <button class="nav-search" type="button" aria-label="Търсене" data-search-toggle aria-expanded="false" aria-controls="searchDrawer">
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" stroke-width="1.75"/><line x1="15.4" y1="15.4" x2="20" y2="20" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"/></svg>
        </button>
      </nav>
    </div>
  </header>

  <div class="search-drawer" id="searchDrawer" hidden>
    <form class="search-drawer-form" role="search" data-search-form>
      <span class="search-drawer-prompt" aria-hidden="true">›</span>
      <input type="search" name="q" placeholder="Институция, компания, ЕИК или № на договор…" aria-label="Търсене" autocomplete="off" />
      <button type="submit">Намери</button>
      <button type="button" class="search-drawer-close" aria-label="Затвори търсенето">×</button>
    </form>
  </div>`;

const siteFooter = `  <footer class="site-footer" role="contentinfo">
    <div class="site-footer-inner">
      <span>Източник: АОП · 2020–2024 · обновени 31.12.2024</span>
      <a href="#methodology" data-page="methodology">Методология</a>
    </div>
  </footer>`;

// ---------- Compose final document ----------

const routerCss = `
    /* ---- SPA router ---- */
    .page { display: none; }
    .page.is-active { display: block; }
`;

const routerJs = `
(function () {
  var TITLES = ${JSON.stringify(titlesMap, null, 2)};
  var DEFAULT = "home";
  var PAGES = ${JSON.stringify(PAGES.map((p) => p.slug))};
  var pages = document.querySelectorAll(".page");
  var navLinks = document.querySelectorAll(".site-nav a[data-page]");
  var skipLink = document.querySelector("a.skip");

  function showPage(name, pushHistory) {
    if (PAGES.indexOf(name) === -1) name = DEFAULT;
    pages.forEach(function (p) {
      p.classList.toggle("is-active", p.dataset.page === name);
    });
    navLinks.forEach(function (a) {
      if (a.dataset.page === name) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    });
    if (skipLink) skipLink.setAttribute("href", "#main-" + name);
    document.title = TITLES[name] || "Сигма";
    window.scrollTo(0, 0);
    if (pushHistory && location.hash !== "#" + name) {
      try { history.pushState({ page: name }, "", "#" + name); } catch (_) {}
    }
  }

  document.addEventListener("click", function (e) {
    var link = e.target.closest("a[data-page]");
    if (!link) return;
    var name = link.dataset.page;
    if (!name) return;
    e.preventDefault();
    showPage(name, true);
  });

  // Search form → search page (querystring ignored — list pages are static mocks).
  document.addEventListener("submit", function (e) {
    var form = e.target.closest("form[data-search-form]");
    if (!form) return;
    e.preventDefault();
    showPage("search", true);
  });

  window.addEventListener("popstate", function () {
    var name = (location.hash || "#" + DEFAULT).slice(1);
    showPage(name, false);
  });

  var initial = (location.hash || "#" + DEFAULT).slice(1);
  showPage(initial, false);
})();
`;

const doc = `<!doctype html>
<html lang="bg">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Сигма — Платформа за прозрачни възлагания</title>
  <style>
${css}
${routerCss}
${allLocalStyles.join("\n\n")}
  </style>
</head>
<body>
  <a class="skip" href="#main">Към съдържанието</a>

${siteHeader}

${pageSections.join("\n\n")}

${siteFooter}

  <script>${routerJs}</script>
  <script>${siteJs}</script>
</body>
</html>
`;

writeFileSync(resolve(ROOT, "export/index.html"), doc, "utf8");
console.log(`wrote export/index.html — ${doc.length} bytes, ${PAGES.length} pages bundled`);
