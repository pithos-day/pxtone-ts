#!/usr/bin/env bash
# 参照C++ツール一式を g++ でビルドする。
# 用法: ./build.sh          ... 全ツールをビルド
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
PXTONE="/home/admin/Documents/References/Pxtone/pxtone-source-code 220910a/pxtone"
OUT="$HERE/build"
mkdir -p "$OUT"

CXX="${CXX:-g++}"
CXXFLAGS=(-O2 -std=c++17 -I"$PXTONE")

build() {
  local name="$1"; shift
  echo "== build $name =="
  "$CXX" "${CXXFLAGS[@]}" "$@" -o "$OUT/$name"
}

build varint_ref "$HERE/varint_ref.cpp" "$PXTONE/pxtnData.cpp"

echo "done."