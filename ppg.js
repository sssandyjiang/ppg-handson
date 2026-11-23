// Camera PPG: turn the brightness of your fingertip into a heart rate.
// All processing runs on your device; the video never leaves it.
//
// The two sliders on the page change THRESHOLD and MIN_GAP (the peak-counting rule).

const THRESHOLD = 0.4; // a beat must reach 40% of the highest point within ±1 s
const MIN_GAP = 0.3;   // seconds; two beats closer than this count as one (max 200 bpm)

// Average red, green, blue of one camera frame (ImageData.data).
function meanRGB(data) {
  let r = 0, g = 0, b = 0;
  const n = data.length / 4;
  for (let i = 0; i < data.length; i += 4) { r += data[i]; g += data[i + 1]; b += data[i + 2]; }
  return [r / n, g / n, b / n];
}

// A fingertip lit from behind fills the whole image with bright red.
function fingerOnLens([r, g, b]) {
  return r > 90 && r > 1.6 * g && r > 1.6 * b;
}

function movingAverage(x, half) {
  const out = new Array(x.length);
  let sum = 0, lo = 0, hi = -1;
  for (let i = 0; i < x.length; i++) {
    const a = Math.max(0, i - half), b = Math.min(x.length - 1, i + half);
    while (hi < b) sum += x[++hi];
    while (lo < a) sum -= x[lo++];
    out[i] = sum / (hi - lo + 1);
  }
  return out;
}

function sampleRate(t) {
  return t.length > 1 ? (t.length - 1) / (t[t.length - 1] - t[0]) : 30;
}

// Step 1 — filter: keep heartbeat speeds, drop the slow drift and the fast noise.
// More blood makes the image darker, so the sign is flipped: each beat becomes a peak.
function filterSignal(red, t) {
  const fs = sampleRate(t);
  const trend = movingAverage(red, Math.round(0.4 * fs));
  const smooth = movingAverage(red, Math.max(1, Math.round(0.05 * fs)));
  return smooth.map((v, i) => trend[i] - v);
}

// Step 2 — find each beat: the peak-counting rule.
function findPeaks(y, t, threshold = THRESHOLD, minGap = MIN_GAP) {
  const half = Math.round(1 * sampleRate(t)); // compare each peak with its ±1 s neighbourhood
  const peaks = [];
  for (let i = 1; i < y.length - 1; i++) {
    const isLocalMax = y[i] > y[i - 1] && y[i] >= y[i + 1];
    if (!isLocalMax) continue;
    let top = -Infinity;
    for (let j = Math.max(0, i - half); j <= Math.min(y.length - 1, i + half); j++) top = Math.max(top, y[j]);
    if (top <= 0 || y[i] < threshold * top) continue;
    const last = peaks[peaks.length - 1];
    if (last !== undefined && t[i] - t[last] < minGap) {
      if (y[i] > y[last]) peaks[peaks.length - 1] = i; // keep the higher of two close peaks
    } else {
      peaks.push(i);
    }
  }
  return peaks;
}

// Steps 3–4 — gaps between beats (IBI), then heart rate = 60 / average gap.
function heartRate(peakTimes) {
  if (peakTimes.length < 3) return null;
  const ibis = peakTimes.slice(1).map((v, i) => v - peakTimes[i]);
  const meanIbi = ibis.reduce((a, b) => a + b, 0) / ibis.length;
  return { bpm: 60 / meanIbi, beats: peakTimes.length, ibis };
}

// The whole chain. red = brightness values, t = times in seconds.
function analyse(red, t, threshold = THRESHOLD, minGap = MIN_GAP) {
  const y = filterSignal(red, t);
  const edge = 0.75; // the filter is unreliable at the very start and end
  const peaks = findPeaks(y, t, threshold, minGap).filter(i => t[i] - t[0] > edge && t[t.length - 1] - t[i] > edge);
  return { y, peaks, hr: heartRate(peaks.map(i => t[i])) };
}

// Step 5 — should we trust it? Peaks are always found somewhere; a pulse is reported only if
// the finger stayed on the lens and the beats came at a steady pace.
// Returns null (looks like a pulse) or the reason for "no pulse".
// ponytail: an irregular heart rhythm (e.g. AF) would also be rejected; fine for a class demo.
function checkQuality(hr, fingerShare = 1, minBeats = 10) {
  if (fingerShare < 0.8) return 'finger off the lens';
  if (!hr || hr.beats < minBeats) return 'too few beats';
  const gaps = [...hr.ibis].sort((a, b) => a - b);
  const median = gaps[Math.floor(gaps.length / 2)];
  const odd = hr.ibis.filter(g => Math.abs(g - median) > 0.25 * median).length;
  if (odd > 0.2 * hr.ibis.length) return 'beats too irregular';
  return null;
}

// RMSSD (ms): the typical jump from one gap between beats to the next (HRV).
function rmssd(ibis) {
  const d = ibis.slice(1).map((g, i) => (g - ibis[i]) * 1000);
  return d.length ? Math.sqrt(d.reduce((s, v) => s + v * v, 0) / d.length) : null;
}
