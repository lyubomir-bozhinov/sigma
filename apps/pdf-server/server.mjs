#!/usr/bin/env node
/**
 * PDF export server for Sigma AI reports.
 *
 * GET /pdf/:reportId  → streams the report page as an A4 PDF.
 *
 * Environment variables:
 *   PORT              — default 5174
 *   SIGMA_WEB_URL     — base URL of the web app, default http://localhost:5173
 *   CHROME_PATH       — override Chrome binary path
 */

import http from 'node:http';
import fs from 'node:fs';

const PORT = Number(process.env.PORT ?? 5174);
const WEB_URL = process.env.SIGMA_WEB_URL ?? 'http://localhost:5173';

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
].filter(Boolean);

const executablePath = CHROME_CANDIDATES.find((p) => fs.existsSync(p));
if (!executablePath) {
  console.error('✗ No Chrome binary found. Set CHROME_PATH env var.');
  process.exit(1);
}

let puppeteer;
try {
  const mod = await import('puppeteer-core');
  puppeteer = mod.default ?? mod;
} catch {
  console.error('✗ puppeteer-core not installed. Run: pnpm install');
  process.exit(1);
}

async function generatePdf(reportId) {
  const url = `${WEB_URL}/reports/${reportId}`;
  const browser = await puppeteer.launch({
    executablePath,
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'networkidle0', timeout: 30_000 });

    // Confirm the report rendered (not an error page).
    await page.waitForSelector('.report-blocks', { timeout: 10_000 });

    // Hide chrome elements from the PDF — @media print in app.css handles most;
    // this catches anything that survives the media query.
    await page.addStyleTag({
      content: `
        @media print {
          .chat-dock, .accessibility-widget { display: none !important; }
        }
      `,
    });

    return await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '1.5cm', bottom: '1.5cm', left: '1.5cm', right: '1.5cm' },
      displayHeaderFooter: true,
      headerTemplate: `<div style="font-size:8pt;color:#888;width:100%;text-align:center;padding:0 1.5cm;">СИГМА — AI-генерирано, неофициално</div>`,
      footerTemplate: `<div style="font-size:8pt;color:#888;width:100%;text-align:right;padding-right:1.5cm;"><span class="pageNumber"></span> / <span class="totalPages"></span></div>`,
    });
  } finally {
    await browser.close();
  }
}

const server = http.createServer(async (req, res) => {
  // CORS for local dev (web app on :5173 calling pdf-server on :5174).
  res.setHeader('Access-Control-Allow-Origin', WEB_URL);
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const match = req.url?.match(/^\/pdf\/([^/?#]+)$/);
  if (!match) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found. Use GET /pdf/:reportId');
    return;
  }

  const reportId = decodeURIComponent(match[1]);
  console.log(`→ PDF  ${reportId}`);

  try {
    const pdf = await generatePdf(reportId);
    res.writeHead(200, {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${reportId}.pdf"`,
      'Content-Length': pdf.length,
    });
    res.end(pdf);
    console.log(`✓ PDF  ${reportId}  (${(pdf.length / 1024).toFixed(0)} KB)`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`✗ PDF  ${reportId}  ${msg}`);
    res.writeHead(502, { 'Content-Type': 'text/plain' });
    res.end(`PDF generation failed: ${msg}`);
  }
});

server.listen(PORT, () => {
  console.log(`pdf-server  http://localhost:${PORT}  →  ${WEB_URL}`);
});
