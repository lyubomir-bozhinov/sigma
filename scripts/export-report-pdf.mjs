#!/usr/bin/env node
/**
 * Export a Sigma AI report as PDF using the local dev server + puppeteer-core.
 *
 * Usage:
 *   node scripts/export-report-pdf.mjs [report-id] [output.pdf]
 *
 * Defaults:
 *   report-id  → mock-medisistem-2024
 *   output     → scripts/mock-medisistem-2024.pdf
 *
 * Requires:
 *   pnpm add -D puppeteer-core   (one-time)
 *   Dev server running on localhost:5173
 */

import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

// ── Config ────────────────────────────────────────────────────────────────────

const REPORT_ID = process.argv[2] ?? 'mock-medisistem-2024';
const OUT_PATH  = process.argv[3] ?? path.join(__dirname, `${REPORT_ID}.pdf`);
const BASE_URL  = process.env.SIGMA_DEV_URL ?? 'http://localhost:5173';
const URL       = `${BASE_URL}/reports/${REPORT_ID}`;

const CHROME_PATHS = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
];

// ── Resolve puppeteer-core ────────────────────────────────────────────────────

let puppeteer;
try {
  puppeteer = await import('puppeteer-core');
  puppeteer = puppeteer.default ?? puppeteer;
} catch {
  console.error(
    '✗ puppeteer-core not found.\n' +
    '  Run: npx pnpm@10 add -D puppeteer-core --filter @sigma/web\n' +
    '  or:  npm install -g puppeteer-core',
  );
  process.exit(1);
}

// ── Find Chrome ───────────────────────────────────────────────────────────────

const executablePath = CHROME_PATHS.find(p => fs.existsSync(p));
if (!executablePath) {
  console.error('✗ No Chrome binary found. Set PUPPETEER_EXECUTABLE_PATH env var.');
  process.exit(1);
}

// ── Generate PDF ──────────────────────────────────────────────────────────────

console.log(`→ Fetching ${URL}`);

const browser = await puppeteer.launch({
  executablePath,
  headless: 'new',
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
});

const page = await browser.newPage();
page.on('console', msg => { if (msg.type() === 'error') console.error('  browser:', msg.text()); });

await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30_000 });

// Wait for the first report block to confirm the report rendered, not the error page.
try {
  await page.waitForSelector('.report-blocks', { timeout: 10_000 });
} catch {
  console.error('✗ .report-blocks not found — is the dev server running and the report seeded?');
  await browser.close();
  process.exit(1);
}

// Hide the chat dock and watermark from the PDF.
await page.addStyleTag({ content: `
  .chat-dock { display: none !important; }
  .route-progress { display: none !important; }
  @media print {
    .site-header, .site-footer, .search-drawer { display: none !important; }
    .report-watermark { font-size: 9pt; opacity: 0.5; }
    .report-page { padding: 0; }
  }
` });

const pdf = await page.pdf({
  format: 'A4',
  printBackground: true,
  margin: { top: '1.5cm', bottom: '1.5cm', left: '1.5cm', right: '1.5cm' },
  displayHeaderFooter: true,
  headerTemplate: `<div style="font-size:8pt;color:#888;width:100%;text-align:center;">СИГМА — AI-генерирано, неофициално</div>`,
  footerTemplate: `<div style="font-size:8pt;color:#888;width:100%;text-align:right;padding-right:1.5cm;"><span class="pageNumber"></span> / <span class="totalPages"></span></div>`,
});

await browser.close();

fs.writeFileSync(OUT_PATH, pdf);
console.log(`✓ Saved → ${OUT_PATH} (${(pdf.length / 1024).toFixed(0)} KB)`);
