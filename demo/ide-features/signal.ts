/** Return the mean amplitude of a signal. */
export function average(samples: number[]): number {
  return samples.reduce((sum, value) => sum + value, 0) / samples.length;
}

/** Find the largest absolute sample amplitude. */
export function peakAmplitude(samples: number[]): number {
  return Math.max(...samples.map(Math.abs));
}

/** Compute both measurements for a report. */
export function summarizeSignal(samples: number[]) {
  return { mean: average(samples), peak: peakAmplitude(samples) };
}

const samples = [0.2, 0.8, -0.4, 0.5, 1.0];
const amplitude: number = "high";
console.log(summarizeSignal(samples), amplitude);
