'use client';

import { Fragment, useEffect, useRef } from 'react';
import L from 'leaflet';
import { Circle, MapContainer, Marker, Polyline, Popup, TileLayer, useMap } from 'react-leaflet';
import type { CollectorStatus, LocationEstimate, Metric, NtnPositionSnapshot, NtnTrackSnapshot, RadioTarget, Site, Ue } from '@/core/api/types';

const siteIcon = L.divIcon({ className: 'network-marker', html: '<div class="site-pin"></div>', iconSize: [18, 18], iconAnchor: [9, 9] });
const ueIcon = L.divIcon({ className: 'network-marker', html: '<div class="ue-pin"></div>', iconSize: [14, 14], iconAnchor: [7, 7] });
const satelliteIcon = L.divIcon({ className: 'network-marker', html: '<div class="satellite-pin">SAT</div>', iconSize: [34, 24], iconAnchor: [17, 12] });
const traffic = (value: number) => value > 1_000_000 ? `${(value / 1_000_000).toFixed(1)} Mb/s` : `${(value / 1000).toFixed(0)} kb/s`;

function FitBounds({ sites, locations, ntn }: { sites: Site[]; locations: LocationEstimate[]; ntn?: NtnPositionSnapshot | null }) {
  const map = useMap();
  const previousTopology = useRef('');
  useEffect(() => {
    const topology = [
      ...sites.map((site) => `site:${site.id}:${site.latitude ?? ''}:${site.longitude ?? ''}`),
      ...locations.map((location) => `ue:${location.ueId}`),
      ...(ntn?.assets.map((item) => `asset:${item.asset.id}`) ?? []),
    ].sort().join('|');
    if (topology === previousTopology.current) return;
    const points: Array<[number, number]> = [
      ...sites.filter((site) => site.latitude !== null && site.longitude !== null).map((site) => [site.latitude as number, site.longitude as number] as [number, number]),
      ...locations.map((location) => [location.latitude, location.longitude] as [number, number]),
      ...(ntn?.assets.map((item) => [item.position.latitude, item.position.longitude] as [number, number]) ?? []),
    ];
    if (points.length) {
      map.fitBounds(points, { padding: [42, 42], maxZoom: 16 });
      previousTopology.current = topology;
    }
  }, [sites, locations, ntn, map]);
  return null;
}

