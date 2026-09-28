import WebSocket from 'ws';
import type { TestResult } from '../connections/registry.js';

/**
 * AISStream.io client (wss://stream.aisstream.io/v0/stream).
 * Subscribes to PositionReport messages for a set of MMSIs and resolves with
 * the positions received within `windowMs`. Used by the periodic AIS job.
 */

export interface AisPosition {
  mmsi: string;
  lat: number;
  lon: number;
  sog: number | null;
  cog: number | null;
  heading: number | null;
  navStatus: string | null;
  observedAt: Date;
}

const URL = 'wss://stream.aisstream.io/v0/stream';

export function collectPositions(apiKey: string, mmsis: string[], windowMs = 20_000): Promise<AisPosition[]> {
  return new Promise((resolve, reject) => {
    const positions = new Map<string, AisPosition>();
    const ws = new WebSocket(URL);
    const timer = setTimeout(() => {
      ws.close();
      resolve([...positions.values()]);
    }, windowMs);
    ws.on('open', () => {
      ws.send(
        JSON.stringify({
          APIKey: apiKey,
          BoundingBoxes: [
            [
              [-90, -180],
              [90, 180],
            ],
          ],
          FiltersShipMMSI: mmsis.slice(0, 50),
          FilterMessageTypes: ['PositionReport'],
        }),
      );
    });
    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString()) as {
          error?: string;
          MetaData?: { MMSI?: number; latitude?: number; longitude?: number; time_utc?: string };
          Message?: {
            PositionReport?: {
              Latitude: number;
              Longitude: number;
              Sog: number;
              Cog: number;
              TrueHeading: number;
              NavigationalStatus: number;
            };
          };
        };
        if (msg.error) {
          clearTimeout(timer);
          ws.close();
          reject(new Error(msg.error));
          return;
        }
        const pr = msg.Message?.PositionReport;
        const mmsi = String(msg.MetaData?.MMSI ?? '');
        if (!pr || !mmsi) return;
        positions.set(mmsi, {
          mmsi,
          lat: pr.Latitude,
          lon: pr.Longitude,
          sog: Number.isFinite(pr.Sog) ? pr.Sog : null,
          cog: Number.isFinite(pr.Cog) ? pr.Cog : null,
          heading: pr.TrueHeading === 511 ? null : pr.TrueHeading,
          navStatus: String(pr.NavigationalStatus),
          observedAt: msg.MetaData?.time_utc
            ? new Date(msg.MetaData.time_utc.replace(' +0000 UTC', 'Z').replace(' ', 'T'))
            : new Date(),
        });
      } catch {
        /* ignore malformed frames */
      }
    });
    ws.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
  });
}

export async function testAisStream(apiKey: string): Promise<TestResult> {
  if (!apiKey) return { ok: false, message: 'API Key를 입력하세요.' };
  return new Promise((resolve) => {
    const ws = new WebSocket(URL);
    const timer = setTimeout(() => {
      ws.close();
      resolve({ ok: true, message: '연결 성공 (스트림 수신 대기)' });
    }, 6000);
    ws.on('open', () =>
      ws.send(
        JSON.stringify({
          APIKey: apiKey,
          BoundingBoxes: [
            [
              [34, 128],
              [36, 130],
            ],
          ],
        }),
      ),
    );
    ws.on('message', (d) => {
      const text = d.toString();
      clearTimeout(timer);
      ws.close();
      resolve(
        text.includes('error')
          ? { ok: false, message: text.slice(0, 200) }
          : { ok: true, message: '연결 성공 (AIS 메시지 수신)' },
      );
    });
    ws.on('error', (e) => {
      clearTimeout(timer);
      resolve({ ok: false, message: e.message });
    });
  });
}
