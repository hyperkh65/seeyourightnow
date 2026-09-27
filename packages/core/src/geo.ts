/**
 * Geo helpers for shipment tracking. Estimated routes are labelled as such:
 * they are never rendered as actual positions.
 */

export interface LatLon {
  lat: number;
  lon: number;
}

const R_KM = 6371.0088;
const toRad = (d: number) => (d * Math.PI) / 180;
const toDeg = (r: number) => (r * 180) / Math.PI;

export function haversineKm(a: LatLon, b: LatLon): number {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

export const KM_PER_NM = 1.852;

export function insideGeofence(p: LatLon, center: LatLon, radiusKm: number): boolean {
  return haversineKm(p, center) <= radiusKm;
}

/** Great-circle interpolation, used only to draw an *estimated* route line. */
export function greatCirclePoints(a: LatLon, b: LatLon, segments = 32): LatLon[] {
  const φ1 = toRad(a.lat);
  const λ1 = toRad(a.lon);
  const φ2 = toRad(b.lat);
  const λ2 = toRad(b.lon);
  const d = 2 * Math.asin(Math.sqrt(Math.sin((φ2 - φ1) / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin((λ2 - λ1) / 2) ** 2));
  if (d === 0) return [a, b];
  const pts: LatLon[] = [];
  for (let i = 0; i <= segments; i++) {
    const f = i / segments;
    const A = Math.sin((1 - f) * d) / Math.sin(d);
    const B = Math.sin(f * d) / Math.sin(d);
    const x = A * Math.cos(φ1) * Math.cos(λ1) + B * Math.cos(φ2) * Math.cos(λ2);
    const y = A * Math.cos(φ1) * Math.sin(λ1) + B * Math.cos(φ2) * Math.sin(λ2);
    const z = A * Math.sin(φ1) + B * Math.sin(φ2);
    pts.push({ lat: toDeg(Math.atan2(z, Math.sqrt(x * x + y * y))), lon: toDeg(Math.atan2(y, x)) });
  }
  return pts;
}

/**
 * AIS-based ETA: remaining great-circle distance / speed over ground.
 * Returns null when the vessel is effectively stationary or data is missing.
 */
export function aisEta(position: LatLon, speedKnots: number | null | undefined, destination: LatLon, at: Date): Date | null {
  if (!speedKnots || speedKnots < 3) return null;
  const km = haversineKm(position, destination) * 1.15; // routing factor: sea lanes are longer than great circle
  const hours = km / KM_PER_NM / speedKnots;
  return new Date(at.getTime() + hours * 3_600_000);
}

export function isAisStale(timestamp: Date | string | null | undefined, now = new Date(), maxHours = 6): boolean {
  if (!timestamp) return true;
  return now.getTime() - new Date(timestamp).getTime() > maxHours * 3_600_000;
}
