// pxtnError.h / pxtnError.cpp 相当

export enum PxtnErr {
  OK = 0,
  VOID,
  INIT,
  FATAL,
  ANTI_OPERATION,
  DENY_BEATCLOCK,
  DESC_W,
  DESC_R,
  DESC_BROKEN,
  FMT_NEW,
  FMT_UNKNOWN,
  INV_CODE,
  INV_DATA,
  MEMORY,
  MOO_INIT,
  OGG,
  OGG_NO_SUPPORTED,
  PARAM,
  PCM_CONVERT,
  PCM_UNKNOWN,
  PTN_BUILD,
  PTN_INIT,
  PTV_NO_SUPPORTED,
  TOO_MUCH_EVENT,
  Woice_FULL,
  X1X_IGNORE,
  X3X_ADD_TUNING,
  X3X_KEY,
  NUM,
}

const ERR_MSG_TABLE: readonly string[] = [
  "OK",
  "VOID",
  "INIT",
  "FATAL",
  "anti operation",
  "deny beatclock",
  "desc w",
  "desc r",
  "desc broken ",
  "fmt new ",
  "fmt unknown ",
  "inv code",
  "inv data",
  "memory",
  "moo init",
  "ogg ",
  "ogg no supported",
  "param ",
  "pcm convert ",
  "pcm unknown ",
  "ptn build ",
  "ptn init",
  "ptv no supported",
  "too much event",
  "woice full",
  "x1x ignore",
  "x3x add tuning",
  "x3x key ",
  "?",
];

export function pxtnErrorGetString(errCode: PxtnErr): string {
  if (errCode < 0 || errCode >= PxtnErr.NUM) return ERR_MSG_TABLE[PxtnErr.NUM] ?? "?";
  return ERR_MSG_TABLE[errCode] ?? "?";
}

export class PxtnError extends Error {
  readonly code: PxtnErr;

  constructor(code: PxtnErr, message?: string) {
    super(message ?? pxtnErrorGetString(code));
    this.name = "PxtnError";
    this.code = code;
  }
}

export function isErr(x: unknown): x is PxtnErr {
  return typeof x === "number" && x !== PxtnErr.OK;
}

export function okOrThrow(err: PxtnErr): void {
  if (err !== PxtnErr.OK) throw new PxtnError(err);
}