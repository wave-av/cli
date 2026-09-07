/**
 * Unit tests for the two pure classifiers the license gate is built on: naming a license
 * from its TEXT, and deciding how reciprocal that license is. Every license defect this
 * repo shipped was a DECLARED identifier disagreeing with a license FILE, so the ability to
 * read a file and name it correctly is the foundation the rest of the gate stands on.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { detectSpdxFromText, classifyCopyleft, UNKNOWN } from './lib/spdx.mjs';
import { readmeLicense } from './lib/audit.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const APACHE_HEAD = readFileSync(join(ROOT, 'LICENSE'), 'utf8');
const MIT_TEXT = `MIT License

Copyright (c) 2026 WAVE Online, LLC

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction.
`;

/* ── SPDX detection ────────────────────────────────────────────────────────── */

describe('detectSpdxFromText', () => {
  it("names this repository's own LICENSE file", () => {
    expect(detectSpdxFromText(APACHE_HEAD)).toBe('Apache-2.0');
  });

  it('names MIT text', () => {
    expect(detectSpdxFromText(MIT_TEXT)).toBe('MIT');
  });

  it('names ISC text without confusing it for MIT', () => {
    const isc =
      'ISC License\n\nPermission to use, copy, modify, and/or distribute this software for any purpose\nwith or without fee is hereby granted.';
    expect(detectSpdxFromText(isc)).toBe('ISC');
  });

  it('names BSD-3-Clause by its third clause', () => {
    const bsd =
      'Redistribution and use in source and binary forms, with or without modification, are permitted.\n' +
      'Neither the name of the copyright holder nor the names of its contributors may be used to endorse.';
    expect(detectSpdxFromText(bsd)).toBe('BSD-3-Clause');
  });

  it('returns UNKNOWN rather than guessing', () => {
    expect(detectSpdxFromText('')).toBe(UNKNOWN);
    expect(detectSpdxFromText(null)).toBe(UNKNOWN);
    expect(detectSpdxFromText('All rights reserved. Do not copy.')).toBe(UNKNOWN);
  });
});

describe('classifyCopyleft', () => {
  it.each([
    ['MIT', 'permissive'],
    ['Apache-2.0', 'permissive'],
    ['MPL-2.0', 'weak'],
    ['LGPL-3.0-or-later', 'weak'],
    ['GPL-3.0-only', 'strong'],
    ['AGPL-3.0', 'strong'],
    ['SSPL-1.0', 'strong'],
    ['UNKNOWN', 'unknown'],
  ])('%s -> %s', (expr, expected) => {
    expect(classifyCopyleft(expr)).toBe(expected);
  });

  it('treats a disjunction offering a permissive option as permissive', () => {
    expect(classifyCopyleft('(MPL-2.0 OR Apache-2.0)')).toBe('permissive');
    expect(classifyCopyleft('(MIT OR WTFPL)')).toBe('permissive');
  });

  it('keeps a disjunction of only copyleft options copyleft', () => {
    expect(classifyCopyleft('(GPL-3.0-only OR AGPL-3.0)')).toBe('strong');
  });
});

describe('readmeLicense', () => {
  it('reads the identifier under a License heading', () => {
    expect(readmeLicense('# T\n\n## License\n\nApache-2.0 — see LICENSE.\n')).toBe('Apache-2.0');
    expect(readmeLicense('## License\n\nMIT\n')).toBe('MIT');
  });

  it('returns null when there is no License section', () => {
    expect(readmeLicense('# Title\n\nsome prose\n')).toBeNull();
  });

  it('returns null for an empty License section', () => {
    expect(readmeLicense('## License\n\n## Next\n\nbody\n')).toBeNull();
  });
});

