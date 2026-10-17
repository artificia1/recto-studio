/**
 * Recto Studio — High-Precision Desktop Publishing Engine
 * Copyright (c) 2022-2026 Abhinav. All rights reserved.
 * Licensed under the MIT License.
 */

/**
 * Liang's Hyphenation Engine:
 * Implements Franklin Mark Liang's TeX hyphenation algorithm using pattern-matching tables.
 * Accurately determines permissible syllable breakpoints for Knuth-Plass line balancing.
 */

// Standard curated English hyphenation patterns (TeX subset covering standard root words, prefixes, and suffixes)
const HYPHENATION_PATTERNS = [
  'al1l', 'am2a', 'an2a', 'an3te', 'ar1a', 'as2s', 'at2a', 'ba3b', 'ba4bl', 'be1c', 'be1g',
  'be1t', 'bi1b', 'bi2bl', 'bl2u', 'bu4bl', 'ca2b', 'ca4bl', 'ch3i', 'ci2a', 'ci3e', 'co3i',
  'da3b', 'de1c', 'de3cl', 'de1g', 'de1m', 'de1p', 'de1r', 'di1c', 'di1g', 'di1p', 'di1s',
  'du4bl', 'ed2i', 'el3e', 'em1b', 'em1m', 'en3a', 'en3c', 'en3g', 'en3t', 'ep3i', 'er3a',
  'es3t', 'ex1c', 'ex1p', 'fa3b', 'fi3b', 'fo4bl', 'ga3b', 'ge3n', 'gr2a', 'ha3b', 'he3a',
  'ho3b', 'hy3ph', 'he2n', 'ic3a', 'id3e', 'im3p', 'in3c', 'in3d', 'in3g', 'in3s', 'in3t',
  'ir3a', 'is3m', 'is3t', 'it3e', 'ju3b', 'la3b', 'le3a', 'le4bl', 'li3a', 'li3e', 'lo3b',
  'lu3b', 'ma3b', 'me3a', 'mi3b', 'mo3b', 'mu3b', 'na3b', 'ne3a', 'ni3b', 'no3b', 'nu3b',
  'ob3l', 'oc3u', 'op1p', 'or3a', 'pa3b', 'pe3a', 'ph3o', 'pi3b', 'pl2a', 'po3b', 'pr2a',
  'pu3b', 'qu2a', 'ra3b', 're1a', 're1c', 're1d', 're1g', 're1p', 're1s', 're1v', 'ro3b',
  'ru3b', 'sa3b', 'sc2h', 'se3a', 'si3a', 'so3b', 'st2a', 'su3b', 'ta3b', 'te3a', 'ti3a',
  'ti3e', 'ti3o', 'to3b', 'tr2a', 'tu3b', 'un1a', 'un1d', 'un1e', 'un1i', 'un1o', 'un1u',
  'va3b', 've3a', 'vi3b', 'vo3b', 'vu3b', 'wa3b', 'we3a', 'wi3b', 'wo3b', 'wu3b', 'ya3b',
  'ye3a', 'yi3b', 'yo3b', 'yu3b', 'za3b', 'ze3a', 'zi3b', 'zo3b', 'zu3b',
  // Suffixes and common multi-syllabic markers
  '4tion', '3sion', '2ment', '2ance', '2ence', '2able', '2ible', '2ular', '2less', '2ness',
  '2ward', '2wise', '2like', '2fold', '2ship', '2hood', '2some', '2most', '2full', '2ish',
  '3ing', '2ling', '2er', '2est', '2ism', '2ist', '2ity', '2ive', '2ous', '2al', '2ial'
];

interface PatternEntry {
  pattern: string;
  points: number[];
}

class HyphenationTrie {
  private patterns: Map<string, number[]> = new Map();

  constructor(patterns: string[]) {
    for (const raw of patterns) {
      this.addPattern(raw);
    }
  }

  private addPattern(raw: string): void {
    let clean = '';
    const points: number[] = [];
    let curPoints = 0;

    for (let i = 0; i < raw.length; i++) {
      const ch = raw[i];
      if (ch >= '0' && ch <= '9') {
        curPoints = parseInt(ch, 10);
      } else {
        points.push(curPoints);
        curPoints = 0;
        clean += ch;
      }
    }
    points.push(curPoints);
    this.patterns.set(clean, points);
  }

  public hyphenate(word: string): string[] {
    const cleanWord = word.toLowerCase().replace(/[^a-z]/g, '');
    if (cleanWord.length < 5) {
      return [word];
    }

    const padded = '.' + cleanWord + '.';
    const levels = new Array(padded.length).fill(0);

    for (let start = 0; start < padded.length; start++) {
      for (let len = 1; len <= padded.length - start; len++) {
        const sub = padded.substr(start, len);
        const pts = this.patterns.get(sub);
        if (pts) {
          for (let pIdx = 0; pIdx < pts.length; pIdx++) {
            const targetPos = start + pIdx;
            if (targetPos < levels.length && pts[pIdx] > levels[targetPos]) {
              levels[targetPos] = pts[pIdx];
            }
          }
        }
      }
    }

    // Minimum 2 letters before first hyphen, 2 letters after last hyphen
    const syllables: string[] = [];
    let startIdx = 0;

    for (let i = 2; i <= cleanWord.length - 2; i++) {
      // Position in padded string is i + 1
      const level = levels[i + 1] || 0;
      if (level % 2 === 1) { // Odd level indicates valid breakpoint
        syllables.push(word.slice(startIdx, i));
        startIdx = i;
      }
    }

    if (startIdx < word.length) {
      syllables.push(word.slice(startIdx));
    }

    return syllables.length > 0 ? syllables : [word];
  }
}

export const defaultHyphenator = new HyphenationTrie(HYPHENATION_PATTERNS);

/**
 * Hyphenates a single word into permissible syllable segments.
 */
export function hyphenateWord(word: string): string[] {
  return defaultHyphenator.hyphenate(word);
}
