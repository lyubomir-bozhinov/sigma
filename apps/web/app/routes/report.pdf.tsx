// Resource route: renders /reports/:id.pdf via Cloudflare Browser Rendering.
// No React component — returns a binary PDF response directly.

import type { Route } from './+types/report.pdf';

export async function loader({ params, request, context }: Route.LoaderArgs) {
  const { id } = params;
  const env = context.cloudflare.env;

  if (!env.BROWSER) {
    return new Response('Browser Rendering не е конфигуриран на тази среда.', { status: 503 });
  }

  const { default: puppeteer } = await import('@cloudflare/puppeteer');
  const origin = new URL(request.url).origin;
  const browser = await puppeteer.launch(env.BROWSER);
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    await page.goto(`${origin}/reports/${encodeURIComponent(id)}`, {
      waitUntil: 'networkidle0',
      timeout: 30_000,
    });
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '18mm', bottom: '18mm', left: '20mm', right: '20mm' },
    });
    return new Response(pdf, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${id}.pdf"`,
        'Cache-Control': 'private, max-age=3600',
      },
    });
  } finally {
    await browser.close();
  }
}
