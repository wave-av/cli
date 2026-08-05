# Source recovery — where this code came from, and how you can check

This repository advertised itself as the source of `@wave-av/cli` while containing no source at
all. Eight versions were published to npm between 2026-04-03 and 2026-08-04 from a working copy
that was never committed. Anyone who ran `npm install @wave-av/cli` and followed the `repository`
link the package itself carries arrived at a README and a LICENSE, and **the code executing on
their machine existed in no public repository.**

This directory closes that gap. It is worth being precise about what kind of claim that is.

## The source was recovered, not reconstructed

Every published version of `@wave-av/cli` ships `dist/index.js.map`, and that sourcemap carries
`sourcesContent` — not merely the *names* of the original files but their **complete contents**,
pre-compilation. All 70 TypeScript files under `src/` were extracted from it verbatim. Nothing here
was inferred from the compiled bundle, hand-written to match, or reasoned backwards from types.

## The receipt: it rebuilds byte-for-byte

The claim "this is the source" is checkable, so it was checked, on **every** published version
rather than a sample:

| version | rebuilt `dist/index.js` vs published |
|---|---|
| 1.0.0 | **byte-identical** |
| 1.0.2 | **byte-identical** |
| 1.0.3 | **byte-identical** |
| 1.0.4 | **byte-identical** |
| 1.0.5 | **byte-identical** |
| 1.0.6 | **byte-identical** |
| 1.0.7 | **byte-identical** |
| 1.0.8 | **byte-identical** |

Re-derive any row yourself:

```sh
# 1. fetch what npm actually shipped
#    NOTE: --registry does NOT override a scope mapping. If your npm config points @wave-av at a
#    private registry, the plain form 404s against the wrong host and reads as "not published".
npm pack @wave-av/cli@1.0.8 --@wave-av:registry=https://registry.npmjs.org
tar -xzf wave-av-cli-1.0.8.tgz

# 2. extract the original sources out of the published sourcemap
node -e '
  const m = require("./package/dist/index.js.map"), fs = require("fs"), p = require("path");
  m.sources.forEach((s, i) => {
    const f = p.join("recovered", s.replace(/^\.\.\//, ""));
    fs.mkdirSync(p.dirname(f), { recursive: true });
    fs.writeFileSync(f, m.sourcesContent[i]);
  });
'

# 3. build and compare
npm ci --include=dev && npx tsup
cmp dist/index.js package/dist/index.js && echo IDENTICAL
```

`cmp` exits 0 silently on a match.

## What was authored for this recovery, and is therefore NOT recovered

Two files. The sourcemap contains source, not build configuration, so these were written to make
the tree buildable and are stated here rather than left to look like they came out of the artifact:

- **`tsconfig.json`** — a conventional strict ES2022/ESNext configuration.
- **`tsup.config.ts`** — entry `src/index.ts`, ESM, node18, sourcemap on, shebang banner.

They are not guesses in any loose sense: they are the settings under which the output matches the
published bytes exactly, on all eight versions. A different plausible configuration would have
produced a different bundle and the comparison above would have failed. But they were **written**,
not **recovered**, and conflating the two would be the same class of error this whole exercise
exists to correct.

`package.json` was taken from the published manifest, which npm preserves in full — including
`scripts` and `devDependencies`.

## Safety

The recovered tree was scanned with `gitleaks` before being proposed here: **no leaks found**,
~200KB across 70 files. This mattered more than it looks. The sourcemap has been publicly
downloadable since 2026-04-03, so a hardcoded credential inside it would have been a live
four-month exposure — a fact about the *published package*, not a risk created by recovering it.

## What this does and does not settle

It settles the question *"what source produced the code now running on their machine?"* for every
version of `@wave-av/cli`, with a receipt anyone outside WAVE can reproduce.

It does **not** settle it for `@wave-av/workflow-sdk`, whose seven published versions carry no
sourcemap at all. That package's source is recoverable only as a *reconstruction* — a tree that can
be proven to produce the published bytes, which is a genuinely weaker claim than a tree that did.
The two must not be recorded as the same thing.

## Provenance of the versions themselves

Recovering the source does not retroactively create the tags that never existed. Tagging each
published version against its own `cmp` receipt is tracked separately; until those tags exist, this
file is the record of where the code came from.
