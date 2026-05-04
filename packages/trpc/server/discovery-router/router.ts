// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 NexaStack, NexaSign contributors
import { EnvelopeType } from '@prisma/client';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { AppError, AppErrorCode } from '@nexasign/lib/errors/app-error';
import { getDiscoveryReader, isDiscoveryConfigured } from '@nexasign/lib/server-only/discovery';
import { createEnvelope } from '@nexasign/lib/server-only/envelope/create-envelope';
import { getAbsoluteArchivePath } from '@nexasign/lib/server-only/sources/archive';
import {
  lookupPortalUrl,
  parseAmountToNumber,
  resyncSingleDocument,
} from '@nexasign/lib/server-only/sources/imap';
import { putNormalizedPdfFileServerSide } from '@nexasign/lib/universal/upload/put-file.server';
import { prisma } from '@nexasign/prisma';

import { authenticatedProcedure, router } from '../trpc';
import {
  ZCreateSigningDocumentRequestSchema,
  ZCreateSigningDocumentResponseSchema,
  ZFindDiscoveryDocumentsRequestSchema,
  ZFindDiscoveryDocumentsResponseSchema,
  ZGetActiveSyncRunsResponseSchema,
  ZGetDiscoveryDocumentRequestSchema,
  ZGetDiscoveryDocumentResponseSchema,
  ZGetDocumentDetailRequestSchema,
  ZGetDocumentDetailResponseSchema,
  ZGetOverviewResponseSchema,
  ZResyncSingleDocumentRequestSchema,
  ZResyncSingleDocumentResponseSchema,
  ZUpdateDetectedFieldsRequestSchema,
  ZUpdateDetectedFieldsResponseSchema,
  ZUpdateDiscoveryDocumentStatusRequestSchema,
  ZUpdateDiscoveryDocumentStatusResponseSchema,
} from './schema';

const ACTION_STATUS_MAP = {
  accept: 'ACCEPTED',
  'mark-pending-manual': 'PENDING_MANUAL',
  archive: 'ARCHIVED',
  ignore: 'IGNORED',
} as const;

const ACTION_AUDIT_MAP = {
  accept: 'DISCOVERY_DOCUMENT_ACCEPTED',
  'mark-pending-manual': null,
  archive: null,
  ignore: 'DISCOVERY_DOCUMENT_IGNORED',
} as const;

const getPrimaryPdfDocumentDataId = async (doc: {
  title: string;
  dataId: string | null;
  archivePath: string | null;
  artifacts: Array<{
    kind: string;
    relativePath: string;
    fileName: string;
    contentType: string;
  }>;
}): Promise<string> => {
  if (doc.dataId) {
    return doc.dataId;
  }

  const pdfArtifact = doc.artifacts.find(
    (artifact) =>
      artifact.kind === 'ATTACHMENT' &&
      (artifact.contentType === 'application/pdf' ||
        artifact.fileName.toLowerCase().endsWith('.pdf')),
  );

  if (!doc.archivePath || !pdfArtifact) {
    throw new AppError(AppErrorCode.INVALID_BODY, {
      message:
        'Dieses Dokument hat noch keine PDF-Datei. Laden Sie zuerst die Mail erneut aus IMAP oder ziehen Sie den Beleg manuell.',
      statusCode: 400,
    });
  }

  const archiveDir = path.resolve(getAbsoluteArchivePath(doc.archivePath));
  const filePath = path.resolve(archiveDir, pdfArtifact.relativePath);

  if (!filePath.startsWith(`${archiveDir}${path.sep}`)) {
    throw new AppError(AppErrorCode.INVALID_BODY, {
      message: 'Ungültiger Archivpfad.',
      statusCode: 400,
    });
  }

  const bytes = await readFile(filePath);
  const data = await putNormalizedPdfFileServerSide({
    name: pdfArtifact.fileName || `${doc.title}.pdf`,
    type: 'application/pdf',
    arrayBuffer: async () =>
      Promise.resolve(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)),
  });

  return data.id;
};

