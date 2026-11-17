# Test fixtures

Reference outputs from the code the ports come from, which the tests in `test/`
compare against. The `.json` and `.txt` files are committed, so `npm test` needs
none of the tools below; they are only for regenerating a fixture, after a port
changes or its upstream moves to a new commit. Each generator's header gives
the details.

Run everything from the repository root.

## Fixtures

| Fixture               | Reference                                  | Generator                    | Tests                                         |
| --------------------- | ------------------------------------------ | ---------------------------- | --------------------------------------------- |
| `kurbo.json`          | kurbo, crates.io 0.13.1                    | `kurbo-gen`                  | `flatten.test.mjs`, `to-quadratics.test.mjs`  |
| `arclen-kurbo.json`   | kurbo, crates.io 0.13.1                    | `kurbo-gen --bin arclen`     | `measure.test.mjs`                            |
| `offset-kurbo.json`   | kurbo, crates.io 0.13.1                    | `kurbo-gen --bin offset`     | `measure-offset.mjs` only                     |
| `skia.json`           | Skia at `50ba8e6d`                         | `generate-skia.sh`           | `contains.test.mjs`, `wangs-formula.test.mjs` |
| `arclen-skia.json`    | Skia at `50ba8e6d`                         | `generate-skia-arclen.sh`    | `measure-arclen.mjs` only                     |
| `stroke-outline.json` | stroke-outline at `084fd2ca`               | `generate-stroke-outline.sh` | `stroke-outline.test.mjs`                     |
| `cu2qu.json`          | fontTools, PyPI 4.68.0                     | `generate-cu2qu.py`          | `to-quadratics.test.mjs`                      |
| `point-inside.json`   | fontTools, PyPI 4.68.0                     | `generate-point-inside.py`   | `contains.test.mjs`                           |
| `svg-arc.json`        | svg-arc-to-cubic-bezier, npm 3.2.0         | `generate-svg-arc.mjs`       | `arc.test.mjs`                                |
| `colomitchi.json`     | bezier-utils (caffeineowl.com), with fixes | `generate-colomitchi.sh`     | `to-quadratics.test.mjs`                      |
| `arclen-inputs.txt`   | —                                          | `generate-arclen-inputs.mjs` | input to the arclen generators                |
| `offset-inputs.txt`   | —                                          | `generate-offset-inputs.mjs` | input to `kurbo-gen --bin offset`             |

## Requirements

Only for the generators you run:

- Node, for the `.mjs` generators (`npm install` first, for svg-arc-to-cubic-bezier).
- Rust, for `kurbo-gen`. With Homebrew's rustup, `cargo` is in
  `$(brew --prefix rustup)/bin`, which has to be on your `PATH`.
- Python 3, for fontTools, installed without Cython so that the pure Python code
  runs (the generators stop if it is compiled):

  ```sh
  FONTTOOLS_WITH_CYTHON=0 python3 -m pip install -r test/fixtures/requirements.txt
  ```

- git and clang++ (macOS), for Skia and stroke-outline.
- A JDK, for `generate-colomitchi.sh`.

## Regenerating

```sh
# kurbo
cargo run --release --locked --manifest-path test/fixtures/kurbo-gen/Cargo.toml > test/fixtures/kurbo.json
cargo run --release --locked --manifest-path test/fixtures/kurbo-gen/Cargo.toml --bin arclen < test/fixtures/arclen-inputs.txt > test/fixtures/arclen-kurbo.json
cargo run --release --locked --manifest-path test/fixtures/kurbo-gen/Cargo.toml --bin offset < test/fixtures/offset-inputs.txt > test/fixtures/offset-kurbo.json

# Skia (generate-skia.sh first: generate-skia-arclen.sh uses its build)
sh test/fixtures/generate-skia.sh > test/fixtures/skia.json
sh test/fixtures/generate-skia-arclen.sh < test/fixtures/arclen-inputs.txt > test/fixtures/arclen-skia.json

# stroke-outline
sh test/fixtures/generate-stroke-outline.sh > test/fixtures/stroke-outline.json

# fontTools
python3 test/fixtures/generate-cu2qu.py > test/fixtures/cu2qu.json
python3 test/fixtures/generate-point-inside.py > test/fixtures/point-inside.json

# svg-arc-to-cubic-bezier
node test/fixtures/generate-svg-arc.mjs > test/fixtures/svg-arc.json

# bezier-utils
sh test/fixtures/generate-colomitchi.sh > test/fixtures/colomitchi.json

# inputs
node test/fixtures/generate-arclen-inputs.mjs > test/fixtures/arclen-inputs.txt
node test/fixtures/generate-offset-inputs.mjs > test/fixtures/offset-inputs.txt
```

The Skia and stroke-outline generators clone their pinned commit into
`test/fixtures/.cache/` (gitignored) the first time, or use a checkout you
pass as the first argument. Skia's first run also syncs its dependencies and
builds it, which takes a while. bezier-utils is not on any registry and
caffeineowl.com is only archived, so the sources of its bezier-utils-src.jar
are committed as `colomitchi-gen/bezier-utils-src.zip` (MIT licensed);
`generate-colomitchi.sh` extracts them into `test/fixtures/.cache/` the first
time, or uses a folder given as the first argument.

The generators are deterministic, so an unchanged reference gives the same
values. `cu2qu.json` is committed pretty-printed, so compare its values rather
than its bytes.

## Testing and measuring

```sh
npm test                               # build, then run test/*.test.mjs against the fixtures
node test/fixtures/measure-arclen.mjs  # after npm run build: arc-length errors against kurbo and Skia
node test/fixtures/measure-offset.mjs  # after npm run build: offset errors against the true offset and kurbo
```

The measure scripts print the errors and timings behind the tolerances in the
tests and in `src/offset.ts`.
