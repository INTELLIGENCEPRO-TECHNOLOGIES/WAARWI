export function renderMarkdown(md: string): string {
  if (!md || !md.trim()) return '';

  const escapeHtml = (s: string): string =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const inline = (text: string): string => {
    let t = escapeHtml(text);
    t = t.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label: string, url: string) => {
      if (/^https?:\/\//i.test(url) || /^mailto:/i.test(url)) {
        return `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${label}</a>`;
      }
      return label;
    });
    t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    t = t.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    return t;
  };

  const lines = md.split('\n');
  const out: string[] = [];
  let inUl = false;
  let inOl = false;
  let para: string[] = [];

  const flushPara = () => {
    if (para.length > 0) {
      out.push(`<p>${inline(para.join(' '))}</p>`);
      para = [];
    }
  };
  const closeLists = () => {
    if (inUl) { out.push('</ul>'); inUl = false; }
    if (inOl) { out.push('</ol>'); inOl = false; }
  };

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) { flushPara(); closeLists(); continue; }

    const h = line.match(/^(#{1,3})\s+(.+)$/);
    if (h) {
      flushPara(); closeLists();
      out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`);
      continue;
    }

    if (/^[-*]\s+/.test(line)) {
      flushPara();
      if (inOl) { out.push('</ol>'); inOl = false; }
      if (!inUl) { out.push('<ul>'); inUl = true; }
      out.push(`<li>${inline(line.replace(/^[-*]\s+/, ''))}</li>`);
      continue;
    }

    if (/^\d+\.\s+/.test(line)) {
      flushPara();
      if (inUl) { out.push('</ul>'); inUl = false; }
      if (!inOl) { out.push('<ol>'); inOl = true; }
      out.push(`<li>${inline(line.replace(/^\d+\.\s+/, ''))}</li>`);
      continue;
    }

    closeLists();
    para.push(line.trim());
  }
  flushPara();
  closeLists();

  return out.join('\n');
}
