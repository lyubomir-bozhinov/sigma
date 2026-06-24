// Converts a trusted-subset of markdown to safe HTML for server-side rendering.
//
// Security guarantees:
//   - Raw HTML in the source is NEVER parsed or emitted.  All < > characters are
//     HTML-escaped before any markdown token is processed, so `<script>…` in the
//     source becomes &lt;script&gt;… in the output.
//   - Link protocol allowlist: only absolute http:// and https:// URLs become <a>
//     elements.  Any other scheme (javascript:, data:, vbscript:, relative paths, …)
//     is rendered as plain escaped text with no anchor element.
//
// Supported markdown subset (matches the AI report block vocabulary):
//   # h1 → <h2>, ## → <h3>, ### → <h4>  (h1 reserved for the page title)
//   **bold** / __bold__, *italic* / _italic_, `inline code`
//   [label](url), - / * unordered lists, 1. ordered lists, > blockquote, paragraphs.

const ALLOWED_PROTOCOLS = new Set(['https:', 'http:']);

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Returns the URL unchanged if it is absolute with an allowed protocol, or null.
// Uses URL parsing (not regex) so percent-encoding, tab-injection, and
// protocol-confusion tricks are covered by the spec-compliant parser.
function safeHref(raw: string): string | null {
  const url = raw.trim();
  if (!url) return null;
  try {
    const parsed = new URL(url); // throws for relative URLs → null
    return ALLOWED_PROTOCOLS.has(parsed.protocol) ? url : null;
  } catch {
    return null;
  }
}

// Applies bold / italic / code spans to an already-HTML-escaped string.
// Links are NOT handled here — they are extracted from raw text in renderLine.
function renderSpans(escaped: string): string {
  return escaped
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*(.+?)\*\*/gs, '<strong>$1</strong>')
    .replace(/__(.+?)__/gs, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/gs, '<em>$1</em>')
    .replace(/_(.+?)_/gs, '<em>$1</em>');
}

// Converts one raw markdown line to safe HTML, handling links before escaping so
// the raw URL reaches safeHref unaltered (no & → &amp; corruption).
function renderLine(raw: string): string {
  const parts: string[] = [];
  const linkRe = /\[([^\]]*)\]\(([^)]*)\)/g;
  let last = 0;

  for (const m of raw.matchAll(linkRe)) {
    if (m.index > last) parts.push(renderSpans(escapeHtml(raw.slice(last, m.index))));
    const href = safeHref(m[2]);
    const label = renderSpans(escapeHtml(m[1]));
    parts.push(
      href ? `<a href="${escapeHtml(href)}" rel="noopener noreferrer">${label}</a>` : label,
    );
    last = m.index + m[0].length;
  }

  if (last < raw.length) parts.push(renderSpans(escapeHtml(raw.slice(last))));
  return parts.join('');
}

export function sanitizeMarkdown(source: string): string {
  const lines = source.split('\n');
  const out: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const raw = lines[i];

    if (!raw.trim()) {
      i++;
      continue;
    }

    // Headings — # → h2 (h1 is page-title territory)
    const hm = /^(#{1,3}) (.+)/.exec(raw);
    if (hm) {
      const level = hm[1].length + 1;
      out.push(`<h${level}>${renderLine(hm[2])}</h${level}>`);
      i++;
      continue;
    }

    // Blockquote
    if (raw.startsWith('> ')) {
      const lines_: string[] = [];
      while (i < lines.length && lines[i].startsWith('> ')) {
        lines_.push(renderLine(lines[i].slice(2)));
        i++;
      }
      out.push(`<blockquote>${lines_.join('<br>')}</blockquote>`);
      continue;
    }

    // Unordered list
    if (/^[*-] /.test(raw)) {
      const items: string[] = [];
      while (i < lines.length && /^[*-] /.test(lines[i])) {
        items.push(`<li>${renderLine(lines[i].slice(2))}</li>`);
        i++;
      }
      out.push(`<ul>${items.join('')}</ul>`);
      continue;
    }

    // Ordered list
    if (/^\d+\. /.test(raw)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\. /.test(lines[i])) {
        items.push(`<li>${renderLine(lines[i].replace(/^\d+\. /, ''))}</li>`);
        i++;
      }
      out.push(`<ol>${items.join('')}</ol>`);
      continue;
    }

    // Paragraph — consume until blank line or block-level token
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !/^(#{1,3} |> |[*-] |\d+\. )/.test(lines[i])
    ) {
      para.push(renderLine(lines[i]));
      i++;
    }
    if (para.length) out.push(`<p>${para.join('<br>')}</p>`);
  }

  return out.join('\n');
}
