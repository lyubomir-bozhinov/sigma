import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

const ALLOWED_SCHEMES = /^(https?|mailto):/i;

export const MarkdownRenderer = ({ children }: { children: string }) => (
  <ReactMarkdown
    remarkPlugins={[remarkGfm]}
    components={{
      a: ({ href, children: c }) => {
        const safe = href && ALLOWED_SCHEMES.test(href) ? href : undefined;
        return safe ? (
          <a href={safe} target="_blank" rel="noopener noreferrer">
            {c}
          </a>
        ) : (
          <span>{c}</span>
        );
      },
      table: ({ children: c }) => (
        <div className="md-table-wrap">
          <table>{c}</table>
        </div>
      ),
    }}
  >
    {children}
  </ReactMarkdown>
);
