// pxtnEvelist.h の EVENTKIND とデフォルト値相当

export enum EventKind {
  NULL = 0,
  ON = 1,
  KEY = 2,
  PAN_VOLUME = 3,
  VELOCITY = 4,
  VOLUME = 5,
  PORTAMENT = 6,
  BEATCLOCK = 7,
  BEATTEMPO = 8,
  BEATNUM = 9,
  REPEAT = 10,
  LAST = 11,
  VOICENO = 12,
  GROUPNO = 13,
  TUNING = 14,
  PAN_TIME = 15,
  NUM = 16,
}

export const EVENTDEFAULT_VOLUME = 104;
export const EVENTDEFAULT_VELOCITY = 104;
export const EVENTDEFAULT_PAN_VOLUME = 64;
export const EVENTDEFAULT_PAN_TIME = 64;
export const EVENTDEFAULT_PORTAMENT = 0;
export const EVENTDEFAULT_VOICENO = 0;
export const EVENTDEFAULT_GROUPNO = 0;
export const EVENTDEFAULT_KEY = 0x6000;
export const EVENTDEFAULT_BASICKEY = 0x4500;
export const EVENTDEFAULT_TUNING = 1.0;

export const EVENTDEFAULT_BEATNUM = 4;
export const EVENTDEFAULT_BEATTEMPO = 120;
export const EVENTDEFAULT_BEATCLOCK = 480;

export function eventKindIsTail(kind: number): boolean {
  return kind === EventKind.ON || kind === EventKind.PORTAMENT;
}

// パン値 (0..127、中央 64) を左右チャンネルの音量へ変換する。
// 中央より右なら左を減衰、左なら右を減衰する。
export function panToVolumes(pan: number): [number, number] {
  const volumes: [number, number] = [64, 64];
  if (pan > 64) volumes[0] = 128 - pan;
  else if (pan < 64) volumes[1] = pan;
  return volumes;
}

const PRIORITY_TABLE: readonly number[] = [
  0, // NULL
  50, // ON
  40, // KEY
  60, // PAN_VOLUME
  70, // VELOCITY
  80, // VOLUME
  30, // PORTAMENT
  0, // BEATCLOCK
  0, // BEATTEMPO
  0, // BEATNUM
  0, // REPEAT
  255, // LAST
  10, // VOICENO
  20, // GROUPNO
  90, // TUNING
  100, // PAN_TIME
];

export function comparePriority(kind1: number, kind2: number): number {
  return (PRIORITY_TABLE[kind1] ?? 0) - (PRIORITY_TABLE[kind2] ?? 0);
}