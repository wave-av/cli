/**
 * SPDX identification from license TEXT, plus the copyleft classification the ledger
 * reports on.
 *
 * WHY THIS EXISTS: every license defect this repo has shipped was a mismatch between a
 * DECLARED identifier (`package.json` "license", a PyPI classifier, a README line) and the
 * license TEXT actually in the file next to it. You cannot catch that by comparing two
 * declarations — you have to read the text and name it. `detectSpdxFromText` is that step.
 */

/**
 * Ordered longest-signature-first. Apache-2.0 is tested before MIT because the Apache
 * appendix ("Licensed under the Apache License") contains no MIT phrasing but a naive
 * substring search over a concatenated dual-license file could otherwise mis-rank.
 */
const SIGNATURES = [
  {
    spdx: 'Apache-2.0',
    test: (t) =>
      /apache\s+license\s*\n?\s*version\s+2\.0/i.test(t) ||
      /apache\.org\/licenses\/license-2\.0/i.test(t),
  },
  {
    spdx: 'MPL-2.0',
    test: (t) => /mozilla public license\s*,?\s*(version\s+)?2\.0/i.test(t),
  },
  {
    spdx: 'BSD-3-Clause',
    test: (t) =>
      /redistribution and use in source and binary forms/i.test(t) &&
      /neither the name of/i.test(t),
  },
  {
    spdx: 'BSD-2-Clause',
    test: (t) => /redistribution and use in source and binary forms/i.test(t),
  },
  {
    spdx: 'ISC',
    test: (t) => /permission to use, copy, modify,? and\/or distribute this software/i.test(t),
  },
  {
    spdx: 'MIT',
    test: (t) =>
      /\bmit license\b/i.test(t) ||
      /permission is hereby granted, free of charge, to any person obtaining a copy/i.test(t),
  },
  {
    spdx: 'GPL-3.0-only',
    test: (t) => /gnu general public license\s*\n?\s*version 3/i.test(t),
  },
];

export const UNKNOWN = 'UNKNOWN';

/**
 * Name the license a body of text actually is.
 * @param {string|null|undefined} text
 * @returns {string} an SPDX identifier, or "UNKNOWN" when nothing matches.
 */
export function detectSpdxFromText(text) {
  if (typeof text !== 'string' || text.trim().length === 0) return UNKNOWN;
  for (const sig of SIGNATURES) {
    if (sig.test(text)) return sig.spdx;
  }
  return UNKNOWN;
}

/**
 * Strong copyleft: reciprocal at the WORK level. Linking one of these into a distributed
 * Apache-2.0 binary changes the obligations of the whole distribution, so it is a hard
 * gate failure in runtime dependencies rather than a note.
 */
const STRONG_COPYLEFT = /\b(A?GPL-[123]|GPL-[123]|SSPL|OSL-|CC-BY-SA|EUPL)/i;

/**
 * Weak / file-level copyleft: obligations attach to the modified FILES, not the combined
 * work. Reported in the ledger so a human can see it; not a gate failure.
 */
const WEAK_COPYLEFT = /\b(LGPL-|MPL-|EPL-|CDDL-|MS-RL)/i;

/**
 * @param {string} expr an SPDX expression as it appears in package metadata
 * @returns {"strong"|"weak"|"permissive"|"unknown"}
 */
export function classifyCopyleft(expr) {
  if (typeof expr !== 'string' || !expr.trim()) return 'unknown';
  // A disjunction that offers ANY permissive option is satisfiable permissively —
  // "(MPL-2.0 OR Apache-2.0)" is not a copyleft obligation for a consumer who picks Apache.
  // The separator must be whitespace-delimited: "LGPL-3.0-or-later" is ONE identifier whose
  // "-or-" is part of the name, and splitting on it would recurse on the same string forever.
  const options = expr.replace(/[()]/g, '').split(/\s+OR\s+/i).map((s) => s.trim());
  if (options.length > 1 && options.some((o) => classifyCopyleft(o) === 'permissive')) {
    return 'permissive';
  }
  if (STRONG_COPYLEFT.test(expr)) return 'strong';
  if (WEAK_COPYLEFT.test(expr)) return 'weak';
  if (/^(UNKNOWN|UNLICENSED|SEE LICENSE)/i.test(expr)) return 'unknown';
  return 'permissive';
}
