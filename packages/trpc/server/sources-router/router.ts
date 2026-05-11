// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 NexaStack, NexaSign contributors
import { Prisma } from '@prisma/client';

import { AppError, AppErrorCode } from '@nexasign/lib/errors/app-error';
import { jobs } from '@nexasign/lib/jobs/client';
import {
  encryptImapConfig,
  getDefaultImapHostAllowlist,
  isCustomImapHostsAllowed,
} from '@nexasign/lib/server-only/sources/imap';
import { getSourceAdapter } from '@nexasign/lib/server-only/sources/registry';
import { prisma } from '@nexasign/prisma';

import { authenticatedProcedure, router } from '../trpc';
import {
  ZCancelSyncRunRequestSchema,
  ZCancelSyncRunResponseSchema,
  ZCreateImapSourceRequestSchema,
  ZDeleteSourceRequestSchema,
  ZDeleteSourceResponseSchema,
  ZInspectImapFoldersRequestSchema,
  ZInspectImapFoldersResponseSchema,
  ZListRecentSyncRunsRequestSchema,
  ZListRecentSyncRunsResponseSchema,
  ZListSourcesResponseSchema,
  ZListSyncRunsRequestSchema,
  ZListSyncRunsResponseSchema,
  ZReactivateSourceRequestSchema,
  ZReactivateSourceResponseSchema,
  ZSourceCapabilitiesResponseSchema,
  ZStartSyncRunRequestSchema,
  ZStartSyncRunResponseSchema,
  ZTestSourceRequestSchema,
  ZTestSourceResponseSchema,
  ZUpdateImapSourceRequestSchema,
} from './schema';

const MAX_IMAP_ACCOUNTS_PER_USER = 3;

const ensureNoDuplicateImapSource = async ({
  userId,
  teamId,
  host,
  port,
  username,
  excludeSourceId,
}: {
  userId: number;
  teamId: number;
  host: string;
  port: number;
  username: string;
  excludeSourceId?: string;
}) => {
  const existingSources = await prisma.source.findMany({
    where: {
      userId,
      teamId,
      kind: 'IMAP',
      ...(excludeSourceId ? { id: { not: excludeSourceId } } : {}),
    },
    select: {
      id: true,
      label: true,
      encryptedConfig: true,
      encryptedConfigKeyVersion: true,
    },
  });

  if (existingSources.length === 0) {
    return;
  }

  const { decryptImapConfig } = await import('@nexasign/lib/server-only/sources/imap');
  const normalizedHost = host.trim().toLowerCase();
  const normalizedUsername = username.trim().toLowerCase();

  for (const source of existingSources) {
    const config = decryptImapConfig({
      ciphertext: source.encryptedConfig,
      keyVersion: source.encryptedConfigKeyVersion,
    });

    if (
      config.host.trim().toLowerCase() === normalizedHost &&
      config.port === port &&
      config.username.trim().toLowerCase() === normalizedUsername
    ) {
      throw new AppError(AppErrorCode.UNAUTHORIZED, {
        message: `Dieses Postfach ist bereits verbunden (${source.label}).`,
      });
    }
  }
};

const requireOwnSource = async (sourceId: string, userId: number) => {
  const source = await prisma.source.findFirst({
    where: { id: sourceId, userId },
  });
  if (!source) {
    throw new AppError(AppErrorCode.NOT_FOUND, { message: 'Quelle nicht gefunden.' });
  }
  return source;
};

