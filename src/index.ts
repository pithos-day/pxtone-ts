// pxtone-ts パッケージの公開 API
// ピストンコラージュ互換エンジンのメインエントリポイント。

// エラー
export { PxtnErr, PxtnError, pxtnErrorGetString, isErr, okOrThrow } from "./error.js";

// IO 層 (MemoryIo と io ヘルパ)
export {
  MemoryIo,
  SEEK_SET,
  SEEK_CUR,
  SEEK_END,
  ioGetU8,
  ioPutU8,
  ioGetInt8,
  ioPutInt8,
  ioGetU16LE,
  ioPutU16LE,
  ioGetUint16LE,
  ioPutUint16LE,
  ioGetInt16LE,
  ioPutInt16LE,
  ioGetInt32LE,
  ioPutInt32LE,
  ioGetUint32LE,
  ioPutUint32LE,
  ioGetFloatLE,
  ioPutFloatLE,
  ioGetBytes,
  ioGetAsciiString,
  floatToInt32Bits,
  int32ToFloat,
  intToVBytes,
  dataCheckVSize,
  dataWriteV,
  dataReadV,
} from "./data.js";

// イベント・曲メタ
export {
  EventKind,
  eventKindIsTail,
  comparePriority,
  EVENTDEFAULT_VOLUME,
  EVENTDEFAULT_VELOCITY,
  EVENTDEFAULT_PAN_VOLUME,
  EVENTDEFAULT_PAN_TIME,
  EVENTDEFAULT_PORTAMENT,
  EVENTDEFAULT_VOICENO,
  EVENTDEFAULT_GROUPNO,
  EVENTDEFAULT_KEY,
  EVENTDEFAULT_BASICKEY,
  EVENTDEFAULT_TUNING,
  EVENTDEFAULT_BEATNUM,
  EVENTDEFAULT_BEATTEMPO,
  EVENTDEFAULT_BEATCLOCK,
} from "./event.js";
export { Evelist, type EveRecord } from "./evelist.js";
export { Master } from "./master.js";
export { PxtnText, shiftJisToString, encodeUtf8, encodeShiftJis } from "./text.js";

// エフェクト
export { Delay, DelayUnit } from "./delay.js";
export {
  OverDrive,
  TUNEOVERDRIVE_CUT_MAX,
  TUNEOVERDRIVE_CUT_MIN,
  TUNEOVERDRIVE_AMP_MAX,
  TUNEOVERDRIVE_AMP_MIN,
  TUNEOVERDRIVE_DEFAULT_CUT,
  TUNEOVERDRIVE_DEFAULT_AMP,
} from "./overdrive.js";

// 音源基盤
export { Frequency } from "./frequency.js";
export { Oscillator, type PulsePoint } from "./osc.js";
export { Pcm } from "./pcm.js";
export { Noise, WaveType, type NoiseOscillator, type NoiseUnit } from "./noise.js";
export { NoiseBuilder } from "./noise-builder.js";

// ボイス定義・発音状態
export {
  Woice,
  WoiceType,
  VoiceType,
  PTV_VOICEFLAG_WAVELOOP,
  PTV_VOICEFLAG_SMOOTH,
  PTV_VOICEFLAG_BEATFIT,
  PTV_VOICEFLAG_UNCOVERED,
  PTV_DATAFLAG_WAVE,
  PTV_DATAFLAG_ENVELOPE,
  PTV_DATAFLAG_UNCOVERED,
  type VoiceEnvelope,
  type VoiceUnit,
  type VoiceInstance,
} from "./woice.js";
export { Unit, type VoiceTone } from "./unit.js";

// Service (ptcop 読み書き + Moo レンダラー)
export { Service, type VomitPreparation, pxtnServiceMooCalcSampleNum } from "./service.js";

// OGG Vorbis デコード
export {
  WasmOggvDecoder,
  defaultOggvDecoder,
  convertOggvToPcm,
  type OggvDecoder,
  type OggvDecoded,
} from "./oggv.js";

// 制限値・ファイルフォーマット定数
export {
  PXTN_MAX_CHANNEL,
  PXTN_MAX_TUNE_UNIT_STRUCT,
  PXTN_MAX_TUNE_WOICE_STRUCT,
  PXTN_MAX_EVENT_NUM,
  PXTN_MAX_TUNE_GROUP_NUM,
  PXTN_MAX_TUNE_DELAY_STRUCT,
  PXTN_MAX_TUNE_OVERDRIVE_STRUCT,
  PXTN_MAX_STREAMING_VOICE,
  PXTN_MAX_RELEASE_POINT,
  CLOCK_ROUGH,
  PXTN_MAX_TUNE_UNIT_NAME,
  PXTN_VERSIONSIZE,
  PXTN_CODESIZE,
  PXTN_TUNE,
  PXTN_PROJECT,
  PXTONE_ERRORSIZE,
  PXTN_VOMIT_PREP_FLAG_LOOP,
  PXTN_VOMIT_PREP_FLAG_UNIT_MUTE,
  PXTN_DELAY_NUM_LIMIT,
  PXTN_MAX_UNIT_CONTROL_VOICE,
  PXTN_BUFSIZE_TIMEPAN,
  PXTN_BITPERSAMPLE,
  PXTN_MAX_TUNEWOICENAME,
  PXTN_VOICEUNIT_VOICE_NUM_LIMIT,
  PXTN_PTV_FILEID,
  PXTN_PTV_VERSION,
  PXTN_PTN_FILEID,
  PXTN_PTN_VERSION,
  PXTN_BASIC_SPS,
} from "./constants.js";

// AudioWorklet プレイヤーのメッセージ型
export type { MainToWorklet, WorkletToMain } from "./worklet/messages.js";
