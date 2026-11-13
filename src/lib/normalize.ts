/**
 * Container-number normalization. This is the single source of truth used by
 * search, import, manual edits and (mirrored) by the database CHECK constraint.
 *
 * Rules: remove ALL whitespace (spaces, tabs, line breaks, NBSP, zero-width chars)
 * and visual separators (- . / _), uppercase. Letters and digits are never removed.
 */
const STRIP = new RegExp('[\\s\\u00A0\\u1680\\u180E\\u2000-\\u200D\\u2028\\u2029\\u202F\\u205F\\u2060\\u3000\\uFEFF\\-./_]', 'g');

export function normalizeContainerNumber(input: unknown): string {
  if (input === null || input === undefined) return '';
  return String(input).replace(STRIP, '').toUpperCase();
}

/** ISO 6346 shape: 3-letter owner code + equipment category (U/J/Z/R) + 6 serial digits + check digit. */
export const ISO_PATTERN = /^[A-Z]{3}[UJZR]\d{7}$/;
/** Looser shape accepted by the importer: 4 letters + 7 digits. */
export const BASIC_PATTERN = /^[A-Z]{4}\d{7}$/;

export function isValidFormat(normalized: string): boolean {
  return BASIC_PATTERN.test(normalized);
}

const LETTER_VALUES: Record<string, number> = (() => {
  const v: Record<string, number> = {};
  let n = 10;
  for (const ch of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
    if (n % 11 === 0) n++; // ISO 6346 skips multiples of 11
    v[ch] = n++;
  }
  return v;
})();

/** Computes the ISO 6346 check digit for the first 10 characters, or null if malformed. */
export function computeCheckDigit(first10: string): number | null {
  if (!/^[A-Z]{4}\d{6}$/.test(first10)) return null;
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    const c = first10[i];
    const val = i < 4 ? LETTER_VALUES[c] : Number(c);
    sum += val * 2 ** i;
  }
  return (sum % 11) % 10;
}

export function isCheckDigitValid(normalized: string): boolean {
  if (!BASIC_PATTERN.test(normalized)) return false;
  return computeCheckDigit(normalized.slice(0, 10)) === Number(normalized[10]);
}

/** "AXIU1498450" -> "AXIU 149845 0" (standard printed layout). */
export function formatContainerNumber(normalized: string): string {
  if (!BASIC_PATTERN.test(normalized)) return normalized;
  return `${normalized.slice(0, 4)} ${normalized.slice(4, 10)} ${normalized[10]}`;
}

/** Trim + uppercase + collapse internal whitespace for category fields (line, type, grade, size, condition). */
export function normalizeField(input: unknown): string {
  if (input === null || input === undefined) return '';
  return String(input).replace(/\s+/g, ' ').trim().toUpperCase();
}

/**
 * Tries to pull a container number out of pasted free text,
 * e.g. "Container: AXIU 149 845 0 (empty)" -> "AXIU1498450".
 * Returns all distinct candidates, in order of appearance.
 */
export function extractContainerCandidates(text: string): string[] {
  const upper = String(text ?? '').toUpperCase();
  const found = new Set<string>();
  // Allow whitespace/separators between characters of the number.
  const re = /[A-Z](?:[\s\-./_]*[A-Z]){3}(?:[\s\-./_]*\d){7}/g;
  for (const m of upper.matchAll(re)) found.add(normalizeContainerNumber(m[0]));
  return [...found];
}
