/**
 * Recto Studio — High-Precision Desktop Publishing Engine
 * Copyright (c) 2022-2026 Abhinav. All rights reserved.
 * Licensed under the MIT License.
 */

import { hyphenateWord } from './hyphenation';

/**
 * Knuth-Plass Global Paragraph Composer:
 * Adapts Donald Knuth and Michael Plass's TeX line-breaking algorithm.
 * Treats the entire paragraph as a Directed Acyclic Graph (DAG) and solves
 * the shortest-path optimization problem to minimize white-space demerits across all lines.
 */

export type ItemType = 'box' | 'glue' | 'penalty';

export interface Box {
  type: 'box';
  width: number;
  value: string;
}

export interface Glue {
  type: 'glue';
  width: number;
  stretch: number;
  shrink: number;
}

export interface Penalty {
  type: 'penalty';
  width: number;
  penalty: number;
  flagged: boolean;
}

export type KnuthItem = Box | Glue | Penalty;

export interface BreakNode {
  itemIndex: number;
  line: number;
  fitnessClass: number; // 0 = very tight, 1 = tight, 2 = loose, 3 = very loose
  totalDemerits: number;
  ratio: number;
  previous: BreakNode | null;
}

export interface ComposerOptions {
  tolerance?: number;
  hyphenPenalty?: number;
  consecutiveHyphenPenalty?: number;
  spaceStretchRatio?: number;
  spaceShrinkRatio?: number;
  enableHyphenation?: boolean;
}

export interface ComposedLine {
  text: string;
  adjustmentRatio: number;
  hasHyphen: boolean;
  isLastLine: boolean;
  words: string[];
}

export class KnuthPlassComposer {
  private options: Required<ComposerOptions>;

  constructor(options: ComposerOptions = {}) {
    this.options = {
      tolerance: options.tolerance ?? 2.5,
      hyphenPenalty: options.hyphenPenalty ?? 50,
      consecutiveHyphenPenalty: options.consecutiveHyphenPenalty ?? 3000,
      spaceStretchRatio: options.spaceStretchRatio ?? 0.5,
      spaceShrinkRatio: options.spaceShrinkRatio ?? 0.33,
      enableHyphenation: options.enableHyphenation ?? true,
    };
  }

  /**
   * Converts plain text into a Knuth-Plass stream of Boxes, Glue, and Penalties.
   */
  public tokenize(text: string, measureWidth: (str: string) => number): KnuthItem[] {
    const items: KnuthItem[] = [];
    const words = text.trim().split(/\s+/).filter(Boolean);
    const spaceWidth = measureWidth(' ');
    const hyphenWidth = measureWidth('-');

    for (let i = 0; i < words.length; i++) {
      const word = words[i];

      if (this.options.enableHyphenation && word.length >= 7) {
        const syllables = hyphenateWord(word);
        if (syllables.length > 1) {
          for (let s = 0; s < syllables.length; s++) {
            const syl = syllables[s];
            items.push({
              type: 'box',
              width: measureWidth(syl),
              value: syl,
            });

            if (s < syllables.length - 1) {
              items.push({
                type: 'penalty',
                width: hyphenWidth,
                penalty: this.options.hyphenPenalty,
                flagged: true,
              });
            }
          }
        } else {
          items.push({
            type: 'box',
            width: measureWidth(word),
            value: word,
          });
        }
      } else {
        items.push({
          type: 'box',
          width: measureWidth(word),
          value: word,
        });
      }

      if (i < words.length - 1) {
        items.push({
          type: 'glue',
          width: spaceWidth,
          stretch: spaceWidth * this.options.spaceStretchRatio,
          shrink: spaceWidth * this.options.spaceShrinkRatio,
        });
      }
    }

    // Paragraph terminating penalty and stretchable glue
    items.push({
      type: 'penalty',
      width: 0,
      penalty: -10000, // Forced break
      flagged: false,
    });

    return items;
  }

