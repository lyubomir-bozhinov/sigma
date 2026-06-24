import { describe, expect, it } from 'vitest';
import { sanitizeMarkdown } from './sanitize-markdown';

describe('sanitizeMarkdown — HTML injection', () => {
  it('escapes raw HTML tags', () => {
    const out = sanitizeMarkdown('<script>alert(1)</script>');
    expect(out).not.toContain('<script>');
    expect(out).toContain('&lt;script&gt;');
  });

  it('escapes angle brackets inside paragraphs', () => {
    const out = sanitizeMarkdown('a < b > c');
    expect(out).toContain('&lt;');
    expect(out).toContain('&gt;');
  });

  it('escapes HTML in bold spans', () => {
    const out = sanitizeMarkdown('**<b>inject</b>**');
    expect(out).toContain('&lt;b&gt;');
    expect(out).not.toContain('<b>');
  });

  it('escapes HTML in link labels', () => {
    const out = sanitizeMarkdown('[<img src=x onerror=alert(1)>](https://example.com)');
    expect(out).not.toContain('<img');
    expect(out).toContain('&lt;img');
  });

  it('escapes ampersands', () => {
    const out = sanitizeMarkdown('A & B');
    expect(out).toContain('&amp;');
  });
});

describe('sanitizeMarkdown — link protocol gate', () => {
  it('allows https:// links', () => {
    const out = sanitizeMarkdown('[СИГМА](https://sigma.midt.bg)');
    expect(out).toContain('<a href="https://sigma.midt.bg"');
    expect(out).toContain('rel="noopener noreferrer"');
  });

  it('allows http:// links', () => {
    const out = sanitizeMarkdown('[link](http://example.com)');
    expect(out).toContain('<a href="http://example.com"');
  });

  it('refuses javascript: protocol — renders label only', () => {
    const out = sanitizeMarkdown('[click](javascript:alert(1))');
    expect(out).not.toContain('<a');
    expect(out).not.toContain('javascript:');
    expect(out).toContain('click');
  });

  it('refuses data: URI', () => {
    const out = sanitizeMarkdown('[x](data:text/html,<script>alert(1)</script>)');
    expect(out).not.toContain('<a');
    expect(out).not.toContain('data:');
  });

  it('refuses vbscript: protocol', () => {
    const out = sanitizeMarkdown('[x](vbscript:msgbox(1))');
    expect(out).not.toContain('<a');
  });

  it('refuses relative paths', () => {
    const out = sanitizeMarkdown('[x](/contracts/123)');
    expect(out).not.toContain('<a');
    expect(out).toContain('x');
  });

  it('refuses bare anchor fragments', () => {
    const out = sanitizeMarkdown('[x](#section)');
    expect(out).not.toContain('<a');
  });

  it('preserves & in href intact (no double-escaping in URL)', () => {
    const out = sanitizeMarkdown('[x](https://example.com/path?a=1&b=2)');
    // href attribute value gets the & entity-encoded; raw URL is passed to safeHref unchanged
    expect(out).toContain('href="https://example.com/path?a=1&amp;b=2"');
  });
});

describe('sanitizeMarkdown — inline spans', () => {
  it('renders **bold**', () => {
    expect(sanitizeMarkdown('**bold**')).toContain('<strong>bold</strong>');
  });

  it('renders __bold__', () => {
    expect(sanitizeMarkdown('__bold__')).toContain('<strong>bold</strong>');
  });

  it('renders *italic*', () => {
    expect(sanitizeMarkdown('*italic*')).toContain('<em>italic</em>');
  });

  it('renders `code`', () => {
    expect(sanitizeMarkdown('`code`')).toContain('<code>code</code>');
  });
});

describe('sanitizeMarkdown — block elements', () => {
  it('wraps plain text in <p>', () => {
    expect(sanitizeMarkdown('hello world')).toBe('<p>hello world</p>');
  });

  it('renders # as h2 (not h1 — reserved for page title)', () => {
    expect(sanitizeMarkdown('# Title')).toContain('<h2>');
    expect(sanitizeMarkdown('# Title')).not.toContain('<h1>');
  });

  it('renders ## as h3', () => {
    expect(sanitizeMarkdown('## Sub')).toContain('<h3>');
  });

  it('renders ### as h4', () => {
    expect(sanitizeMarkdown('### Deep')).toContain('<h4>');
  });

  it('renders unordered list', () => {
    const out = sanitizeMarkdown('- first\n- second');
    expect(out).toContain('<ul>');
    expect(out).toContain('<li>first</li>');
    expect(out).toContain('<li>second</li>');
  });

  it('renders ordered list', () => {
    const out = sanitizeMarkdown('1. one\n2. two');
    expect(out).toContain('<ol>');
    expect(out).toContain('<li>one</li>');
    expect(out).toContain('<li>two</li>');
  });

  it('renders blockquote', () => {
    const out = sanitizeMarkdown('> quoted text');
    expect(out).toContain('<blockquote>');
    expect(out).toContain('quoted text');
  });

  it('ignores blank lines between blocks', () => {
    const out = sanitizeMarkdown('first\n\nsecond');
    expect(out).toContain('<p>first</p>');
    expect(out).toContain('<p>second</p>');
  });
});
