// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 NexaStack, NexaSign contributors
import { prisma } from '@nexasign/prisma';

import { decryptImapConfig } from '../../../server-only/sources/imap';
import { getSourceAdapter } from '../../../server-only/sources/registry';
import type { JobRunIO } from '../../client/_internal/job';
import type { TRunSyncRangeJobDefinition } from './run-sync-range';

const SUSPEND_AFTER_FAILURES = 3;

/**
 * Handler für einen einzelnen User-getriggerten Sync-Lauf.
 *
 * Ablauf:
 *   1. SyncRun + Source laden, auf RUNNING setzen.
 *   2. Konfig entschlüsseln, Adapter holen.
 *   3. adapter.syncRange() mit Cancel-Check + Progress-Updates aufrufen.
 *   4. Counter aus dem Adapter-Result in SyncRun schreiben.
 *   5. Source.lastSyncAt updaten bei Erfolg, consecutiveFailures bei Login-Fehler.
 *   6. Audit-Logs schreiben (STARTED, COMPLETED oder LOGIN_FAILED).
 */
export const run = async ({
  payload,
  io,
}: {
  payload: TRunSyncRangeJobDefinition;
  io: JobRunIO;
}) => {
  const { syncRunId } = payload;

  const syncRun = await prisma.syncRun.findUnique({
    where: { id: syncRunId },
    include: { source: true },
  });

  if (!syncRun) {
    io.logger.warn(`SyncRun ${syncRunId} disappeared`);
    return;
  }

  if (syncRun.status !== 'PENDING') {
    io.logger.info(`SyncRun ${syncRunId} skipped: status=${syncRun.status}`);
    return;
  }

  const source = syncRun.source;

  // Source kann zwischen Trigger und Job-Start gesperrt worden sein.
  if (source.lastSyncStatus === 'SUSPENDED') {
    await prisma.syncRun.update({
      where: { id: syncRun.id },
      data: {
        status: 'FAILED',
        errorMessage: 'Quelle ist gesperrt.',
        finishedAt: new Date(),
      },
    });
    return;
  }

  // PENDING → RUNNING
  await prisma.syncRun.update({
    where: { id: syncRun.id },
    data: { status: 'RUNNING' },
  });

  await prisma.discoveryAuditLog.create({
    data: {
      event: 'IMAP_SYNC_STARTED',
      sourceId: source.id,
      userId: syncRun.triggeredById,
      teamId: source.teamId,
      metadata: {
        syncRunId: syncRun.id,
        rangeFrom: syncRun.rangeFrom.toISOString(),
        rangeTo: syncRun.rangeTo.toISOString(),
        searchTerm: syncRun.searchTerm,
      },
    },
  });

  const adapter = getSourceAdapter(source.kind);
  if (!adapter) {
    await prisma.syncRun.update({
      where: { id: syncRun.id },
      data: {
        status: 'FAILED',
        errorMessage: `Kein Adapter für Source-Typ "${source.kind}" registriert.`,
        finishedAt: new Date(),
      },
    });
    return;
  }

  let decryptedConfig: unknown;
  try {
    decryptedConfig = decryptImapConfig({
      ciphertext: source.encryptedConfig,
      keyVersion: source.encryptedConfigKeyVersion,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Konfig-Decrypt fehlgeschlagen';
    await prisma.syncRun.update({
      where: { id: syncRun.id },
      data: {
        status: 'FAILED',
        errorMessage: message,
        finishedAt: new Date(),
      },
    });
    return;
  }

  // Cancel-Check: liest cancelRequested aus DB. Adapter ruft das pro Mail.
  const isCancelled = async (): Promise<boolean> => {
    const fresh = await prisma.syncRun.findUnique({
      where: { id: syncRun.id },
      select: { cancelRequested: true },
    });
    return fresh?.cancelRequested ?? false;
  };

  // Progress-Update: schreibt Counter regelmäßig in die DB, damit das UI
  // beim Polling den aktuellen Stand sieht.
  const onProgress = async (progress: {
    mailsTotal?: number | null;
    mailsChecked: number;
    documentsAuto: number;
    documentsManual: number;
    documentsIgnored: number;
    documentsFailed: number;
  }): Promise<void> => {
    // mailsTotal nur schreiben, wenn der Adapter es geliefert hat — sonst
    // bestehenden Wert nicht ueberschreiben (null in der DB akzeptabel).
    const { mailsTotal, ...rest } = progress;
    await prisma.syncRun.update({
      where: { id: syncRun.id },
      data: {
        ...rest,
        ...(typeof mailsTotal === 'number' ? { mailsTotal } : {}),
      },
    });
  };

  try {
    const result = await adapter.syncRange({
      sourceId: source.id,
      userId: source.userId,
      teamId: source.teamId,
      from: syncRun.rangeFrom,
      to: syncRun.rangeTo,
      searchTerm: syncRun.searchTerm,
      decryptedConfig,
      isCancelled,
      onProgress,
    });

    const wasCancelled = await isCancelled();
    const finalStatus = wasCancelled ? 'CANCELLED' : 'SUCCESS';

    await prisma.$transaction([
      prisma.syncRun.update({
        where: { id: syncRun.id },
        data: {
          status: finalStatus,
          mailsChecked: result.mailsChecked,
          documentsAuto: result.documentsAuto,
          documentsManual: result.documentsManual,
          documentsIgnored: result.documentsIgnored,
          documentsFailed: result.documentsFailed,
          truncationReason: result.truncationReason ?? null,
          finishedAt: new Date(),
        },
      }),
      prisma.source.update({
        where: { id: source.id },
        data: {
          lastSyncAt: new Date(),
          lastSyncStatus: 'SUCCESS',
          lastSyncError: null,
          consecutiveFailures: 0,
        },
      }),
      prisma.discoveryAuditLog.create({
        data: {
          event: 'IMAP_SYNC_COMPLETED',
          sourceId: source.id,
          userId: syncRun.triggeredById,
          teamId: source.teamId,
          metadata: {
            syncRunId: syncRun.id,
            status: finalStatus,
            searchTerm: syncRun.searchTerm,
            mailsChecked: result.mailsChecked,
            documentsAuto: result.documentsAuto,
            documentsManual: result.documentsManual,
            documentsIgnored: result.documentsIgnored,
          },
        },
      }),
    ]);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const newFailures = source.consecutiveFailures + 1;
    const shouldSuspend = newFailures >= SUSPEND_AFTER_FAILURES;

    await prisma.$transaction([
      prisma.syncRun.update({
        where: { id: syncRun.id },
        data: {
          status: 'FAILED',
          errorMessage: message,
          finishedAt: new Date(),
        },
      }),
      prisma.source.update({
        where: { id: source.id },
        data: {
          lastSyncStatus: shouldSuspend ? 'SUSPENDED' : 'FAILED',
          lastSyncError: message,
          consecutiveFailures: newFailures,
        },
      }),
      prisma.discoveryAuditLog.create({
        data: {
          event: 'IMAP_SYNC_LOGIN_FAILED',
          sourceId: source.id,
          userId: syncRun.triggeredById,
          metadata: { syncRunId: syncRun.id, error: message, suspended: shouldSuspend },
        },
      }),
    ]);
  }
};
