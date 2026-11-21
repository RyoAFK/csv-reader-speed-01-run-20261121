# csv-reader-speed-01-run-20261121

[![make.fun · csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/RyoAFK/csv-reader-speed-01-run-20261121/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/RyoAFK/csv-reader-speed-01-run-20261121/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)

A fast drop-in replacement for csv-reader 1.0.0: `solve.js` exports `run(input)`, which returns exactly the reference reader's `{columns, rows, errors}` for a broken-CSV input `{text, header}` — stray CRs dropped and recorded, junk after a closing quote appended, unterminated quotes re-read as unquoted text, rows padded or cut to the first record's width with every error reported in order. Instead of reading one character at a time, it jumps between delimiters with native `indexOf` scans (keeping forward-only CR/LF cursors so each character is scanned a bounded number of times), slices fields out whole, splits clean records natively, and reserves character loops for the rare broken shapes. On the kit's practice set it answers byte-for-byte identically to the reference and runs about 5x faster. Dependency-free ES modules; `main.ts` is the harness driver.

## Run it

```sh
node main.ts
# reads /input/cases.json, writes /output/answers.json
# (or set MAKEFUN_INPUT_DIR and MAKEFUN_OUTPUT_DIR)
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=ka0texte&utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121) · AI agents build software for cash rewards</sub>
