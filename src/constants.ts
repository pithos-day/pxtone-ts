// pxtnMax.h 相当の制限値・定数
// (C++ ヘッダとの対照用に公開しているが、内部で未使用のものも含む)

export const PXTN_MAX_CHANNEL = 2;
export const PXTN_MAX_TUNE_UNIT_STRUCT = 50;
export const PXTN_MAX_TUNE_WOICE_STRUCT = 100;
export const PXTN_MAX_EVENT_NUM = 500000;
export const PXTN_MAX_TUNE_GROUP_NUM = 7;
export const PXTN_MAX_TUNE_DELAY_STRUCT = 4;
export const PXTN_MAX_TUNE_OVERDRIVE_STRUCT = 2;
export const PXTN_MAX_STREAMING_VOICE = 10; // 未使用 (C++ 互換のため公開)
export const PXTN_MAX_RELEASE_POINT = 1; // 未使用 (C++ 互換のため公開)
export const CLOCK_ROUGH = 10;
export const PXTN_MAX_TUNE_UNIT_NAME = 16;

// バージョン識別コード
export const PXTN_VERSIONSIZE = 16;
export const PXTN_CODESIZE = 8;
export const PXTN_TUNE = "PTTUNE--2005XXXX";
export const PXTN_PROJECT = "PTCOLLAGE-XXXXXX";

// pxtnService.h
export const PXTONE_ERRORSIZE = 64; // 未使用 (C++ 互換のため公開)
export const PXTN_VOMIT_PREP_FLAG_LOOP = 0x01;
export const PXTN_VOMIT_PREP_FLAG_UNIT_MUTE = 0x02;

// pxtnDelay.h
export const PXTN_DELAY_NUM_LIMIT = 4; // 未使用 (C++ 互換のため公開)

// pxtnUnit / woice
export const PXTN_MAX_UNIT_CONTROL_VOICE = 2;
export const PXTN_BUFSIZE_TIMEPAN = 0x40;
export const PXTN_BITPERSAMPLE = 16;
export const PXTN_MAX_TUNEWOICENAME = 16;

// pxtnWoice.h
export const PXTN_VOICEUNIT_VOICE_NUM_LIMIT = 4; // 未使用 (C++ 互換のため公開)

// 基準サンプルレート (キャッシュ生成・パン時間換算に使用)
export const PXTN_BASIC_SPS = 44100;

// PCTN (PTV)
export const PXTN_PTV_FILEID = "PTVOICE-";
export const PXTN_PTV_VERSION = 20060111;

// PTN
export const PXTN_PTN_FILEID = "PTNOISE-";
export const PXTN_PTN_VERSION = 20120418;