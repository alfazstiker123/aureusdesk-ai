'use client';

import { Children, cloneElement, createContext, isValidElement, useContext, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

// Label kolom tabel dibagikan ke setiap sel, dipakai tampilan kartu HP & tombol salin.
const HeadersCtx = createContext([]);

function textOf(n) {
  if (!n) return '';
  if (n.type === 'text') return n.value || '';
  return (n.children || []).map(textOf).join('');
}

function reactText(ch) {
  if (ch == null || typeof ch === 'boolean') return '';
  if (typeof ch === 'string' || typeof ch === 'number') return String(ch);
  if (Array.isArray(ch)) return ch.map(reactText).join('');
  if (isValidElement(ch)) return reactText(ch.props.children);
  return '';
}

function headersFromTable(node) {
  const thead = (node?.children || []).find((c) => c.tagName === 'thead');
  const tr = (thead?.children || []).find((c) => c.tagName === 'tr');
  return (tr?.children || []).filter((c) => c.tagName === 'th' || c.tagName === 'td').map((c) => textOf(c).trim());
}

// Kolom mana yang perlu tombol salin (harga untuk diketik/tempel ke MT4)
function copyKind(label = '') {
  const l = label.toLowerCase();
  if (/jarak|risiko|r:r|syarat|konfirmasi|arah|strategi|catatan/.test(l)) return null;
  if (/\blot\b/.test(l)) return 'lot';
  if (/entry|stop loss|\bsl\b|take profit|\btp\d?\b/.test(l)) return 'price';
  return null;
}

function extractValues(text, kind) {
  const re = kind === 'lot' ? /\d+\.\d{2}/g : /\d{3,5}(?:\.\d+)?/g;
  return [...new Set(text.match(re) || [])];
}

async function copyText(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* lanjut ke fallback */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;font-size:16px';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

function CopyBtn({ value, showValue }) {
  const [state, setState] = useState('idle'); // idle | ok | fail
  const timer = useRef(null);

  const onClick = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    const ok = await copyText(value);
    try {
      if (ok && navigator.vibrate) navigator.vibrate(15);
    } catch {}
    setState(ok ? 'ok' : 'fail');
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setState('idle'), 1400);
  };

  return (
    <button
      type="button"
      onClick={onClick}
      title={`Salin ${value}`}
      aria-label={`Salin ${value}`}
      className={`copy-btn ${state === 'ok' ? 'is-ok' : ''} ${state === 'fail' ? 'is-fail' : ''}`}
    >
      <span aria-hidden="true">{state === 'ok' ? '✓' : state === 'fail' ? '!' : '📋'}</span>
      {showValue && <span className="copy-val">{state === 'ok' ? 'Tersalin' : value}</span>}
      {!showValue && state === 'ok' && <span className="copy-val">Tersalin</span>}
    </button>
  );
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
    const mapped = Children.map(children, (c) => {
      if (!isValidElement(c)) return c;
      const label = headers[i++] || '';
      const kind = c.type === 'td' ? copyKind(label) : null;
      const values = kind ? extractValues(reactText(c.props.children), kind) : [];

      if (values.length) {
        return cloneElement(
          c,
          { 'data-label': label },
          <span className="cv pcell">
            <span className="ptxt">{c.props.children}</span>
            <span className="pbtns">
              {values.map((v) => (
                <CopyBtn key={v} value={v} showValue={values.length > 1} />
              ))}
            </span>
          </span>
        );
      }
      return cloneElement(
        c,
        { 'data-label': label },
        // Bungkus isi sel jadi satu blok agar teks campuran (biasa + miring + tebal)
        // tidak terpecah menjadi kolom-kolom terpisah pada tampilan kartu HP.
        <span className="cv">{c.props.children}</span>
      );
    });
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