export function NetworkMap({ sites, locations, collectors, targets, metrics, ues, ntn, tracks, now }: { sites: Site[]; locations: LocationEstimate[]; collectors: CollectorStatus[]; targets: RadioTarget[]; metrics: Metric[]; ues: Ue[]; ntn?: NtnPositionSnapshot | null; tracks?: NtnTrackSnapshot | null; now: number }) {
  const tileUrl = process.env.NEXT_PUBLIC_TILE_URL || 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
  const targetSite = new Map(targets.map((target) => [target.id, target.siteId]));
  return <MapContainer center={[51.505, -0.09]} zoom={3} style={{ height: '100%', minHeight: 580, width: '100%' }} zoomControl attributionControl>
    <TileLayer url={tileUrl} attribution='&copy; OpenStreetMap contributors' />
    <FitBounds sites={sites} locations={locations} ntn={ntn} />
    {sites.filter((site) => site.latitude !== null && site.longitude !== null).map((site) => {
      const targetIds = targets.filter((target) => target.siteId === site.id).map((target) => target.id);
      const siteCollectors = collectors.filter((item) => targetIds.includes(item.targetId) && item.enabled);
      const userCount = ues.filter((item) => item.radioStatus === 'active' && item.siteIds.includes(site.id)).length;
      const siteMetrics = metrics.filter((item) => targetSite.get(item.targetId) === site.id);
      const dl = siteMetrics.filter((item) => item.metric.endsWith('dl_bitrate')).reduce((sum, item) => sum + numericValue(item.value), 0);
      const ul = siteMetrics.filter((item) => item.metric.endsWith('ul_bitrate')).reduce((sum, item) => sum + numericValue(item.value), 0);
      const healthy = siteCollectors.length > 0 && siteCollectors.every((item) => item.lastSuccessAt !== null && now - new Date(item.lastSuccessAt).getTime() <= Math.max(30_000, ...item.schedules.filter((schedule) => schedule.enabled).map((schedule) => schedule.intervalMs * 3), 30_000));
      return <Marker key={site.id} position={[site.latitude as number, site.longitude as number]} icon={siteIcon}><Popup><strong>{site.name}</strong><br />Status: {healthy ? 'Healthy' : 'Attention required'}<br />Radio-active users: {userCount}<br />Traffic: ↓ {traffic(dl)} · ↑ {traffic(ul)}<br />Health: {siteCollectors.filter((item) => item.lastSuccessAt !== null).length}/{siteCollectors.length} components</Popup></Marker>;
    })}
    {locations.map((location) => <Fragment key={location.id}><Circle center={[location.latitude, location.longitude]} radius={location.horizontalAccuracyM} pathOptions={{ color: location.radioStatus === 'active' ? '#8b78f6' : '#7b8495', fillColor: location.radioStatus === 'active' ? '#8b78f6' : '#7b8495', fillOpacity: .08, weight: 1 }} /><Marker position={[location.latitude, location.longitude]} icon={ueIcon}><Popup><strong>{location.pseudonym}</strong><br />Radio: {location.radioStatus}<br />UE IP: {location.ipAddresses.join(', ') || 'Not assigned'}<br />Confidence: {location.confidence === null ? 'Not scored' : `${Math.round(location.confidence * 100)}%`}<br />Accuracy: ±{Math.round(location.horizontalAccuracyM)} m<br />Serving cell: {location.servingCellName ?? location.servingCellId ?? 'Unknown'}<br />Method: {location.method} ({location.algorithmVersion})<br />Timestamp: {new Date(location.estimatedAt).toLocaleString()}</Popup></Marker></Fragment>)}
    {tracks?.tracks.flatMap((track) => splitAtDateLine(track.points).map((segment, index) => <Polyline key={`${track.assetId}-${index}`} positions={segment} pathOptions={{ color: '#35d3ed', weight: 1.6, opacity: .72, dashArray: '7 7' }} />))}
    {ntn?.assets.map((item) => <Fragment key={item.asset.id}>
      {item.siteLooks.filter((look) => look.inPass).map((look) => { const site = sites.find((candidate) => candidate.id === look.siteId); return site && site.latitude !== null && site.longitude !== null ? <Polyline key={`${item.asset.id}-${look.siteId}`} positions={[[site.latitude, site.longitude], [item.position.latitude, item.position.longitude]]} pathOptions={{ color: '#5ce1a6', weight: 2, dashArray: '4 6' }} /> : null; })}
      <Marker position={[item.position.latitude, item.position.longitude]} icon={satelliteIcon}><Popup><strong>{item.asset.name}</strong><br />Transparent payload<br />Altitude: {(item.position.altitudeM / 1000).toFixed(0)} km<br />Speed: {(item.position.speedMps / 1000).toFixed(2)} km/s<br />Ephemeris: {item.ephemeris.sourceType} / {item.ephemeris.validationStatus}<br />Updated: {new Date(item.position.timestamp).toLocaleString()}<br /><em>Geometric visibility only — not RF coverage.</em></Popup></Marker>
    </Fragment>)}
  </MapContainer>;
}

function splitAtDateLine(points: Array<{ latitude: number; longitude: number }>): Array<Array<[number, number]>> {
  const segments: Array<Array<[number, number]>> = [[]];
  for (const point of points) {
    const current = segments[segments.length - 1] as Array<[number, number]>;
    const previous = current.at(-1);
    if (previous && Math.abs(previous[1] - point.longitude) > 180) segments.push([]);
    (segments[segments.length - 1] as Array<[number, number]>).push([point.latitude, point.longitude]);
  }
  return segments.filter((segment) => segment.length > 1);
}

function numericValue(value: Metric['value']): number { const numeric = typeof value === 'number' ? value : Number(value); return Number.isFinite(numeric) ? numeric : 0; }
