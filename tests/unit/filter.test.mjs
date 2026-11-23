import { test } from "node:test";
import assert from "node:assert/strict";
import { fold, match, filterItems, segments, mergeRanges, queryWords } from "../../src/filter.js";

const marked = (label, ranges) => segments(label, ranges).filter((s) => s.mark).map((s) => s.text);

test("fold drops accents and case and maps every folded character back", () => {
  const { text, origin } = fold("São Tomé");
  assert.equal(text, "sao tome");
  assert.deepEqual(origin, [0, 1, 2, 3, 4, 5, 6, 7, 8]);
  // A precomposed letter can fold to fewer UTF-16 units than its source and
  // characters outside the BMP take two; the mapping must follow both.
  const emoji = fold("🚀Ära");
  assert.equal(emoji.text, "🚀ara");
  assert.deepEqual(emoji.origin, [0, 0, 2, 3, 4, 5]);
  // Decomposed input (e + combining acute) folds to one letter from two units.
  const decomposed = fold("Réunion");
  assert.equal(decomposed.text, "reunion");
  assert.equal(decomposed.origin[2], 3); // "e\u0301" is two code points and the mark folds to nothing
});

test("query words are folded and whitespace is ignored", () => {
  assert.deepEqual(queryWords("  São   TOMÉ "), ["sao", "tome"]);
  assert.deepEqual(queryWords("   "), []);
});

test("matching ignores accents, case and apostrophe style, and highlights the original text", () => {
  const cote = match("cote d'iv", "Côte d’Ivoire");
  assert.ok(cote);
  assert.deepEqual(marked("Côte d’Ivoire", cote.ranges), ["Côte", "d’Iv"]); // the space between is not part of a word
  const sao = match("sao to", "São Tomé and Príncipe");
  assert.deepEqual(marked("São Tomé and Príncipe", sao.ranges), ["São", "To"]);
  assert.deepEqual(marked("Curaçao", match("curac", "Curaçao").ranges), ["Curaç"]);
  assert.deepEqual(marked("Türkiye", match("TURK", "Türkiye").ranges), ["Türk"]);
});

test("scores: prefix 0, word starts 1, inside a word 2; no match is null", () => {
  assert.equal(match("uni", "United Kingdom").score, 0);
  assert.equal(match("kingdom", "United Kingdom").score, 1);
  assert.equal(match("kingdom uni", "United Kingdom").score, 1);
  assert.equal(match("ingdom", "United Kingdom").score, 2);
  assert.equal(match("xyz", "United Kingdom"), null);
  assert.equal(match("united xyz", "United Kingdom"), null);
  assert.deepEqual(match("", "Anything"), { score: 0, ranges: [] });
});

test("a word-start occurrence is preferred over an earlier inside-word one", () => {
  // "an" occurs inside "Afghanistan" at 4 but starts no word there.
  const m = match("an", "Afghanistan and Anguilla");
  assert.equal(m.score, 1);
  assert.deepEqual(m.ranges, [[12, 14]]);
});

test("filterItems ranks by score and keeps the original order on ties", () => {
  const items = ["Bermuda", "Germany", "Oman", "Malta", "Marshall Islands", "Ma Island"];
  const got = filterItems("ma", items).map((h) => [h.label, h.score]);
  assert.deepEqual(got, [
    ["Malta", 0], ["Marshall Islands", 0], ["Ma Island", 0],
    ["Germany", 2], ["Oman", 2], // "Bermuda" has no "ma"
  ]);
  // Objects with a custom label accessor.
  const objs = [{ name: "Oslo" }, { name: "Lisbon" }];
  assert.deepEqual(filterItems("lis", objs, (o) => o.name).map((h) => h.item), [objs[1]]);
});

test("mergeRanges sorts and merges overlapping and touching ranges", () => {
  assert.deepEqual(mergeRanges([[5, 7], [0, 2], [1, 3], [7, 9]]), [[0, 3], [5, 9]]);
  assert.deepEqual(mergeRanges([]), []);
});

test("segments rebuild the label exactly", () => {
  assert.deepEqual(segments("abcdef", [[1, 3], [4, 5]]), [
    { text: "a", mark: false }, { text: "bc", mark: true }, { text: "d", mark: false },
    { text: "e", mark: true }, { text: "f", mark: false },
  ]);
  assert.deepEqual(segments("abc", []), [{ text: "abc", mark: false }]);
});

// ---- property test against a brute-force oracle

function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}
const ALPHABET = ["a", "b", "e", "é", "E", "o", "ö", "O", " ", "-", "’", "'", "ç", "🙂", "é", "ß", "İ"];

test("property: matches exactly when every folded query word is in the folded label; ranges are sound", () => {
  const rand = rng(14);
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  let matched = 0;
  for (let i = 0; i < 5000; i++) {
    const label = Array.from({ length: 1 + Math.floor(rand() * 12) }, () => pick(ALPHABET)).join("");
    // Half the queries are cut from the label itself so that matches are common.
    const query = rand() < 0.5
      ? [...label].slice(Math.floor(rand() * 4), 2 + Math.floor(rand() * 8)).join("")
      : Array.from({ length: 1 + Math.floor(rand() * 4) }, () => pick(ALPHABET)).join("");
    const words = queryWords(query);
    const folded = fold(label).text;
    const expected = words.every((w) => folded.includes(w));
    const m = match(query, label);
    assert.equal(m !== null, expected, `${JSON.stringify(query)} vs ${JSON.stringify(label)}`);
    if (!m) continue;
    matched++;
    assert.equal(segments(label, m.ranges).map((s) => s.text).join(""), label);
    let prevEnd = -1;
    for (const [s, e] of m.ranges) {
      assert.ok(s > prevEnd && s < e && e <= label.length, `bad range ${s},${e} in ${JSON.stringify(label)}`);
      prevEnd = e;
    }
    // Each query word appears in the folded highlighted text.
    const highlighted = marked(label, m.ranges).map((t) => fold(t).text).join("\u0000");
    for (const w of words) assert.ok(highlighted.includes(w), `${w} not highlighted in ${JSON.stringify(label)}`);
  }
  assert.ok(matched > 2000, `only ${matched} matches; the generator needs tuning`);
});
