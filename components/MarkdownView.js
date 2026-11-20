'use client';

import { Children, cloneElement, createContext, isValidElement, useContext } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

// Label kolom tabel dibagikan ke setiap sel, dipakai tampilan kartu di HP.
const HeadersCtx = createContext([]);

function textOf(n) {
  if (!n) return '';
  if (n.type === 'text') return n.value || '';
  return (n.children || []).map(textOf).join('');
}

function headersFromTable(node) {
  const thead = (node?.children || []).find((c) => c.tagName === 'thead');
  const tr = (thead?.children || []).find((c) => c.tagName === 'tr');
  return (tr?.children || []).filter((c) => c.tagName === 'th' || c.tagName === 'td').map((c) => textOf(c).trim());
}

const components = {
  table: ({ node, children, ...props }) => (
    <HeadersCtx.Provider value={headersFromTable(node)}>
      <div className="table-wrap">
        <table {...props}>{children}</table>
      </div>
    </HeadersCtx.Provider>
  ),
  tr: ({ node, children, ...props }) => {
    const headers = useContext(HeadersCtx);
    let i = 0;
    const mapped = Children.map(children, (c) =>
      isValidElement(c)
        ? cloneElement(
            c,
            { 'data-label': headers[i++] || '' },
            // Bungkus isi sel jadi satu blok agar teks campuran (biasa + miring + tebal)
            // tidak terpecah menjadi kolom-kolom terpisah pada tampilan kartu HP.
            <span className="cv">{c.props.children}</span>
          )
        : c
    );
    return <tr {...props}>{mapped}</tr>;
  },
  a: ({ node, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer" />,
};

export default function MarkdownView({ content }) {
  return (
    <div className="md">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content || ''}
      </ReactMarkdown>
    </div>
  );
}
