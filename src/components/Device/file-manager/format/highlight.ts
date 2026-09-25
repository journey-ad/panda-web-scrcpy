import hljs from 'highlight.js/lib/common';

/** hljs 只往文字里插 span，按换行切开后每行自行补上未闭合的标签 */
const LINE_TOKEN = /<span[^>]*>|<\/span>|\n/g;

const splitLines = (html: string) => {
  const lines: string[] = [];
  const open: string[] = [];
  let current = '';
  let last = 0;
  for (const match of html.matchAll(LINE_TOKEN)) {
    const token = match[0];
    const at = match.index ?? 0;
    current += html.slice(last, at);
    last = at + token.length;
    if (token === '\n') {
      lines.push(current + '</span>'.repeat(open.length));
      current = open.join('');
      continue;
    }
    if (token === '</span>') open.pop();
    else open.push(token);
    current += token;
  }
  current += html.slice(last);
  lines.push(current + '</span>'.repeat(open.length));
  return lines;
};

/** 按语言高亮并切成逐行，行内的标签各自闭合，行仍可折行显示 */
export const highlightLines = (text: string, language: string) => {
  const name = hljs.getLanguage(language) ? language : 'plaintext';
  return splitLines(hljs.highlight(text, { language: name, ignoreIllegals: true }).value);
};
