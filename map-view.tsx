'use client';

import { useMemo } from 'react';
import dynamic from 'next/dynamic';
import { Box, Card, CardContent, Chip, Grid, Stack, Typography } from '@mui/material';
import DevicesRounded from '@mui/icons-material/DevicesRounded';
import DownloadRounded from '@mui/icons-material/DownloadRounded';
import UploadRounded from '@mui/icons-material/UploadRounded';
import NotificationsRounded from '@mui/icons-material/NotificationsRounded';
import { PageHeader } from '@/components/common/page-header';
import { StatCard } from '@/components/common/stat-card';
import { StatePanel } from '@/components/common/state-panel';
import { StatusBadge } from '@/components/common/status-badge';
import { EChart, timeSeriesOption } from '@/components/charts/echart';
import { useApi } from '@/core/api/use-api';
import { queryString } from '@/core/api/client';
import { useCurrentTime } from '@/core/time/use-current-time';
import type { AggregatedMetric, Alarm, CollectorStatus, LocationEstimate, Metric, NtnPass, NtnPositionSnapshot, NtnSiteLook, NtnTrackSnapshot, Page, RadioTarget, Site, Statistics, Ue } from '@/core/api/types';

const NetworkMap = dynamic(() => import('./network-map').then((module) => module.NetworkMap), { ssr: false });
const bitrate = (value = 0) => value >= 1_000_000 ? `${(value / 1_000_000).toFixed(1)} Mb/s` : `${(value / 1000).toFixed(0)} kb/s`;

