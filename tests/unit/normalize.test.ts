import { describe, it, expect } from 'vitest';
import {
  normalizeContainerNumber as norm,
  isCheckDigitValid,
  computeCheckDigit,
  formatContainerNumber,
  extractContainerCandidates,
  normalizeField,
  isValidFormat,
} from '../../src/lib/normalize';

describe('normalizeContainerNumber', () => {
  const target = 'AXIU1498450';
  it.each([
    'AXIU1498450',
    'AXIU 1498450',
    'AXIU 149 8450',
    'AXIU149 8450',
    'axiu1498450',
    'Axiu 149 845 0',
    '  AXIU1498450  ',
    'AXIU\t1498450',
    'AXIU\n149\r\n8450',
    'AXIU\u00A0149\u00A08450', // non-breaking spaces (common when copying from web/Excel)
    'AXIU\u200B1498450', // zero-width space
    'AXIU-149845-0',
    'AXIU.149845.0',
  ])('"%s" -> AXIU1498450', (input) => {
    expect(norm(input)).toBe(target);
  });

  it('never removes letters or digits', () => {
    expect(norm('ab1 2c3')).toBe('AB12C3');
  });
  it('handles null/undefined/numbers', () => {
    expect(norm(null)).toBe('');
    expect(norm(undefined)).toBe('');
    expect(norm(12345)).toBe('12345');
  });
});

describe('ISO 6346 check digit', () => {
  it('validates known-good numbers from the real inventory', () => {
    for (const n of ['AXIU1498450', 'ACLU2799370', 'AFPU7436103', 'AMFU3155680']) expect(isCheckDigitValid(n)).toBe(true);
  });
  it('detects a typo', () => {
    expect(isCheckDigitValid('AXIU1498451')).toBe(false);
    expect(isCheckDigitValid('AXIU1489450')).toBe(false); // transposition
  });
  it('computes the standard example CSQU305438 -> 3', () => {
    expect(computeCheckDigit('CSQU305438')).toBe(3);
  });
  it('rejects malformed input', () => {
    expect(computeCheckDigit('AXIU14984')).toBeNull();
    expect(isValidFormat('7397')).toBe(false);
  });
});

describe('helpers', () => {
  it('formats for display', () => expect(formatContainerNumber('AXIU1498450')).toBe('AXIU 149845 0'));
  it('extracts numbers from pasted text', () => {
    expect(extractContainerCandidates('pls check cont: axiu 149 845 0, thanks')).toEqual(['AXIU1498450']);
    expect(extractContainerCandidates('MSKU1234565 and TGHU-000000-1')).toEqual(['MSKU1234565', 'TGHU0000001']);
    expect(extractContainerCandidates('nothing here')).toEqual([]);
  });
  it('normalizes category fields', () => {
    expect(normalizeField(' k ')).toBe('K');
    expect(normalizeField('dm')).toBe('DM');
    expect(normalizeField(40)).toBe('40');
  });
});
