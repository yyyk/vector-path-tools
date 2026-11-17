# Sourced by the generate-*.sh scripts. checkout NAME URL COMMIT prints the
# folder of a shallow clone of URL at COMMIT, in test/fixtures/.cache/NAME,
# cloning it the first time (or again when it is at another commit).
checkout() {
  dir="$here/.cache/$1"
  if [ "$(git -C "$dir" rev-parse HEAD 2>/dev/null)" != "$3" ]; then
    rm -rf "$dir"
    mkdir -p "$dir"
    git -C "$dir" init -q
    git -C "$dir" fetch -q --depth 1 "$2" "$3"
    git -C "$dir" checkout -q FETCH_HEAD
  fi >&2
  echo "$dir"
}
