// Reading-time arithmetic. Chinese/Japanese/Korean are counted per character,
// everything else per word, because a "word" means nothing in CJK text.

const CJK = /[぀-ヿ㐀-䶿一-鿿豈-﫿가-힯]/u;
const CJK_G = new RegExp(CJK.source, "gu");
const WORD = /[\p{L}\p{N}][\p{L}\p{N}'’._-]*/gu;

/** Split text into reading tokens: one per CJK character, one per non-CJK word. */
export function tokens(text) {
  if (!text) return [];
  const out = [];
  for (const ch of text.match(CJK_G) ?? []) out.push(ch);
  const rest = text.replace(CJK_G, " ");
  for (const w of rest.match(WORD) ?? []) out.push(w.toLowerCase());
  return out;
}

export function isCjk(token) {
  return CJK.test(token);
}

/** Tokens in `next` that `prev` does not already show (multiset difference). */
export function newTokens(prev, next) {
  const left = new Map();
  for (const t of prev) left.set(t, (left.get(t) ?? 0) + 1);
  const out = [];
  for (const t of next) {
    const n = left.get(t) ?? 0;
    if (n > 0) left.set(t, n - 1);
    else out.push(t);
  }
  return out;
}

/** Seconds a viewer needs to read these tokens. */
export function readingSeconds(toks, speed) {
  let cjk = 0;
  let words = 0;
  for (const t of toks) (isCjk(t) ? cjk++ : words++);
  return cjk / speed.cjkCharsPerSecond + words / speed.wordsPerSecond;
}

/** Visible text of an HTML fragment (scripts, styles and tags dropped). */
export function htmlText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

/** Caption length in the unit a reader feels: CJK chars + non-CJK words. */
export function captionSize(text) {
  const t = tokens(text);
  return { cjk: t.filter(isCjk).length, words: t.filter((x) => !isCjk(x)).length };
}
