import { Injectable } from '@nestjs/common';
import {
  eciToEcf,
  eciToGeodetic,
  gstime,
  propagate,
  twoline2satrec,
} from 'satellite.js';
import type { EphemerisSourceType, EphemerisView } from '@application/ntn/ntn.repository';
import type { TrajectoryProvider, TrajectoryState } from './trajectory-provider';

export interface ParsedTle {
  name: string | null;
  line1: string;
  line2: string;
  catalogId: number;
  epochUtc: Date;
}

/** Parses validated TLE data and propagates it using SGP4. */
@Injectable()
export class TleSgp4TrajectoryProvider implements TrajectoryProvider {
  supports(sourceType: EphemerisSourceType): boolean { return sourceType === 'TLE'; }

  propagate(ephemeris: EphemerisView, at: Date): TrajectoryState {
    if (!ephemeris.rawText) throw new Error('TLE ephemeris has no raw text');
    const tle = parseTle(ephemeris.rawText);
    const satellite = twoline2satrec(tle.line1, tle.line2);
    const result = propagate(satellite, at);
    if (!result || !result.position || typeof result.position === 'boolean' || !result.velocity || typeof result.velocity === 'boolean') {
      throw new Error('SGP4 could not propagate the TLE at the requested time');
    }
    const siderealTime = gstime(at);
    const geodetic = eciToGeodetic(result.position, siderealTime);
    const earthFixed = eciToEcf(result.position, siderealTime);
    return {
      timestamp: at,
      latitude: (geodetic.latitude * 180) / Math.PI,
      longitude: (((geodetic.longitude * 180) / Math.PI + 540) % 360) - 180,
      altitudeM: geodetic.height * 1000,
      speedMps: Math.hypot(result.velocity.x, result.velocity.y, result.velocity.z) * 1000,
      ecefPositionM: { x: earthFixed.x * 1000, y: earthFixed.y * 1000, z: earthFixed.z * 1000 },
      sourceType: ephemeris.sourceType,
      sourceRevision: ephemeris.id,
    };
  }
}

export function parseTle(text: string): ParsedTle {
  if (text.length > 16_384) throw new Error('TLE payload exceeds 16 KiB');
  const lines = text.replace(/\r/g, '').split('\n').map((line) => line.trimEnd()).filter(Boolean);
  if (lines.length !== 2 && lines.length !== 3) throw new Error('TLE must contain two element lines and an optional name line');
  const name = lines.length === 3 ? lines[0] ?? null : null;
  const line1 = lines.at(-2) as string;
  const line2 = lines.at(-1) as string;
  if (line1.length !== 69 || line2.length !== 69) throw new Error('Each TLE element line must contain exactly 69 characters');
  if (!line1.startsWith('1 ') || !line2.startsWith('2 ')) throw new Error('TLE line numbers are invalid');
  const catalog1 = Number(line1.slice(2, 7));
  const catalog2 = Number(line2.slice(2, 7));
  if (!Number.isInteger(catalog1) || catalog1 <= 0 || catalog1 !== catalog2) throw new Error('TLE catalogue identifiers do not match');
  if (!validChecksum(line1) || !validChecksum(line2)) throw new Error('TLE checksum validation failed');
  const shortYear = Number(line1.slice(18, 20));
  const dayOfYear = Number(line1.slice(20, 32));
  if (!Number.isInteger(shortYear) || !Number.isFinite(dayOfYear) || dayOfYear < 1 || dayOfYear >= 367) throw new Error('TLE epoch is invalid');
  const year = shortYear >= 57 ? 1900 + shortYear : 2000 + shortYear;
  const epochUtc = new Date(Date.UTC(year, 0, 1) + (dayOfYear - 1) * 86_400_000);
  const satellite = twoline2satrec(line1, line2);
  if (satellite.error !== 0) throw new Error(`TLE cannot initialize SGP4 (error ${satellite.error})`);
  return { name, line1, line2, catalogId: catalog1, epochUtc };
}

function validChecksum(line: string): boolean {
  const expected = Number(line[68]);
  if (!Number.isInteger(expected)) return false;
  let sum = 0;
  for (const character of line.slice(0, 68)) {
    if (character >= '0' && character <= '9') sum += Number(character);
    else if (character === '-') sum += 1;
  }
  return sum % 10 === expected;
}
