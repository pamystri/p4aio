import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type {
  CreateEphemerisRecord,
  EphemerisView,
  NtnRepository,
  PredictedPassInput,
  PredictedPassView,
  SitePassConfigurationView,
  SpaceAssetView,
  TransparentAssignmentView,
} from '@application/ntn/ntn.repository';
import { PrismaService } from '@persistence/prisma/prisma.service';

/** PostgreSQL adapter for transparent-NTN assets, ephemerides and site passes. */
@Injectable()
export class PrismaNtnRepository implements NtnRepository {
  constructor(private readonly prisma: PrismaService) {}

  async createAsset(input: { name: string; noradCatalogId?: number; internationalDesignator?: string; orbitClass?: string; attributes?: Record<string, unknown> }): Promise<SpaceAssetView> {
    const row = await this.prisma.spaceAsset.create({
      data: {
        name: input.name,
        noradCatalogId: input.noradCatalogId,
        internationalDesignator: input.internationalDesignator,
        orbitClass: input.orbitClass,
        attributes: (input.attributes ?? {}) as Prisma.InputJsonValue,
      },
    });
    return this.asset(row);
  }

  async listAssets(): Promise<SpaceAssetView[]> {
    const rows = await this.prisma.spaceAsset.findMany({ orderBy: { name: 'asc' } });
    return rows.map((row) => this.asset(row));
  }

  async findAsset(id: string): Promise<SpaceAssetView | null> {
    const row = await this.prisma.spaceAsset.findUnique({ where: { id } });
    return row ? this.asset(row) : null;
  }

  async createEphemeris(input: CreateEphemerisRecord): Promise<EphemerisView> {
    const row = await this.prisma.$transaction(async (transaction) => {
      if (input.active) {
        await transaction.ephemerisDataset.updateMany({
          where: { spaceAssetId: input.spaceAssetId, active: true },
          data: { active: false },
        });
      }
      return transaction.ephemerisDataset.create({
        data: {
          spaceAssetId: input.spaceAssetId,
          sourceType: input.sourceType,
          formatVersion: input.formatVersion,
          epochUtc: input.epochUtc,
          validFrom: input.validFrom,
          validTo: input.validTo,
          referenceFrame: input.referenceFrame,
          timeSystem: input.timeSystem,
          rawText: input.rawText,
          rawJson: input.rawJson as Prisma.InputJsonValue | undefined,
          payloadSha256: input.payloadSha256,
          validationStatus: input.validationStatus,
          validationDiagnostics: input.validationDiagnostics as Prisma.InputJsonValue,
          active: input.active,
        },
      });
    });
    return this.ephemeris(row);
  }

  async listEphemerides(assetId: string): Promise<EphemerisView[]> {
    const rows = await this.prisma.ephemerisDataset.findMany({
      where: { spaceAssetId: assetId },
      orderBy: [{ active: 'desc' }, { epochUtc: 'desc' }],
    });
    return rows.map((row) => this.ephemeris(row));
  }

  async findEphemeris(id: string): Promise<EphemerisView | null> {
    const row = await this.prisma.ephemerisDataset.findUnique({ where: { id } });
    return row ? this.ephemeris(row) : null;
  }

  async activateEphemeris(assetId: string, datasetId: string): Promise<EphemerisView> {
    const row = await this.prisma.$transaction(async (transaction) => {
      const candidate = await transaction.ephemerisDataset.findFirst({
        where: { id: datasetId, spaceAssetId: assetId },
      });
      if (!candidate) throw new Error('Ephemeris dataset was not found for the asset');
      await transaction.ephemerisDataset.updateMany({
        where: { spaceAssetId: assetId, active: true },
        data: { active: false },
      });
      return transaction.ephemerisDataset.update({ where: { id: datasetId }, data: { active: true } });
    });
    return this.ephemeris(row);
  }

  async activeEphemeris(assetId: string): Promise<EphemerisView | null> {
    const row = await this.prisma.ephemerisDataset.findFirst({
      where: { spaceAssetId: assetId, active: true },
      orderBy: { epochUtc: 'desc' },
    });
    return row ? this.ephemeris(row) : null;
  }

  async createAssignment(input: { spaceAssetId: string; radioTargetId: string; validFrom: Date; validTo?: Date; attributes?: Record<string, unknown> }): Promise<TransparentAssignmentView> {
    const row = await this.prisma.ntnTransparentAssignment.create({
      data: {
        spaceAssetId: input.spaceAssetId,
        radioTargetId: input.radioTargetId,
        validFrom: input.validFrom,
        validTo: input.validTo,
        attributes: (input.attributes ?? {}) as Prisma.InputJsonValue,
      },
      include: {
        spaceAsset: { select: { name: true } },
        radioTarget: { select: { name: true, siteId: true } },
      },
    });
    return this.assignment(row);
  }

