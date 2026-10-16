// pxtnPulse_Oscillator.cpp 相当（座標波形・倍音波形の1サンプル計算）

// 波形ポイントの音量スケール (最大ボリューム 128)
const MAX_VOLUME = 128;

export interface PulsePoint {
  x: number;
  y: number;
}

export class Oscillator {
  private _volume = 0;
  private _pPoint: PulsePoint[] = [];
  private _sampleNum = 0;
  private _pointNum = 0;
  private _pointReso = 0;

  readyGetSample(
    pPoint: PulsePoint[],
    pointNum: number,
    volume: number,
    sampleNum: number,
    pointReso: number,
  ): void {
    this._volume = volume;
    this._pPoint = pPoint;
    this._sampleNum = sampleNum;
    this._pointNum = pointNum;
    this._pointReso = pointReso;
  }

  getOneSampleOvertone(index: number): number {
    const pi = 3.1415926535897932;
    let work = 0;
    for (let o = 0; o < this._pointNum; o++) {
      const phase = (2 * pi * this._pPoint[o]!.x * index) / this._sampleNum;
      work += (Math.sin(phase) * this._pPoint[o]!.y) / this._pPoint[o]!.x / MAX_VOLUME;
    }
    return (work * this._volume) / MAX_VOLUME;
  }

  getOneSampleCoodinate(index: number): number {
    const p = this._pPoint;
    let i = Math.trunc((this._pointReso * index) / this._sampleNum);
    let c = 0;
    while (c < this._pointNum) {
      if (p[c]!.x > i) break;
      c++;
    }
    let x1: number;
    let y1: number;
    let x2: number;
    let y2: number;
    if (c === this._pointNum) {
      // 全ポイントを過ぎた: 最後の点から先頭の点へ折り返す (ラップ)
      x1 = p[c - 1]!.x;
      y1 = p[c - 1]!.y;
      x2 = this._pointReso;
      y2 = p[0]!.y;
    } else if (c) {
      x1 = p[c - 1]!.x;
      y1 = p[c - 1]!.y;
      x2 = p[c]!.x;
      y2 = p[c]!.y;
    } else {
      x1 = p[0]!.x;
      y1 = p[0]!.y;
      x2 = p[0]!.x;
      y2 = p[0]!.y;
    }
    const w = x2 - x1;
    i = i - x1;
    const h = y2 - y1;
    const work = i !== 0 ? y1 + (h * i) / w : y1;
    return (work * this._volume) / MAX_VOLUME / MAX_VOLUME;
  }
}