export function MapView() {
  const sites = useApi<Page<Site>>('/sites?limit=100');
  const locations = useApi<LocationEstimate[]>('/locations/current');
  const collectors = useApi<CollectorStatus[]>('/collectors/status');
  const targets = useApi<RadioTarget[]>('/radio-targets');
  const metrics = useApi<Page<Metric>>('/metrics/current?limit=1000');
  const ues = useApi<Page<Ue>>('/ues?limit=1000');
  const stats = useApi<Statistics>('/statistics');
  const alarms = useApi<Page<Alarm>>('/alarms/current?limit=5');
  const ntn = useApi<NtnPositionSnapshot>('/ntn/positions/current');
  const tracks = useApi<NtnTrackSnapshot>('/ntn/tracks/current?minutes=90&stepSeconds=60');
  const passes = useApi<NtnPass[]>('/ntn/passes?limit=20');
  const currentTime = useCurrentTime();
  const to = new Date(Math.floor(currentTime / 60_000) * 60_000); const from = new Date(to.getTime() - 6 * 60 * 60_000);
  const historyPath = (metric: string) => `/metrics/historical${queryString({ metric, from: from.toISOString(), to: to.toISOString(), aggregation: 'avg', bucket: 'minute', limit: 360, sort: 'asc' })}`;
  const dl = useApi<Page<AggregatedMetric>>(historyPath('radio.ue.dl_bitrate')); const ul = useApi<Page<AggregatedMetric>>(historyPath('radio.ue.ul_bitrate'));
  const trafficOption = useMemo(() => timeSeriesOption([
    { name: 'Downlink', color: '#20bad8', data: (dl.data?.items ?? []).map((point) => [point.bucket, point.value]) },
    { name: 'Uplink', color: '#8b78f6', data: (ul.data?.items ?? []).map((point) => [point.bucket, point.value]) },
  ], 'bit/s'), [dl.data, ul.data]);
  const mapRequests = [sites, locations, collectors, targets, metrics, ues, ntn, tracks, passes] as const;
  const error = mapRequests.find((request) => request.data === null && request.error)?.error ?? null;
  const loading = mapRequests.some((request) => request.loading);
  const refreshing = mapRequests.some((request) => request.refreshing);
  const now = currentTime;
  const currentPasses = (passes.data ?? []).filter((pass) => new Date(pass.aosAt).getTime() <= now && new Date(pass.losAt).getTime() >= now);
  const futurePasses = (passes.data ?? []).filter((pass) => new Date(pass.aosAt).getTime() > now).slice(0, 3);
  const activeUes = ues.data?.items.filter((item) => item.radioStatus === 'active') ?? [];
  const healthyCollectors = collectors.data?.filter((item) => item.enabled && item.lastRunStatus === 'SUCCEEDED').length ?? 0;

  return <>
    <PageHeader eyebrow="Geospatial operations" title="Network map" description="Map-centric view of terrestrial sites, correlated UE estimates, and transparent-NTN pass geometry." actions={<Stack direction="row" spacing={1}><Chip variant="outlined" color="secondary" label={`${locations.data?.length ?? 0} estimated UEs`} /><Chip variant="outlined" color="primary" label={`${ntn.data?.assets.length ?? 0} NTN assets`} /></Stack>} />
    <Grid container spacing={1.5}>{[
      ['Radio-active UEs', activeUes.length, `${ues.data?.items.filter((item) => item.registrationStatus === 'registered').length ?? 0} MME registered`, DevicesRounded, 'secondary'],
      ['Downlink', bitrate(stats.data?.totalDlBitrate), 'Current aggregate', DownloadRounded, 'primary'],
      ['Uplink', bitrate(stats.data?.totalUlBitrate), 'Current aggregate', UploadRounded, 'primary'],
      ['Current alerts', alarms.data?.items.length ?? 0, `${healthyCollectors}/${collectors.data?.filter((item) => item.enabled).length ?? 0} collectors healthy`, NotificationsRounded, alarms.data?.items.length ? 'warning' : 'success'],
    ].map(([label, value, helper, icon, tone]) => <Grid key={String(label)} size={{ xs: 12, sm: 6, xl: 3 }}><StatCard label={String(label)} value={value as string | number} helper={String(helper)} icon={icon as typeof DevicesRounded} tone={tone as 'primary' | 'secondary' | 'warning' | 'success'} loading={stats.loading} /></Grid>)}</Grid>

    <Grid container spacing={2} sx={{ mt: .25 }}>
      <Grid size={{ xs: 12, xl: 9 }}><Card sx={{ overflow: 'hidden', position: 'relative' }}><StatePanel loading={loading} error={error}><Box sx={{ height: { xs: 540, lg: 720 } }}><NetworkMap sites={sites.data?.items ?? []} locations={locations.data ?? []} collectors={collectors.data ?? []} targets={targets.data ?? []} metrics={metrics.data?.items ?? []} ues={ues.data?.items ?? []} ntn={ntn.data} tracks={tracks.data} now={currentTime} /></Box></StatePanel>{refreshing && <Chip size="small" color="primary" variant="filled" label="Updating…" sx={{ position: 'absolute', top: 16, right: 16, zIndex: 1000 }} />}<Box sx={{ position: 'absolute', left: 16, bottom: 16, px: 1.3, py: .8, bgcolor: 'rgba(7,17,31,.88)', border: '1px solid rgba(142,174,207,.25)', borderRadius: 2, color: '#dce9f5', pointerEvents: 'none' }}><Typography variant="caption">● Site &nbsp; ◆ UE estimate &nbsp; SAT Orbit position</Typography></Box></Card></Grid>
      <Grid size={{ xs: 12, xl: 3 }}><Stack spacing={2}>
        <Card><CardContent><PanelTitle title="Ground network" subtitle={`${sites.data?.items.length ?? 0} sites · ${targets.data?.length ?? 0} targets`} status={healthyCollectors === collectors.data?.filter((item) => item.enabled).length && healthyCollectors > 0 ? 'healthy' : 'degraded'} /><Stack spacing={1} sx={{ mt: 1.5 }}>{sites.data?.items.map((site) => { const siteTargets = targets.data?.filter((target) => target.siteId === site.id) ?? []; const siteActive = activeUes.filter((ue) => ue.siteIds.includes(site.id)); return <Box key={site.id} sx={{ p: 1.25, border: '1px solid', borderColor: 'divider', borderRadius: 2 }}><Stack direction="row" sx={{ justifyContent: 'space-between' }}><Typography sx={{ fontSize: 13, fontWeight: 750 }}>{site.name}</Typography><StatusBadge status={siteTargets.length ? 'configured' : 'configuration needed'} /></Stack><Typography variant="caption" color="text.secondary">{siteActive.length} radio-active UEs · {siteTargets.length} collectors</Typography></Box>; })}</Stack></CardContent></Card>
        <Card><CardContent><PanelTitle title="Active UE detail" subtitle="MME + gNB correlation" status={activeUes.length ? 'active' : 'waiting'} /><Stack spacing={1} sx={{ mt: 1.5, maxHeight: 225, overflow: 'auto' }}>{activeUes.map((ue) => { const location = locations.data?.find((item) => item.ueId === ue.id); return <Box key={ue.id} sx={{ p: 1.2, bgcolor: 'action.hover', borderRadius: 2 }}><Stack direction="row" sx={{ justifyContent: 'space-between' }}><Typography sx={{ fontFamily: 'monospace', fontSize: 12, fontWeight: 750 }}>{ue.pseudonym}</Typography><StatusBadge status={ue.radioStatus} /></Stack><Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>IP {ue.ipAddresses.join(', ') || 'not assigned'}</Typography><Typography variant="caption" color="text.secondary">{location?.servingCellName ?? 'No location'}{location ? ` · ±${Math.round(location.horizontalAccuracyM)} m · ${location.confidence === null ? 'unscored' : `${Math.round(location.confidence * 100)}%`}` : ''}</Typography></Box>; })}{!activeUes.length && <Typography variant="body2" color="text.secondary">No UE currently has recent gNB activity.</Typography>}</Stack></CardContent></Card>
        <Card><CardContent><PanelTitle title="Transparent NTN" subtitle="Geometric site visibility only" status={currentPasses.length ? 'in pass' : 'waiting'} /><Stack spacing={1} sx={{ mt: 1.5 }}>{currentPasses.map((pass) => <PassCard key={pass.id} pass={pass} current look={ntn.data?.assets.find((item) => item.asset.id === pass.spaceAssetId)?.siteLooks.find((look) => look.siteId === pass.siteId)} />)}{futurePasses.map((pass) => <PassCard key={pass.id} pass={pass} />)}{!currentPasses.length && !futurePasses.length && <Typography variant="body2" color="text.secondary">No predicted passes configured.</Typography>}</Stack></CardContent></Card>
      </Stack></Grid>
    </Grid>

    <Grid container spacing={2} sx={{ mt: .25 }}><Grid size={{ xs: 12, xl: 8 }}><Card><CardContent><PanelTitle title="Traffic timeline" subtitle="Six-hour rolling view" status={dl.error || ul.error ? 'degraded' : 'live'} /><StatePanel loading={dl.loading || ul.loading} error={dl.error ?? ul.error} empty={!dl.data?.items.length && !ul.data?.items.length}><EChart option={trafficOption} height={245} ariaLabel="Map page network traffic" /></StatePanel></CardContent></Card></Grid><Grid size={{ xs: 12, xl: 4 }}><Card sx={{ height: '100%' }}><CardContent><PanelTitle title="Operational alerts" subtitle="Current conditions" status={alarms.data?.items.length ? 'warning' : 'healthy'} /><Stack spacing={1} sx={{ mt: 1.5 }}>{alarms.data?.items.slice(0, 4).map((alarm) => <Box key={alarm.id} sx={{ p: 1.1, borderLeft: '3px solid', borderColor: 'warning.main', bgcolor: 'action.hover' }}><Typography sx={{ fontSize: 12.5, fontWeight: 700 }}>{alarm.message}</Typography><Typography variant="caption" color="text.secondary">{new Date(alarm.occurredAt).toLocaleString()}</Typography></Box>)}{!alarms.data?.items.length && <Typography variant="body2" color="text.secondary">No current alerts.</Typography>}</Stack></CardContent></Card></Grid></Grid>
  </>;
}

function PanelTitle({ title, subtitle, status }: { title: string; subtitle: string; status: string }) { return <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'flex-start', gap: 1 }}><Box><Typography variant="h2">{title}</Typography><Typography variant="caption" color="text.secondary">{subtitle}</Typography></Box><StatusBadge status={status} /></Stack>; }
function PassCard({ pass, current = false, look }: { pass: NtnPass; current?: boolean; look?: NtnSiteLook }) { return <Box sx={{ p: 1.2, border: '1px solid', borderColor: current ? 'success.main' : 'divider', borderRadius: 2 }}><Typography sx={{ fontSize: 12.5, fontWeight: 750 }}>{pass.assetName} → {pass.siteName}</Typography><Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{current ? `LOS ${new Date(pass.losAt).toLocaleTimeString()}` : `AOS ${new Date(pass.aosAt).toLocaleString()}`}</Typography>{look && <Typography variant="caption" color="success.main">Now {look.elevationDeg.toFixed(1)}° · az {look.azimuthDeg.toFixed(1)}°</Typography>}</Box>; }