export const sourcesRouter = router({
  getCapabilities: authenticatedProcedure
    .output(ZSourceCapabilitiesResponseSchema)
    .query(async ({ ctx }) => {
      const memberships = await prisma.organisationMember.findMany({
        where: { userId: ctx.user.id },
        select: {
          organisation: {
            select: {
              name: true,
              teams: {
                orderBy: { createdAt: 'asc' },
                select: { id: true, name: true, url: true },
              },
            },
          },
        },
      });

      const availableTeams = memberships.flatMap((m) =>
        m.organisation.teams.map((team) => ({
          id: team.id,
          name: team.name,
          url: team.url,
          organisationName: m.organisation.name,
        })),
      );

      return {
        imap: {
          maxAccountsPerUser: MAX_IMAP_ACCOUNTS_PER_USER,
          allowedHosts: [...getDefaultImapHostAllowlist()],
          customHostsAllowed: isCustomImapHostsAllowed(),
        },
        availableTeams,
      };
    }),

  listSources: authenticatedProcedure.output(ZListSourcesResponseSchema).query(async ({ ctx }) => {
    const sources = await prisma.source.findMany({
      where: { userId: ctx.user.id },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        kind: true,
        label: true,
        teamId: true,
        team: { select: { name: true } },
        lastSyncAt: true,
        lastSyncStatus: true,
        lastSyncError: true,
        consecutiveFailures: true,
        createdAt: true,
      },
    });
    return sources.map(({ team, ...rest }) => ({
      ...rest,
      teamName: team.name,
    }));
  }),

  deleteSource: authenticatedProcedure
    .input(ZDeleteSourceRequestSchema)
    .output(ZDeleteSourceResponseSchema)
    .mutation(async ({ input, ctx }) => {
      const source = await requireOwnSource(input.sourceId, ctx.user.id);

      // WORM-Guard: solange noch akzeptierte Belege an dieser Quelle hängen,
      // bleibt sie aus GoBD-Gründen unlöschbar — Discovery-Dokumente würden
      // sonst per Cascade verschwinden und damit ihre Audit-Spur zerreißen.
      const acceptedCount = await prisma.discoveryDocument.count({
        where: {
          sourceId: source.id,
          acceptedAt: { not: null },
        },
      });
      if (acceptedCount > 0) {
        throw new AppError(AppErrorCode.UNAUTHORIZED, {
          message:
            `An dieser Quelle hängen ${acceptedCount} akzeptierte Belege, die der ` +
            `10-jährigen Aufbewahrung unterliegen. Quelle kann erst gelöscht werden, ` +
            `nachdem die Belege archiviert oder die Aufbewahrungsfrist abgelaufen ist.`,
        });
      }

      await prisma.$transaction([
        prisma.source.delete({ where: { id: source.id } }),
        prisma.discoveryAuditLog.create({
          data: {
            event: 'IMAP_ACCOUNT_DELETED',
            sourceId: null,
            userId: ctx.user.id,
            teamId: ctx.teamId ?? null,
            metadata: { kind: source.kind, label: source.label },
          },
        }),
      ]);

      return { deleted: true };
    }),

  createImapSource: authenticatedProcedure
    .input(ZCreateImapSourceRequestSchema)
    .mutation(async ({ input, ctx }) => {
      const existing = await prisma.source.count({
        where: { userId: ctx.user.id, kind: 'IMAP' },
      });
      if (existing >= MAX_IMAP_ACCOUNTS_PER_USER) {
        throw new AppError(AppErrorCode.UNAUTHORIZED, {
          message: `Maximal ${MAX_IMAP_ACCOUNTS_PER_USER} IMAP-Konten pro Nutzer erlaubt.`,
        });
      }

      const team = await prisma.team.findFirst({
        where: {
          id: input.teamId,
          organisation: { members: { some: { userId: ctx.user.id } } },
        },
        select: { id: true },
      });
      if (!team) {
        throw new AppError(AppErrorCode.UNAUTHORIZED, {
          message: 'Sie sind nicht Mitglied dieses Teams.',
        });
      }

      const adapter = getSourceAdapter('IMAP');
      if (!adapter) {
        throw new AppError(AppErrorCode.NOT_SETUP, {
          message: 'IMAP-Adapter ist nicht initialisiert.',
        });
      }

      const test = await adapter.testConnection({
        config: {
          host: input.host,
          port: input.port,
          username: input.username,
          password: input.password,
          tlsVerify: input.tlsVerify,
        },
      });
      if (!test.ok) {
        throw new AppError(AppErrorCode.UNAUTHORIZED, {
          message: test.error ?? 'Verbindung fehlgeschlagen.',
        });
      }

      const encrypted = encryptImapConfig({
        host: input.host,
        port: input.port,
        username: input.username,
        password: input.password,
        tlsVerify: input.tlsVerify,
      });

      await ensureNoDuplicateImapSource({
        userId: ctx.user.id,
        teamId: team.id,
        host: input.host,
        port: input.port,
        username: input.username,
      });

      const created = await prisma.source.create({
        data: {
          userId: ctx.user.id,
          teamId: team.id,
          kind: 'IMAP',
          label: input.label,
          encryptedConfig: encrypted.ciphertext,
          encryptedConfigKeyVersion: encrypted.keyVersion,
        },
        select: {
          id: true,
          kind: true,
          label: true,
          teamId: true,
          team: { select: { name: true } },
          lastSyncAt: true,
          lastSyncStatus: true,
          lastSyncError: true,
          consecutiveFailures: true,
          createdAt: true,
        },
      });

      await prisma.discoveryAuditLog.create({
        data: {
          event: 'IMAP_ACCOUNT_CREATED',
          sourceId: created.id,
          userId: ctx.user.id,
          teamId: team.id,
          metadata: {
            host: input.host,
            port: input.port,
            tlsVerify: input.tlsVerify,
            label: input.label,
          },
        },
      });

      if (!input.tlsVerify) {
        await prisma.discoveryAuditLog.create({
          data: {
            event: 'IMAP_SYNC_TLS_INSECURE',
            sourceId: created.id,
            userId: ctx.user.id,
            teamId: team.id,
            metadata: { context: 'create' },
          },
        });
      }

      // Kein Auto-Sync mehr — User triggert in der Settings-UI mit Zeitraum.
      const { team: teamRel, ...rest } = created;
      return { ...rest, teamName: teamRel.name };
    }),

  updateImapSource: authenticatedProcedure
    .input(ZUpdateImapSourceRequestSchema)
    .mutation(async ({ input, ctx }) => {
      const source = await requireOwnSource(input.sourceId, ctx.user.id);

      const adapter = getSourceAdapter('IMAP');
      if (!adapter) {
        throw new AppError(AppErrorCode.NOT_SETUP, {
          message: 'IMAP-Adapter ist nicht initialisiert.',
        });
      }

      const password = input.password ?? '';
      let merged: Parameters<typeof encryptImapConfig>[0];

      if (!password) {
        const { decryptImapConfig } = await import('@nexasign/lib/server-only/sources/imap');
        const oldConfig = decryptImapConfig({
          ciphertext: source.encryptedConfig,
          keyVersion: source.encryptedConfigKeyVersion,
        });
        merged = {
          host: input.host,
          port: input.port,
          username: input.username,
          password: oldConfig.password,
          tlsVerify: input.tlsVerify,
        };
      } else {
        merged = {
          host: input.host,
          port: input.port,
          username: input.username,
          password,
          tlsVerify: input.tlsVerify,
        };
      }

      const test = await adapter.testConnection({ config: merged });
      if (!test.ok) {
        throw new AppError(AppErrorCode.UNAUTHORIZED, {
          message: test.error ?? 'Verbindung fehlgeschlagen.',
        });
      }

      await ensureNoDuplicateImapSource({
        userId: ctx.user.id,
        teamId: source.teamId,
        host: merged.host,
        port: merged.port,
        username: merged.username,
        excludeSourceId: source.id,
      });

      const encrypted = encryptImapConfig(merged);

      await prisma.source.update({
        where: { id: source.id },
        data: {
          label: input.label,
          encryptedConfig: encrypted.ciphertext,
          encryptedConfigKeyVersion: encrypted.keyVersion,
          lastSyncStatus: 'PENDING',
          lastSyncError: null,
          consecutiveFailures: 0,
        },
      });

      await prisma.discoveryAuditLog.create({
        data: {
          event: 'IMAP_ACCOUNT_UPDATED',
          sourceId: source.id,
          userId: ctx.user.id,
          teamId: ctx.teamId ?? null,
          metadata: { passwordChanged: Boolean(input.password) },
        },
      });

      if (!input.tlsVerify) {
        await prisma.discoveryAuditLog.create({
          data: {
            event: 'IMAP_SYNC_TLS_INSECURE',
            sourceId: source.id,
            userId: ctx.user.id,
            teamId: ctx.teamId ?? null,
            metadata: { context: 'update' },
          },
        });
      }

      return { ok: true };
    }),

  testSource: authenticatedProcedure
    .input(ZTestSourceRequestSchema)
    .output(ZTestSourceResponseSchema)
    .mutation(async ({ input, ctx }) => {
      const adapter = getSourceAdapter('IMAP');
      if (!adapter) {
        return { ok: false, error: 'IMAP-Adapter ist nicht initialisiert.' };
      }

      if (input.config) {
        return adapter.testConnection({ config: input.config });
      }

      if (input.sourceId) {
        const source = await requireOwnSource(input.sourceId, ctx.user.id);
        const { decryptImapConfig } = await import('@nexasign/lib/server-only/sources/imap');
        const config = decryptImapConfig({
          ciphertext: source.encryptedConfig,
          keyVersion: source.encryptedConfigKeyVersion,
        });
        return adapter.testConnection({ config });
      }

      return { ok: false, error: 'Weder sourceId noch config übergeben.' };
    }),

  reactivateSource: authenticatedProcedure
    .input(ZReactivateSourceRequestSchema)
    .output(ZReactivateSourceResponseSchema)
    .mutation(async ({ input, ctx }) => {
      const source = await requireOwnSource(input.sourceId, ctx.user.id);

      await prisma.source.update({
        where: { id: source.id },
        data: {
          lastSyncStatus: 'PENDING',
          lastSyncError: null,
          consecutiveFailures: 0,
        },
      });

      return { reactivated: true };
    }),

  /**
   * Folder-Diagnose. Verbindet sich live mit dem IMAP-Account und liefert
   * die rohe Folder-Liste + welche Folder der Sync-Adapter wirklich scannen
   * würde + Gmail-spezifische Health-Flags. Frontend nutzt das, um der
   * Persona zu zeigen, ob „[Gmail]/Alle Nachrichten" freigegeben ist —
   * sonst sieht NexaFile nur die INBOX und der ganze archivierte Beleg-
   * Bestand fehlt.
   */
  inspectImapFolders: authenticatedProcedure
    .input(ZInspectImapFoldersRequestSchema)
    .output(ZInspectImapFoldersResponseSchema)
    .mutation(async ({ input, ctx }) => {
      const source = await requireOwnSource(input.sourceId, ctx.user.id);

      if (source.kind !== 'IMAP') {
        throw new AppError(AppErrorCode.UNAUTHORIZED, {
          message: 'Folder-Diagnose ist nur für IMAP-Quellen verfügbar.',
        });
      }

      const { decryptImapConfig, inspectFolders } = await import(
        '@nexasign/lib/server-only/sources/imap'
      );
      const config = decryptImapConfig({
        ciphertext: source.encryptedConfig,
        keyVersion: source.encryptedConfigKeyVersion,
      });

      try {
        return await inspectFolders(config);
      } catch (err) {
        throw new AppError(AppErrorCode.UNAUTHORIZED, {
          message:
            err instanceof Error
              ? `Verbindung fehlgeschlagen: ${err.message}`
              : 'Unbekannter Verbindungsfehler.',
        });
      }
    }),

  // ---------------- SyncRun-Endpunkte ----------------

  startSyncRun: authenticatedProcedure
    .input(ZStartSyncRunRequestSchema)
    .output(ZStartSyncRunResponseSchema)
    .mutation(async ({ input, ctx }) => {
      const source = await requireOwnSource(input.sourceId, ctx.user.id);

      if (source.lastSyncStatus === 'SUSPENDED') {
        throw new AppError(AppErrorCode.UNAUTHORIZED, {
          message: 'Quelle ist gesperrt. Bitte zuerst reaktivieren.',
        });
      }

      // Lock: nur ein laufender SyncRun pro Source.
      const active = await prisma.syncRun.findFirst({
        where: {
          sourceId: source.id,
          status: { in: ['PENDING', 'RUNNING'] },
        },
        select: { id: true },
      });
      if (active) {
        throw new AppError(AppErrorCode.UNAUTHORIZED, {
          message: 'Es läuft bereits ein Sync für diese Quelle. Bitte warten oder abbrechen.',
        });
      }

      let created;
      try {
        created = await prisma.syncRun.create({
          data: {
            sourceId: source.id,
            triggeredById: ctx.user.id,
            rangeFrom: input.from,
            rangeTo: input.to,
            searchTerm: input.searchTerm?.trim() || null,
          },
        });
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          throw new AppError(AppErrorCode.UNAUTHORIZED, {
            message: 'Es läuft bereits ein Sync für diese Quelle. Bitte warten oder abbrechen.',
          });
        }
        throw err;
      }

      await jobs.triggerJob({
        name: 'internal.run-sync-range',
        payload: { syncRunId: created.id },
      });

      return created;
    }),

  listSyncRuns: authenticatedProcedure
    .input(ZListSyncRunsRequestSchema)
    .output(ZListSyncRunsResponseSchema)
    .query(async ({ input, ctx }) => {
      // Auth-Check via requireOwnSource (wirft NOT_FOUND wenn fremde Source).
      await requireOwnSource(input.sourceId, ctx.user.id);

      return prisma.syncRun.findMany({
        where: { sourceId: input.sourceId },
        orderBy: { startedAt: 'desc' },
        take: input.limit,
      });
    }),

  listRecentSyncRuns: authenticatedProcedure
    .input(ZListRecentSyncRunsRequestSchema)
    .output(ZListRecentSyncRunsResponseSchema)
    .query(async ({ input, ctx }) => {
      const runs = await prisma.syncRun.findMany({
        where: {
          source: {
            userId: ctx.user.id,
            ...(ctx.teamId ? { teamId: ctx.teamId } : {}),
          },
        },
        orderBy: { startedAt: 'desc' },
        take: input.limit,
        select: {
          id: true,
          sourceId: true,
          rangeFrom: true,
          rangeTo: true,
          searchTerm: true,
          status: true,
          mailsTotal: true,
          mailsChecked: true,
          documentsAuto: true,
          documentsManual: true,
          documentsIgnored: true,
          documentsFailed: true,
          errorMessage: true,
          cancelRequested: true,
          truncationReason: true,
          startedAt: true,
          finishedAt: true,
          source: {
            select: {
              label: true,
            },
          },
        },
      });

      return runs.map(({ source, ...run }) => ({
        ...run,
        sourceLabel: source.label,
      }));
    }),

  cancelSyncRun: authenticatedProcedure
    .input(ZCancelSyncRunRequestSchema)
    .output(ZCancelSyncRunResponseSchema)
    .mutation(async ({ input, ctx }) => {
      const syncRun = await prisma.syncRun.findUnique({
        where: { id: input.syncRunId },
        include: { source: { select: { userId: true } } },
      });
      if (!syncRun || syncRun.source.userId !== ctx.user.id) {
        throw new AppError(AppErrorCode.NOT_FOUND, { message: 'Sync-Lauf nicht gefunden.' });
      }
      if (syncRun.status !== 'PENDING' && syncRun.status !== 'RUNNING') {
        return { cancelRequested: false };
      }
      await prisma.syncRun.update({
        where: { id: syncRun.id },
        data: { cancelRequested: true },
      });
      return { cancelRequested: true };
    }),
});