  /**
   * Computes fitness class based on adjustment ratio r.
   */
  private getFitnessClass(r: number): number {
    if (r < -0.5) return 0; // Very tight
    if (r <= 0.5) return 1;  // Tight / normal
    if (r <= 1.0) return 2;  // Loose
    return 3;                // Very loose
  }

  /**
   * Computes line adjustment ratio between breakpoint start and end.
   */
  private computeAdjustmentRatio(
    items: KnuthItem[],
    fromIdx: number,
    toIdx: number,
    targetWidth: number
  ): number {
    let actualWidth = 0;
    let totalStretch = 0;
    let totalShrink = 0;

    for (let i = fromIdx; i <= toIdx; i++) {
      const item = items[i];
      if (item.type === 'box') {
        actualWidth += item.width;
      } else if (item.type === 'glue') {
        if (i < toIdx) {
          actualWidth += item.width;
          totalStretch += item.stretch;
          totalShrink += item.shrink;
        }
      } else if (item.type === 'penalty') {
        if (i === toIdx && item.penalty > 0) {
          actualWidth += item.width;
        }
      }
    }

    const diff = targetWidth - actualWidth;
    if (diff > 0) {
      return totalStretch > 0 ? diff / totalStretch : 0;
    } else if (diff < 0) {
      return totalShrink > 0 ? diff / totalShrink : -10;
    }
    return 0;
  }

