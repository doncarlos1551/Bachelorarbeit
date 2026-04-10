// Leichtgewichtiger Markdown-Renderer ohne externe Abhängigkeit.

const escapeHtml = (s: string): string =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const safeUrl = (url: string): string => {
  const trimmed = url.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return '#';
};

const renderInline = (escaped: string): string => {
  let html = escaped;
  // Code zuerst, schützt inhalt vor weiterer Regex
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  html = html.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    (_m, text: string, url: string) =>
      `<a href="${safeUrl(url)}" target="_blank" rel="noopener noreferrer">${text}</a>`,
  );
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  // Italic nach Bold, sonst greift **
  html = html.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  html = html.replace(/(^|[^_])_([^_\n]+)_/g, '$1<em>$2</em>');
  return html;
};

interface ListBuffer {
  kind: 'ul' | 'ol';
  items: string[];
}

const flushList = (out: string[], buf: ListBuffer | null): ListBuffer | null => {
  if (!buf) return null;
  const tag = buf.kind;
  out.push(`<${tag}>${buf.items.map((i) => `<li>${i}</li>`).join('')}</${tag}>`);
  return null;
};

export const renderMarkdown = (raw: string): string => {
  if (!raw) return '';
  const lines = raw.replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  let listBuf: ListBuffer | null = null;
  let paragraphBuf: string[] = [];

  const flushParagraph = (): void => {
    if (paragraphBuf.length === 0) return;
    const inner = paragraphBuf.map((l) => renderInline(escapeHtml(l))).join('<br>');
    out.push(`<p>${inner}</p>`);
    paragraphBuf = [];
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === '') {
      listBuf = flushList(out, listBuf);
      flushParagraph();
      continue;
    }

    const headingMatch = trimmed.match(/^(#{1,3})\s+(.+)$/);
    if (headingMatch) {
      listBuf = flushList(out, listBuf);
      flushParagraph();
      const level = headingMatch[1]?.length ?? 1;
      const tag = level === 1 ? 'h4' : level === 2 ? 'h5' : 'h6';
      out.push(`<${tag}>${renderInline(escapeHtml(headingMatch[2] ?? ''))}</${tag}>`);
      continue;
    }

    const ulMatch = trimmed.match(/^[-*]\s+(.+)$/);
    if (ulMatch) {
      flushParagraph();
      if (!listBuf || listBuf.kind !== 'ul')
        listBuf = flushList(out, listBuf) ?? { kind: 'ul', items: [] };
      if (!listBuf) listBuf = { kind: 'ul', items: [] };
      if (listBuf.kind !== 'ul') {
        listBuf = flushList(out, listBuf);
        listBuf = { kind: 'ul', items: [] };
      }
      listBuf.items.push(renderInline(escapeHtml(ulMatch[1] ?? '')));
      continue;
    }

    const olMatch = trimmed.match(/^\d+\.\s+(.+)$/);
    if (olMatch) {
      flushParagraph();
      if (!listBuf || listBuf.kind !== 'ol') {
        listBuf = flushList(out, listBuf);
        listBuf = { kind: 'ol', items: [] };
      }
      listBuf.items.push(renderInline(escapeHtml(olMatch[1] ?? '')));
      continue;
    }

    listBuf = flushList(out, listBuf);
    paragraphBuf.push(line);
  }

  listBuf = flushList(out, listBuf);
  flushParagraph();

  return out.join('');
};
