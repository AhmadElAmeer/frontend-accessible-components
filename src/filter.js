// Matching for the combobox: accent- and case-insensitive, word-aware, with
// highlight ranges that point back into the original label.
//
// "sao to" matches "São Tomé and Príncipe" and highlights "São To" — the
// ranges are in the original string even though matching happens on a folded
// copy ("sao tome and principe"), whose length can differ from the original.

/**
 * Fold a string for matching: decompose (NFD), drop combining marks, lower-case.
 * Returns the folded text and, for every folded character, the index of the
 * original character it came from (plus one entry for the end of the string).
 */
export function fold(text) {
  let out = "";
  const origin = [];
  let i = 0;
  for (const ch of text) {               // iterate by code point, not UTF-16 unit
    const folded = foldChar(ch);
    for (let k = 0; k < folded.length; k++) origin.push(i);
    out += folded;
    i += ch.length;
  }
  origin.push(text.length);
  return { text: out, origin };
}

const MARKS = /\p{M}/gu;
const APOSTROPHES = /[‘’ʼ]/g;

function foldChar(ch) {
  return ch.normalize("NFD").replace(MARKS, "").replace(APOSTROPHES, "'").toLowerCase();
}

/** Split a query into folded words; extra whitespace is ignored. */
export function queryWords(query) {
  return fold(query).text.split(/\s+/).filter(Boolean);
}

const isWordChar = (c) => c !== undefined && /[\p{L}\p{N}]/u.test(c);

/**
 * Match `query` against `label`. Every query word must occur in the label.
 * Returns null, or { score, ranges } where a lower score is a better match:
 *   0 — the label starts with the first word,
 *   1 — every word starts a word in the label,
 *   2 — some word only matches inside a word.
 * `ranges` are [start, end) pairs in the original label, sorted and merged.
 */
export function match(query, label) {
  const words = queryWords(query);
  if (words.length === 0) return { score: 0, ranges: [] };
  const { text, origin } = fold(label);
  let score = 0;
  const found = [];
  for (const [n, word] of words.entries()) {
    // Prefer an occurrence at the start of a word; fall back to any occurrence.
    let at = -1;
    for (let from = 0; ; from = at + 1) {
      at = text.indexOf(word, from);
      if (at === -1 || !isWordChar(text[at - 1])) break;
    }
    if (at === -1) {
      at = text.indexOf(word);
      if (at === -1) return null;
      score = 2;
    } else if (!(n === 0 && at === 0)) {
      score = Math.max(score, 1);
    }
    found.push([origin[at], origin[at + word.length]]);
  }
  return { score, ranges: mergeRanges(found) };
}

export function mergeRanges(ranges) {
  const sorted = [...ranges].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const out = [];
  for (const [s, e] of sorted) {
    const last = out[out.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else out.push([s, e]);
  }
  return out;
}

/**
 * Filter and rank items. `getLabel` maps an item to its text. Ties keep the
 * original order (Array.prototype.sort is stable), so a sensibly ordered list
 * stays sensibly ordered.
 */
export function filterItems(query, items, getLabel = String) {
  const hits = [];
  for (const item of items) {
    const label = getLabel(item);
    const m = match(query, label);
    if (m) hits.push({ item, label, score: m.score, ranges: m.ranges });
  }
  return hits.sort((a, b) => a.score - b.score);
}

/** Split a label into plain and highlighted segments, for building DOM text nodes. */
export function segments(label, ranges) {
  const out = [];
  let pos = 0;
  for (const [s, e] of ranges) {
    if (s > pos) out.push({ text: label.slice(pos, s), mark: false });
    if (e > s) out.push({ text: label.slice(s, e), mark: true });
    pos = e;
  }
  if (pos < label.length) out.push({ text: label.slice(pos), mark: false });
  return out;
}