export const discoveryRouter = router({
  /**
   * Liste der gefundenen Dokumente für das aktive Team und den aktiven User.
   * Reader-Wahl passiert serverseitig anhand der Environment-Konfiguration.
   *
   * Antwort enthält zusätzlich die Source-Liste des aktuellen Users (pro User
   * konfiguriert, nicht pro Team), damit das UI Empty-State-Logik und
   * Sync-Status anzeigen kann.
   */
  findDocuments: authenticatedProcedure
    .input(ZFindDiscoveryDocumentsRequestSchema)
    .output(ZFindDiscoveryDocumentsResponseSchema)
    .query(async ({ input, ctx }) => {
      const configured = isDiscoveryConfigured();

      const sources = await prisma.source.findMany({
        where: { userId: ctx.user.id, ...(ctx.teamId ? { teamId: ctx.teamId } : {}) },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          kind: true,
          label: true,
          lastSyncAt: true,
          lastSyncStatus: true,
          // Letzter erfolgreich abgeschlossener SyncRun je Quelle — sein rangeTo
          // ist das natürliche Start-Datum für den nächsten Lauf (inkrementelle
          // Sync-Semantik). Index `[sourceId, startedAt desc]` deckt das ab.
          syncRuns: {
            where: { status: 'SUCCESS' },
            orderBy: { startedAt: 'desc' },
            take: 1,
            select: { rangeTo: true },
          },
        },
      });

      const sourceSummaries = sources.map((source) => ({
        id: source.id,
        kind: source.kind,
        label: source.label,
        lastSyncAt: source.lastSyncAt,
        lastSyncStatus: source.lastSyncStatus,
        lastSuccessfulSyncRangeTo: source.syncRuns[0]?.rangeTo ?? null,
      }));

      if (!configured) {
        return {
          documents: [],
          total: 0,
          nextCursor: null,
          configured: false,
          hasAnySource: sourceSummaries.length > 0,
          sources: sourceSummaries,
          summary: null,
          focusSummary: null,
        };
      }

      const reader = getDiscoveryReader();
      const { teamId, user } = ctx;
      const { cursor, ...filter } = input;

      const discoveryContext = {
        teamId: teamId ?? undefined,
        userId: user.id,
      };
      const { qualityFilter: _qualityFilter, ...focusSummaryFilter } = filter;

      const [page, summary, focusSummary] = await Promise.all([
        reader.findDocuments(filter, cursor ?? null, discoveryContext),
        reader.summarizeDocuments?.(filter, discoveryContext) ?? Promise.resolve(null),
        reader.summarizeDocuments?.(focusSummaryFilter, discoveryContext) ?? Promise.resolve(null),
      ]);

      return {
        documents: page.documents,
        total: page.total,
        nextCursor: page.nextCursor,
        configured: true,
        hasAnySource: sourceSummaries.length > 0,
        sources: sourceSummaries,
        summary,
        focusSummary,
      };
    }),

  getDocument: authenticatedProcedure
    .input(ZGetDiscoveryDocumentRequestSchema)
    .output(ZGetDiscoveryDocumentResponseSchema)
    .query(async ({ input, ctx }) => {
      if (!isDiscoveryConfigured()) {
        return null;
      }
      const reader = getDiscoveryReader();
      const { teamId, user } = ctx;
      return reader.getDocument(input.id, {
        teamId: teamId ?? undefined,
        userId: user.id,
      });
    }),

  /**
   * Status-Aktionen auf einem DiscoveryDocument: accept / archive / ignore /
   * mark-pending-manual. Auth-Modell: Team-Member darf lokale Uploads ändern,
   * eigene IMAP-Belege ändern. Fremde IMAP-Belege bleiben unsichtbar (siehe
   * db-reader.buildWhere) und damit auch unveränderbar.
   *
   * WORM-Regel: ab `acceptedAt != null` (User hat den Beleg als Geschäftsbeleg
   * akzeptiert) sind nur noch ACCEPTED → ARCHIVED erlaubt. Reverse zu INBOX
   * oder IGNORED ist gesperrt — GoBD-Aufbewahrung.
   */
  updateStatus: authenticatedProcedure
    .input(ZUpdateDiscoveryDocumentStatusRequestSchema)
    .output(ZUpdateDiscoveryDocumentStatusResponseSchema)
    .mutation(async ({ input, ctx }) => {
      const { teamId, user } = ctx;
      if (!teamId) {
        throw new AppError(AppErrorCode.UNAUTHORIZED, {
          message: 'Aktion braucht einen Team-Kontext.',
        });
      }

      const doc = await prisma.discoveryDocument.findFirst({
        where: {
          id: input.id,
          teamId,
          OR: [{ providerSource: 'local' }, { uploadedById: user.id }],
        },
        select: { id: true, providerSource: true, status: true, acceptedAt: true },
      });
      if (!doc) {
        throw new AppError(AppErrorCode.NOT_FOUND, {
          message: 'Dokument nicht gefunden oder nicht änderbar.',
        });
      }

      // WORM-Guard: nach Accept nur noch Archivieren erlaubt.
      if (doc.acceptedAt && input.action !== 'archive') {
        throw new AppError(AppErrorCode.UNAUTHORIZED, {
          message:
            'Dieses Dokument ist als Geschäftsbeleg akzeptiert und unterliegt der ' +
            '10-jährigen Aufbewahrung (§ 147 AO / § 257 HGB). Es kann nur noch ' +
            'archiviert, aber nicht zurückgesetzt oder ignoriert werden.',
        });
      }

      const newStatus = ACTION_STATUS_MAP[input.action];
      await prisma.$transaction(async (tx) => {
        // accept/archive setzen acceptedAt + acceptedById exakt einmal.
        // Wichtig für GoBD: Auch ein direkt archivierter Beleg ist damit
        // aufbewahrungspflichtig und landet im Exportfluss.
        const updateData: {
          status: typeof newStatus;
          acceptedAt?: Date;
          acceptedById?: number;
        } = { status: newStatus };
        const startsRetention =
          !doc.acceptedAt && (input.action === 'accept' || input.action === 'archive');
        if (startsRetention) {
          updateData.acceptedAt = new Date();
          updateData.acceptedById = user.id;
        }

        await tx.discoveryDocument.update({
          where: { id: doc.id },
          data: updateData,
        });

        const auditEvent =
          startsRetention && input.action === 'archive'
            ? 'DISCOVERY_DOCUMENT_ACCEPTED'
            : ACTION_AUDIT_MAP[input.action];

        if (auditEvent) {
          await tx.discoveryAuditLog.create({
            data: {
              event: auditEvent,
              discoveryDocumentId: doc.id,
              userId: user.id,
              teamId,
              metadata: {
                action: input.action,
                providerSource: doc.providerSource,
                retentionStarted: startsRetention,
              },
            },
          });
        }
      });
      return { ok: true };
    }),

  /**
   * Detail-Daten für die Beleg-Detailseite. Liefert Document + alle Artifacts
   * (Mail, Body, Anhänge mit sha256), absoluter Server-Pfad fürs FTP-Reingucken,
   * Gmail-Deep-Link für IMAP-Belege.
   */
  getDocumentDetail: authenticatedProcedure
    .input(ZGetDocumentDetailRequestSchema)
    .output(ZGetDocumentDetailResponseSchema)
    .query(async ({ input, ctx }) => {
      const { teamId, user } = ctx;
      if (!teamId) return null;

      const doc = await prisma.discoveryDocument.findFirst({
        where: {
          id: input.id,
          teamId,
          OR: [{ providerSource: 'local' }, { uploadedById: user.id }],
        },
        include: {
          artifacts: { orderBy: { kind: 'asc' } },
          source: { select: { label: true, kind: true } },
          acceptedBy: { select: { name: true } },
        },
      });
      if (!doc) return null;

      const uiStatus =
        doc.status === 'INBOX'
          ? ('inbox' as const)
          : doc.status === 'PENDING_MANUAL'
            ? ('pending-manual' as const)
            : ('processed' as const);

      // Gmail-Deep-Link: nur für IMAP-Belege mit Gmail-Source und messageId.
      // Format: https://mail.google.com/mail/u/0/#search/rfc822msgid:<messageId>
      // Wir haben nur den Hash gespeichert, nicht die Original-messageId — also
      // gibt's hier keinen Direkt-Link. Pragmatisch: Search nach Subject.
      const gmailDeepLink =
        doc.providerSource === 'imap' && doc.source?.kind === 'IMAP' && doc.title
          ? `https://mail.google.com/mail/u/0/#search/${encodeURIComponent(doc.title)}`
          : null;

      // Portal-URL aus Sender-Domain ableiten — `correspondent` kann ein
      // freier String sein („Hetzner Online GmbH <noreply@hetzner.com>",
      // „noreply@hetzner.com" oder nur der Name). Wir extrahieren die Domain
      // aus dem ersten @…-Token, das wir finden, und mappen sie auf eine
      // bekannte Anbieter-Portal-URL. Wenn nichts passt → null, Frontend
      // zeigt dann nur den Roh-Hint wie bisher.
      const senderDomain = (() => {
        const text = doc.correspondent ?? '';
        const match = text.match(/@([\w.-]+\.\w{2,})/i);
        return match?.[1]?.toLowerCase() ?? null;
      })();
      const portal = senderDomain ? lookupPortalUrl(senderDomain) : null;

      // attachmentCount/hasArchive werden vom Listen-Schema verlangt; in der
      // Detail-Antwort spiegeln wir sie aus den realen Artifacts wider.
      const attachmentCount = doc.artifacts.filter((a) => a.kind === 'ATTACHMENT').length;
      const hasArchive =
        doc.archivePath !== null && doc.archivePath !== '' && doc.artifacts.length > 0;

      return {
        document: {
          id: doc.id,
          nativeId: doc.id,
          title: doc.title,
          correspondent: doc.correspondent,
          documentType: doc.documentType,
          tags: doc.tags,
          documentDate: doc.documentDate,
          capturedAt: doc.capturedAt,
          status: uiStatus,
          bodyText: doc.bodyText,
          bodyHasHtml: doc.bodyHasHtml,
          archivePath: doc.archivePath,
          detectedAmount: doc.detectedAmount,
          detectedInvoiceNumber: doc.detectedInvoiceNumber,
          portalHint: doc.portalHint,
          portalUrl: portal?.url ?? null,
          portalUrlLabel: portal?.label ?? null,
          messageIdHash: doc.messageIdHash,
          providerSource: doc.providerSource,
          providerNativeId: doc.providerNativeId,
          acceptedAt: doc.acceptedAt,
          acceptedByName: doc.acceptedBy?.name ?? null,
          sourceLabel: doc.source?.label ?? null,
          signingEnvelopeId: doc.signingEnvelopeId,
          canCreateSigningDocument:
            doc.dataId !== null ||
            doc.artifacts.some(
              (a) =>
                a.kind === 'ATTACHMENT' &&
                (a.contentType === 'application/pdf' || a.fileName.toLowerCase().endsWith('.pdf')),
            ),
          attachmentCount,
          hasArchive,
        },
        artifacts: doc.artifacts.map((a) => ({
          id: a.id,
          kind: a.kind,
          fileName: a.fileName,
          contentType: a.contentType,
          fileSize: a.fileSize,
          sha256: a.sha256,
          relativePath: a.relativePath,
        })),
        absoluteArchivePath: doc.archivePath ? getAbsoluteArchivePath(doc.archivePath) : null,
        gmailDeepLink,
      };
    }),

  createSigningDocument: authenticatedProcedure
    .input(ZCreateSigningDocumentRequestSchema)
    .output(ZCreateSigningDocumentResponseSchema)
    .mutation(async ({ input, ctx }) => {
      const { teamId, user } = ctx;
      if (!teamId) {
        throw new AppError(AppErrorCode.UNAUTHORIZED, {
          message: 'Signatur-Vorbereitung braucht einen Team-Kontext.',
        });
      }

      const doc = await prisma.discoveryDocument.findFirst({
        where: {
          id: input.id,
          teamId,
          OR: [{ providerSource: 'local' }, { uploadedById: user.id }],
        },
        include: {
          artifacts: true,
          signingEnvelope: { select: { id: true } },
        },
      });

      if (!doc) {
        throw new AppError(AppErrorCode.NOT_FOUND, {
          message: 'Dokument nicht gefunden oder nicht änderbar.',
        });
      }

      if (doc.signingEnvelopeId) {
        if (!doc.acceptedAt || doc.status !== 'SIGNED') {
          await prisma.$transaction(async (tx) => {
            await tx.discoveryDocument.update({
              where: { id: doc.id },
              data: {
                status: doc.status === 'ARCHIVED' ? 'ARCHIVED' : 'SIGNED',
                acceptedAt: doc.acceptedAt ?? new Date(),
                acceptedById: doc.acceptedById ?? user.id,
              },
            });

            if (!doc.acceptedAt) {
              await tx.discoveryAuditLog.create({
                data: {
                  event: 'DISCOVERY_DOCUMENT_ACCEPTED',
                  discoveryDocumentId: doc.id,
                  userId: user.id,
                  teamId,
                  metadata: {
                    action: 'create-signing-document',
                    envelopeId: doc.signingEnvelopeId,
                    providerSource: doc.providerSource,
                    retentionStarted: true,
                  },
                },
              });
            }
          });
        }
        return { envelopeId: doc.signingEnvelopeId, alreadyExisted: true };
      }

      const documentDataId = await getPrimaryPdfDocumentDataId(doc);

      const envelope = await createEnvelope({
        userId: user.id,
        teamId,
        internalVersion: 1,
        normalizePdf: true,
        data: {
          type: EnvelopeType.DOCUMENT,
          title: doc.title,
          envelopeItems: [{ documentDataId }],
        },
        meta: {
          timezone: 'Europe/Berlin',
          distributionMethod: 'NONE',
        },
        bypassDefaultRecipients: true,
        requestMetadata: ctx.metadata,
      });

      await prisma.$transaction(async (tx) => {
        const startsRetention = !doc.acceptedAt;

        await tx.discoveryDocument.update({
          where: { id: doc.id },
          data: {
            signingEnvelopeId: envelope.id,
            status: doc.status === 'ARCHIVED' ? 'ARCHIVED' : 'SIGNED',
            acceptedAt: doc.acceptedAt ?? new Date(),
            acceptedById: doc.acceptedById ?? user.id,
          },
        });

        if (startsRetention) {
          await tx.discoveryAuditLog.create({
            data: {
              event: 'DISCOVERY_DOCUMENT_ACCEPTED',
              discoveryDocumentId: doc.id,
              userId: user.id,
              teamId,
              metadata: {
                action: 'create-signing-document',
                envelopeId: envelope.id,
                providerSource: doc.providerSource,
                retentionStarted: true,
              },
            },
          });
        }

        await tx.discoveryAuditLog.create({
          data: {
            event: 'DISCOVERY_SIGNING_DOCUMENT_CREATED',
            discoveryDocumentId: doc.id,
            userId: user.id,
            teamId,
            metadata: {
              action: 'create-signing-document',
              envelopeId: envelope.id,
            },
          },
        });
      });

      return { envelopeId: envelope.id, alreadyExisted: false };
    }),

  /**
   * Re-Sync einer einzelnen Mail aus IMAP — laedt Archive nach (eml + body +
   * attachments + metadata) fuer Belege, die vor Aktivierung des Archive-
   * Features importiert wurden. Idempotent — keine Duplikat-Documents,
   * kein Status-Verlust. User-Berechtigungs-Check liegt in resyncSingleDocument().
   */
  resyncSingle: authenticatedProcedure
    .input(ZResyncSingleDocumentRequestSchema)
    .output(ZResyncSingleDocumentResponseSchema)
    .mutation(async ({ input, ctx }) => {
      const { teamId, user } = ctx;
      if (!teamId) {
        throw new AppError(AppErrorCode.UNAUTHORIZED, {
          message: 'Re-Sync braucht einen Team-Kontext.',
        });
      }
      return resyncSingleDocument({
        documentId: input.id,
        userId: user.id,
        teamId,
      });
    }),

  /**
   * Manuelle Korrektur der vom Klassifikator erkannten Felder. Persona-Anker:
   * Steuerberater verlangt belastbare CSV — wenn die Heuristik daneben liegt
   * (Netto statt Brutto, abgekürzter Anbieter), muss der Nutzer korrigieren
   * können. Sobald der Beleg `acceptedAt` hat, greift WORM und der Mutator
   * weist Edits ab.
   *
   * Auth-Modell wie updateStatus: Team-Member darf eigene IMAP-Belege oder
   * lokale Uploads ändern; fremde IMAP-Belege bleiben unsichtbar/unmutierbar.
   */
  updateDetectedFields: authenticatedProcedure
    .input(ZUpdateDetectedFieldsRequestSchema)
    .output(ZUpdateDetectedFieldsResponseSchema)
    .mutation(async ({ input, ctx }) => {
      const { teamId, user } = ctx;
      if (!teamId) {
        throw new AppError(AppErrorCode.UNAUTHORIZED, {
          message: 'Aktion braucht einen Team-Kontext.',
        });
      }
      const doc = await prisma.discoveryDocument.findFirst({
        where: {
          id: input.id,
          teamId,
          OR: [{ providerSource: 'local' }, { uploadedById: user.id }],
        },
        select: {
          id: true,
          acceptedAt: true,
          providerSource: true,
        },
      });
      if (!doc) {
        throw new AppError(AppErrorCode.NOT_FOUND, {
          message: 'Dokument nicht gefunden oder nicht änderbar.',
        });
      }
      if (doc.acceptedAt) {
        throw new AppError(AppErrorCode.UNAUTHORIZED, {
          message:
            'Dieses Dokument ist als Geschäftsbeleg akzeptiert und unterliegt der ' +
            '10-jährigen Aufbewahrung (§ 147 AO / § 257 HGB). Erkannte Felder ' +
            'können nach Akzeptieren nicht mehr geändert werden.',
        });
      }
      const data: Record<string, string | null> = {};
      const normalize = (v: string | null | undefined): string | null | undefined => {
        if (v === undefined) return undefined;
        if (v === null) return null;
        const trimmed = v.trim();
        return trimmed === '' ? null : trimmed;
      };
      const amount = normalize(input.detectedAmount);
      const invoiceNumber = normalize(input.detectedInvoiceNumber);
      const correspondent = normalize(input.correspondent);
      if (amount !== undefined) data.detectedAmount = amount;
      if (invoiceNumber !== undefined) data.detectedInvoiceNumber = invoiceNumber;
      if (correspondent !== undefined) data.correspondent = correspondent;

      const updated = await prisma.$transaction(async (tx) => {
        const result = await tx.discoveryDocument.update({
          where: { id: doc.id },
          data,
          select: {
            detectedAmount: true,
            detectedInvoiceNumber: true,
            correspondent: true,
          },
        });
        await tx.discoveryAuditLog.create({
          data: {
            event: 'DISCOVERY_DOCUMENT_UPDATED',
            discoveryDocumentId: doc.id,
            userId: user.id,
            teamId,
            metadata: {
              fields: Object.keys(data),
              providerSource: doc.providerSource,
            },
          },
        });
        return result;
      });

      return {
        ok: true,
        detectedAmount: updated.detectedAmount,
        detectedInvoiceNumber: updated.detectedInvoiceNumber,
        correspondent: updated.correspondent,
      };
    }),

  /**
   * Aktive Sync-Runs für die Hauptseite. Ein einzelner schmaler SELECT —
   * Frontend pollt das alle 3 s nur dann, wenn die letzte Antwort nicht-leer
   * war. Damit zeigt „Dokumente finden" einen lebendigen Fortschritt
   * (X Mails geprüft) statt einen statischen „letzter Sync"-Zeitstempel,
   * ohne den teuren Discovery-Reader zu spammen.
   */
  getActiveSyncRuns: authenticatedProcedure
    .output(ZGetActiveSyncRunsResponseSchema)
    .query(async ({ ctx }) => {
      const { teamId, user } = ctx;
      if (!teamId) return [];
      const runs = await prisma.syncRun.findMany({
        where: {
          status: { in: ['PENDING', 'RUNNING'] },
          source: {
            userId: user.id,
            teamId,
          },
        },
        orderBy: { startedAt: 'desc' },
        select: {
          id: true,
          sourceId: true,
          status: true,
          rangeFrom: true,
          rangeTo: true,
          mailsChecked: true,
          documentsAuto: true,
          documentsManual: true,
          startedAt: true,
          source: { select: { label: true } },
        },
      });
      return runs.flatMap((r) => {
        if (r.status !== 'PENDING' && r.status !== 'RUNNING') return [];
        return [
          {
            id: r.id,
            sourceId: r.sourceId,
            sourceLabel: r.source.label,
            status: r.status,
            rangeFrom: r.rangeFrom,
            rangeTo: r.rangeTo,
            mailsChecked: r.mailsChecked,
            documentsAuto: r.documentsAuto,
            documentsManual: r.documentsManual,
            startedAt: r.startedAt,
          },
        ];
      });
    }),

  /**
   * Aggregat-Overview für die Wow-Card. Ein einziger Read pro Page-Visit,
   * keine Pagination. Skaliert linear mit Beleg-Anzahl, was für die typische
   * Solo-Persona (≤ ein paar tausend Belege) unkritisch ist; bei Mengen >
   * 50 000 Belegen würde man hier einen materialisierten Counter brauchen.
   */
  getOverview: authenticatedProcedure.output(ZGetOverviewResponseSchema).query(async ({ ctx }) => {
    const { teamId, user } = ctx;
    const empty = {
      total: 0,
      withAmount: 0,
      downloadable: 0,
      accepted: 0,
      needsReview: 0,
      estimatedTotalCents: 0,
      yearDistribution: [],
      rangeFrom: null,
      rangeTo: null,
      lastCompletedSyncAt: null,
    };
    if (!teamId) return empty;

    const docs = await prisma.discoveryDocument.findMany({
      where: {
        teamId,
        // Gleiche Multi-User-Isolation wie der DB-Reader: lokale Uploads
        // sind Team-sichtbar, IMAP-Belege nur für ihren Owner.
        OR: [{ providerSource: 'local' }, { uploadedById: user.id }],
      },
      select: {
        documentDate: true,
        capturedAt: true,
        status: true,
        detectedAmount: true,
        acceptedAt: true,
        _count: { select: { artifacts: { where: { kind: 'ATTACHMENT' } } } },
      },
    });

    if (docs.length === 0) return empty;

    let withAmount = 0;
    let downloadable = 0;
    let accepted = 0;
    let needsReview = 0;
    let estimatedTotalCents = 0;
    const yearMap = new Map<number, number>();
    let rangeFrom: Date | null = null;
    let rangeTo: Date | null = null;

    for (const d of docs) {
      const dt = d.documentDate ?? d.capturedAt;
      if (dt) {
        const year = dt.getUTCFullYear();
        yearMap.set(year, (yearMap.get(year) ?? 0) + 1);
        if (!rangeFrom || dt < rangeFrom) rangeFrom = dt;
        if (!rangeTo || dt > rangeTo) rangeTo = dt;
      }
      if (d._count.artifacts > 0) downloadable += 1;
      if (d.status === 'ACCEPTED') accepted += 1;
      if (d.status === 'INBOX' || d.status === 'PENDING_MANUAL') needsReview += 1;
      if (d.detectedAmount) {
        const value = parseAmountToNumber(d.detectedAmount);
        if (Number.isFinite(value) && value > 0) {
          withAmount += 1;
          estimatedTotalCents += Math.round(value * 100);
        }
      }
    }

    const lastSync = await prisma.syncRun.findFirst({
      where: {
        status: 'SUCCESS',
        source: { userId: user.id, teamId },
      },
      orderBy: { finishedAt: 'desc' },
      select: { finishedAt: true },
    });

    const yearDistribution = [...yearMap.entries()]
      .map(([year, count]) => ({ year, count }))
      .sort((a, b) => b.year - a.year);

    return {
      total: docs.length,
      withAmount,
      downloadable,
      accepted,
      needsReview,
      estimatedTotalCents,
      yearDistribution,
      rangeFrom,
      rangeTo,
      lastCompletedSyncAt: lastSync?.finishedAt ?? null,
    };
  }),
});