  /**
   * Solves the shortest path problem through the breakpoint DAG.
   */
  public breakLines(
    items: KnuthItem[],
    lineWidths: number | number[]
  ): ComposedLine[] {
    const getLineWidth = (lineIdx: number): number => {
      if (Array.isArray(lineWidths)) {
        return lineWidths[Math.min(lineIdx, lineWidths.length - 1)] || lineWidths[0];
      }
      return lineWidths;
    };

    // Active nodes in the DAG
    let activeNodes: BreakNode[] = [
      {
        itemIndex: -1,
        line: 0,
        fitnessClass: 1,
        totalDemerits: 0,
        ratio: 0,
        previous: null,
      },
    ];

    for (let i = 0; i < items.length; i++) {
      const item = items[i];

      // Legal breakpoint: Penalty with penalty < 10000, or Glue preceded by Box
      const isLegalBreakpoint =
        (item.type === 'penalty' && item.penalty < 10000) ||
        (item.type === 'glue' && i > 0 && items[i - 1].type === 'box');

      if (!isLegalBreakpoint) continue;

      const candidates: BreakNode[] = [];

      for (const node of activeNodes) {
        const fromIdx = node.itemIndex + 1;
        const targetW = getLineWidth(node.line);
        const ratio = this.computeAdjustmentRatio(items, fromIdx, i, targetW);

        // Discard breaks that compress beyond limits (-1) or stretch beyond tolerance
        if (ratio < -1 || ratio > this.options.tolerance) {
          continue;
        }

        // Knuth-Plass Demerits formula: d = (1 + 100 * |r|^3 + p)^2
        const penaltyVal = item.type === 'penalty' ? item.penalty : 0;
        let demerits: number;
        if (penaltyVal >= 0) {
          demerits = Math.pow(1 + 100 * Math.pow(Math.abs(ratio), 3) + penaltyVal, 2);
        } else if (penaltyVal > -10000) {
          demerits = Math.pow(1 + 100 * Math.pow(Math.abs(ratio), 3), 2) - Math.pow(penaltyVal, 2);
        } else {
          demerits = Math.pow(1 + 100 * Math.pow(Math.abs(ratio), 3), 2);
        }

        // Consecutive hyphen penalty
        if (item.type === 'penalty' && item.flagged && node.previous) {
          const prevItem = node.itemIndex >= 0 ? items[node.itemIndex] : null;
          if (prevItem && prevItem.type === 'penalty' && prevItem.flagged) {
            demerits += this.options.consecutiveHyphenPenalty;
          }
        }

        // Fitness class penalty for adjacent lines with discordant tightness
        const fitClass = this.getFitnessClass(ratio);
        if (Math.abs(fitClass - node.fitnessClass) > 1) {
          demerits += 1000;
        }

        candidates.push({
          itemIndex: i,
          line: node.line + 1,
          fitnessClass: fitClass,
          totalDemerits: node.totalDemerits + demerits,
          ratio,
          previous: node,
        });
      }

      if (candidates.length > 0) {
        // Keep the best candidate for each fitness class to avoid exponential state growth
        const bestByFitness = new Map<number, BreakNode>();
        for (const cand of candidates) {
          const existing = bestByFitness.get(cand.fitnessClass);
          if (!existing || cand.totalDemerits < existing.totalDemerits) {
            bestByFitness.set(cand.fitnessClass, cand);
          }
        }
        for (const cand of bestByFitness.values()) {
          activeNodes.push(cand);
        }
      }
    }

    // Find the terminal node reaching the end of the item stream
    const finalItemIdx = items.length - 1;
    let bestFinalNode: BreakNode | null = null;

    for (const node of activeNodes) {
      if (node.itemIndex === finalItemIdx) {
        if (!bestFinalNode || node.totalDemerits < bestFinalNode.totalDemerits) {
          bestFinalNode = node;
        }
      }
    }

    // Fallback if no feasible path met tolerance: greedy recovery
    if (!bestFinalNode) {
      return this.fallbackGreedyBreak(items, getLineWidth(0));
    }

    // Reconstruct lines backwards from optimal terminal node
    const breakNodes: BreakNode[] = [];
    let curr: BreakNode | null = bestFinalNode;
    while (curr && curr.itemIndex !== -1) {
      breakNodes.unshift(curr);
      curr = curr.previous;
    }

    const resultLines: ComposedLine[] = [];
    let startIdx = 0;

    for (let b = 0; b < breakNodes.length; b++) {
      const node = breakNodes[b];
      const endIdx = node.itemIndex;
      const isLastLine = (b === breakNodes.length - 1);

      let lineText = '';
      const words: string[] = [];
      let currentWord = '';
      let hasHyphen = false;

      for (let i = startIdx; i <= endIdx; i++) {
        const item = items[i];
        if (item.type === 'box') {
          currentWord += item.value;
        } else if (item.type === 'glue') {
          if (currentWord) {
            words.push(currentWord);
            currentWord = '';
          }
        } else if (item.type === 'penalty') {
          if (i === endIdx && item.flagged) {
            currentWord += '-';
            hasHyphen = true;
          }
        }
      }
      if (currentWord) {
        words.push(currentWord);
      }

      lineText = words.join(' ');
      resultLines.push({
        text: lineText,
        adjustmentRatio: node.ratio,
        hasHyphen,
        isLastLine,
        words,
      });

      startIdx = endIdx + 1;
    }

    return resultLines;
  }

  /**
   * Robust greedy line-breaking fallback when tolerance bounds cannot be satisfied.
   */
  private fallbackGreedyBreak(items: KnuthItem[], targetW: number): ComposedLine[] {
    const lines: ComposedLine[] = [];
    let currentWords: string[] = [];
    let currentW = 0;

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.type === 'box') {
        if (currentW + item.width > targetW && currentWords.length > 0) {
          lines.push({
            text: currentWords.join(' '),
            adjustmentRatio: 0,
            hasHyphen: false,
            isLastLine: false,
            words: [...currentWords],
          });
          currentWords = [item.value];
          currentW = item.width;
        } else {
          currentWords.push(item.value);
          currentW += item.width + 4;
        }
      }
    }

    if (currentWords.length > 0) {
      lines.push({
        text: currentWords.join(' '),
        adjustmentRatio: 0,
        hasHyphen: false,
        isLastLine: true,
        words: currentWords,
      });
    }

    return lines;
  }
}
