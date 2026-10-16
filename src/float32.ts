// C++ の float (32bit, 24bit 仮数) 演算の再現ヘルパー
//
// TS の number は倍精度のため、C++ の float 演算と結果がずれる箇所がある。
// 演算の入出力を Math.fround で float32 に丸めることで C++ と一致させる。

// C++ の `(float)a * b` と等価。
// a は int など倍精度側の値、b は float32 で表現できる値
// (float 型フィールドや Math.fround 済みの値) を渡す。
export function f32Mul(a: number, b: number): number {
  return Math.fround(Math.fround(a) * b);
}

// C++ の `(float)a / b` と等価。
// a は int など倍精度側の値、b は float32 で表現できる値。
export function f32Div(a: number, b: number): number {
  return Math.fround(Math.fround(a) / b);
}
