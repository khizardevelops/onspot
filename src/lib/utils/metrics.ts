import { diffWords, diffChars } from 'diff';
import type { DiffSegment } from '../types';

/**
 * Normalizes French text for fair WER/CER evaluation.
 * Lowercases, strips punctuation, and normalizes whitespace.
 */
export function normalizeFrenchText(text: string): string {
  return text
    // Typographic apostrophes first: French copy uses the curly U+2019 while
    // ASR models emit the straight U+0027. Without folding them together the
    // reference "c’est" normalizes to "c est" (two words) while the
    // hypothesis "c'est" stays one, so every contraction counts as an error.
    .replace(/[\u2018\u2019\u02BC\u00B4`]/g, "'")
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // remove accents for normalized WER
    .replace(/[^\w\s']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Calculates Word Error Rate (WER) using Levenshtein distance on word arrays.
 * WER = (Substitutions + Deletions + Insertions) / Total Words in Reference
 */
export function calculateWER(reference: string, hypothesis: string): number {
  const refWords = normalizeFrenchText(reference).split(/\s+/).filter(Boolean);
  const hypWords = normalizeFrenchText(hypothesis).split(/\s+/).filter(Boolean);

  if (refWords.length === 0) return hypWords.length === 0 ? 0 : 100;

  const dp: number[][] = Array.from({ length: refWords.length + 1 }, () =>
    new Array(hypWords.length + 1).fill(0)
  );

  for (let i = 0; i <= refWords.length; i++) dp[i][0] = i;
  for (let j = 0; j <= hypWords.length; j++) dp[0][j] = j;

  for (let i = 1; i <= refWords.length; i++) {
    for (let j = 1; j <= hypWords.length; j++) {
      if (refWords[i - 1] === hypWords[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = 1 + Math.min(
          dp[i - 1][j],     // Deletion
          dp[i][j - 1],     // Insertion
          dp[i - 1][j - 1]  // Substitution
        );
      }
    }
  }

  const distance = dp[refWords.length][hypWords.length];
  const wer = (distance / refWords.length) * 100;
  return Math.round(wer * 10) / 10;
}

/**
 * Calculates Character Error Rate (CER).
 */
export function calculateCER(reference: string, hypothesis: string): number {
  const refChars = normalizeFrenchText(reference).replace(/\s+/g, '');
  const hypChars = normalizeFrenchText(hypothesis).replace(/\s+/g, '');

  if (refChars.length === 0) return hypChars.length === 0 ? 0 : 100;

  const dp: number[][] = Array.from({ length: refChars.length + 1 }, () =>
    new Array(hypChars.length + 1).fill(0)
  );

  for (let i = 0; i <= refChars.length; i++) dp[i][0] = i;
  for (let j = 0; j <= hypChars.length; j++) dp[0][j] = j;

  for (let i = 1; i <= refChars.length; i++) {
    for (let j = 1; j <= hypChars.length; j++) {
      if (refChars[i - 1] === hypChars[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = 1 + Math.min(
          dp[i - 1][j],
          dp[i][j - 1],
          dp[i - 1][j - 1]
        );
      }
    }
  }

  const distance = dp[refChars.length][hypChars.length];
  const cer = (distance / refChars.length) * 100;
  return Math.round(cer * 10) / 10;
}

/**
 * Computes word-level diff segments comparing reference and transcription.
 */
export function computeWordDiff(reference: string, hypothesis: string): DiffSegment[] {
  return diffWords(reference, hypothesis);
}