  async listAssignments(): Promise<TransparentAssignmentView[]> {
    const rows = await this.prisma.ntnTransparentAssignment.findMany({
      include: {
        spaceAsset: { select: { name: true } },
        radioTarget: { select: { name: true, siteId: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((row) => this.assignment(row));
  }

  async upsertPassConfiguration(input: { siteId: string; spaceAssetId: string; minimumElevationDeg: number; predictionHorizonDays: number; enabled: boolean }): Promise<SitePassConfigurationView> {
    const row = await this.prisma.sitePassConfiguration.upsert({
      where: { siteId_spaceAssetId: { siteId: input.siteId, spaceAssetId: input.spaceAssetId } },
      create: input,
      update: {
        minimumElevationDeg: input.minimumElevationDeg,
        predictionHorizonDays: input.predictionHorizonDays,
        enabled: input.enabled,
      },
      include: {
        site: { select: { name: true, latitude: true, longitude: true, altitudeM: true } },
        spaceAsset: { select: { name: true } },
      },
    });
    return this.passConfiguration(row);
  }

  async listPassConfigurations(): Promise<SitePassConfigurationView[]> {
    const rows = await this.prisma.sitePassConfiguration.findMany({
      include: {
        site: { select: { name: true, latitude: true, longitude: true, altitudeM: true } },
        spaceAsset: { select: { name: true } },
      },
      orderBy: [{ site: { name: 'asc' } }, { spaceAsset: { name: 'asc' } }],
    });
    return rows.map((row) => this.passConfiguration(row));
  }

  async replaceFuturePasses(configuration: SitePassConfigurationView, ephemerisDatasetId: string, from: Date, passes: PredictedPassInput[]): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      await transaction.predictedPass.deleteMany({
        where: { siteId: configuration.siteId, spaceAssetId: configuration.spaceAssetId, losAt: { gte: from } },
      });
      if (passes.length > 0) {
        await transaction.predictedPass.createMany({
          data: passes.map((pass) => ({
            siteId: configuration.siteId,
            spaceAssetId: configuration.spaceAssetId,
            ephemerisDatasetId,
            ...pass,
            details: pass.details as Prisma.InputJsonValue,
          })),
        });
      }
    });
  }

  async listPasses(filters: { siteId?: string; spaceAssetId?: string; from: Date; to: Date; limit: number }): Promise<PredictedPassView[]> {
    const rows = await this.prisma.predictedPass.findMany({
      where: {
        ...(filters.siteId ? { siteId: filters.siteId } : {}),
        ...(filters.spaceAssetId ? { spaceAssetId: filters.spaceAssetId } : {}),
        losAt: { gte: filters.from },
        aosAt: { lte: filters.to },
      },
      include: { site: { select: { name: true } }, spaceAsset: { select: { name: true } } },
      orderBy: { aosAt: 'asc' },
      take: filters.limit,
    });
    return rows.map((row) => ({
      id: row.id,
      siteId: row.siteId,
      siteName: row.site.name,
      spaceAssetId: row.spaceAssetId,
      assetName: row.spaceAsset.name,
      ephemerisDatasetId: row.ephemerisDatasetId,
      aosAt: row.aosAt,
      losAt: row.losAt,
      maximumElevationAt: row.maximumElevationAt,
      maximumElevationDeg: row.maximumElevationDeg,
      aosAzimuthDeg: row.aosAzimuthDeg,
      losAzimuthDeg: row.losAzimuthDeg,
      minimumSlantRangeM: row.minimumSlantRangeM,
      predictionVersion: row.predictionVersion,
      calculatedAt: row.calculatedAt,
      details: row.details as Record<string, unknown>,
    }));
  }

  private asset(row: { id: string; name: string; noradCatalogId: number | null; internationalDesignator: string | null; orbitClass: string | null; status: string; attributes: Prisma.JsonValue; createdAt: Date; updatedAt: Date }): SpaceAssetView {
    return { ...row, attributes: row.attributes as Record<string, unknown> };
  }

  private ephemeris(row: { id: string; spaceAssetId: string; sourceType: string; formatVersion: string | null; epochUtc: Date; validFrom: Date | null; validTo: Date | null; referenceFrame: string; timeSystem: string; rawText: string | null; rawJson: Prisma.JsonValue | null; payloadSha256: Uint8Array; validationStatus: string; validationDiagnostics: Prisma.JsonValue; active: boolean; createdAt: Date }): EphemerisView {
    return {
      ...row,
      sourceType: row.sourceType as EphemerisView['sourceType'],
      validationStatus: row.validationStatus as EphemerisView['validationStatus'],
      rawJson: row.rawJson as Record<string, unknown> | null,
      payloadSha256: Buffer.from(row.payloadSha256),
      validationDiagnostics: row.validationDiagnostics as Record<string, unknown>,
    };
  }

  private assignment(row: { id: string; spaceAssetId: string; radioTargetId: string; validFrom: Date; validTo: Date | null; enabled: boolean; attributes: Prisma.JsonValue; spaceAsset: { name: string }; radioTarget: { name: string; siteId: string } }): TransparentAssignmentView {
    return {
      id: row.id,
      spaceAssetId: row.spaceAssetId,
      assetName: row.spaceAsset.name,
      radioTargetId: row.radioTargetId,
      targetName: row.radioTarget.name,
      siteId: row.radioTarget.siteId,
      validFrom: row.validFrom,
      validTo: row.validTo,
      enabled: row.enabled,
      attributes: row.attributes as Record<string, unknown>,
    };
  }

  private passConfiguration(row: { id: string; siteId: string; spaceAssetId: string; minimumElevationDeg: number; predictionHorizonDays: number; enabled: boolean; site: { name: string; latitude: number | null; longitude: number | null; altitudeM: number | null }; spaceAsset: { name: string } }): SitePassConfigurationView {
    return {
      id: row.id,
      siteId: row.siteId,
      siteName: row.site.name,
      siteLatitude: row.site.latitude,
      siteLongitude: row.site.longitude,
      siteAltitudeM: row.site.altitudeM,
      spaceAssetId: row.spaceAssetId,
      assetName: row.spaceAsset.name,
      minimumElevationDeg: row.minimumElevationDeg,
      predictionHorizonDays: row.predictionHorizonDays,
      enabled: row.enabled,
    };
  }
}
