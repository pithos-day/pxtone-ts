// 参照C++実装（pxtone本家ソース）を使った varint のエンコード/デコード検証ツール
//
// 使い方: varint_ref <value>...
//   各 value(int32) を pxtnData::_data_w_v でエンコードし、そのバイト列(hex)と、
//   デコード復元値を出力する。TS実装との一致確認に使用する。
//
// ビルド:
//   g++ -O2 -std=c++17 -I"<pxtone dir>" varint_ref.cpp "<pxtone dir>/pxtnData.cpp" -o varint_ref

#include "pxtnData.h"

#include <cstdio>
#include <cstring>
#include <cstdlib>
#include <vector>
#include <string>

struct Buf {
  std::vector<uint8_t> data;
  int32_t pos = 0;
};

static bool r(void* u, void* dst, int32_t size, int32_t num) {
  Buf* b = static_cast<Buf*>(u);
  int32_t n = size * num;
  if (n < 0 || b->pos + n > static_cast<int32_t>(b->data.size())) return false;
  memcpy(dst, &b->data[b->pos], static_cast<size_t>(n));
  b->pos += n;
  return true;
}
static bool w(void* u, const void* src, int32_t size, int32_t num) {
  Buf* b = static_cast<Buf*>(u);
  int32_t n = size * num;
  if (n < 0) return false;
  const uint8_t* p = static_cast<const uint8_t*>(src);
  b->data.insert(b->data.end(), p, p + n);
  return true;
}
static bool s(void* u, int mode, int32_t size) {
  Buf* b = static_cast<Buf*>(u);
  if (mode == SEEK_SET) b->pos = size;
  else if (mode == SEEK_CUR) b->pos += size;
  else if (mode == SEEK_END) b->pos = static_cast<int32_t>(b->data.size()) + size;
  else return false;
  return true;
}
static bool p(void* u, int32_t* ppos) {
  Buf* b = static_cast<Buf*>(u);
  *ppos = b->pos;
  return true;
}

class D : public pxtnData {
 public:
  D() = default;
  explicit D(pxtnIO_r io_read, pxtnIO_w io_write, pxtnIO_seek io_seek, pxtnIO_pos io_pos) {
    _set_io_funcs(io_read, io_write, io_seek, io_pos);
  }
  using pxtnData::_data_w_v;
  using pxtnData::_data_r_v;
  using pxtnData::_data_check_v_size;
};

static std::string hex(const std::vector<uint8_t>& v) {
  static const char* d = "0123456789abcdef";
  std::string out;
  for (uint8_t c : v) {
    out.push_back(d[c >> 4]);
    out.push_back(d[c & 0xf]);
  }
  return out;
}

int main(int argc, char** argv) {
  D d(r, w, s, p);

  for (int i = 1; i < argc; i++) {
    int32_t v = static_cast<int32_t>(strtol(argv[i], nullptr, 0));

    Buf b;
    {
      // encode
      D enc(r, w, s, p);
      int added = 0;
      if (!enc._data_w_v(&b, v, &added)) { printf("enc-err %d\n", v); continue; }
    }
    std::string enc_hex = hex(b.data);
    int enc_size = static_cast<int>(b.data.size());

    // decode
    b.pos = 0;
    int32_t back = 0;
    bool ok = d._data_r_v(&b, &back);
    size_t consumed = static_cast<size_t>(b.pos);

    printf("%d %s size=%d consumed=%zu ", v, enc_hex.c_str(), enc_size, consumed);
    if (!ok) printf("dec-err");
    else printf("dec=%d", back);
    printf("\n");
  }
  return 0;
}