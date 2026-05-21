import { clamp, round2 } from '@sigma/shared';

export interface PriceObservation {
  item: string;
  unit: string;
  price: number;
  refPrice: number;
}

export interface PriceAnomaly {
  item: string;
  /** Signed deviation from reference: positive = overpriced. */
  deviationPct: number;
  /** 0–100 severity, used as the `price` risk signal. */
  severity: number;
}

export function detectPriceAnomaly(obs: PriceObservation): PriceAnomaly {
  const deviationPct =
    obs.refPrice > 0 ? round2(((obs.price - obs.refPrice) / obs.refPrice) * 100) : 0;
  // Severity ramps linearly from 0 at parity to 100 at +/-50% deviation.
  const severity = clamp((Math.abs(deviationPct) / 50) * 100, 0, 100);
  return { item: obs.item, deviationPct, severity: round2(severity) };
}

export function aggregatePriceSignal(anomalies: PriceAnomaly[]): number {
  if (anomalies.length === 0) return 0;
  const total = anomalies.reduce((sum, a) => sum + a.severity, 0);
  return round2(total / anomalies.length);
}
