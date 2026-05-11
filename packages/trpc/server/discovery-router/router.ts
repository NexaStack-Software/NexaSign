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
  ZBulkAcceptRequestSchema,
  ZBulkAcceptResponseSchema,
  ZBulkArchiveByFilterRequestSchema,
  ZBulkArchiveRequestSchema,
  ZBulkArchiveResponseSchema,
  ZBulkIgnoreRequestSchema,
  ZBulkIgnoreResponseSchema,
  ZBulkUnacceptRequestSchema,
  ZBulkUnacceptResponseSchema,
  ZCreateSigningDocumentRequestSchema,
  ZCreateSigningDocumentResponseSchema,
  ZFindDiscoveryDocumentsRequestSchema,
  ZFindDiscoveryDocumentsResponseSchema,
  ZGetActiveSyncRunsResponseSchema,
  ZGetCorrespondentSummaryResponseSchema,
  ZGetDiscoveryDocumentRequestSchema,
  ZGetDiscoveryDocumentResponseSchema,
  ZGetDiscoveryRuleSuggestionsResponseSchema,
  ZGetDocumentDetailRequestSchema,
  ZGetDocumentDetailResponseSchema,
  ZGetOverviewResponseSchema,
  ZResyncSingleDocumentRequestSchema,
  ZResyncSingleDocumentResponseSchema,
  ZSmartAcceptCriteriaSchema,
  ZSmartAcceptPreviewResponseSchema,
  ZUpdateDetectedFieldsRequestSchema,
  ZUpdateDetectedFieldsResponseSchema,
  ZUpdateDiscoveryDocumentStatusRequestSchema,
  ZUpdateDiscoveryDocumentStatusResponseSchema,
  ZUpdateDiscoveryRuleStatusRequestSchema,
  ZUpdateDiscoveryRuleStatusResponseSchema,
} from './schema';

const ACTION_STATUS_MAP = {
  accept: 'ACCEPTED',
  'mark-pending-manual': 'PENDING_MANUAL',
  archive: 'ARCHIVED',
  ignore: 'IGNORED',
  unaccept: 'INBOX',
} as const;

const ACTION_AUDIT_MAP = {
  accept: 'DISCOVERY_DOCUMENT_ACCEPTED',
  'mark-pending-manual': null,
  archive: 'DISCOVERY_DOCUMENT_ARCHIVED',
  ignore: 'DISCOVERY_DOCUMENT_IGNORED',
  unaccept: 'DISCOVERY_DOCUMENT_UNACCEPTED',
} as const;

const buildArchiveSearchFilter = (query?: string) => {
  const term = query?.trim();
  if (!term) return undefined;

  return [
    { title: { contains: term, mode: 'insensitive' as const } },
    { correspondent: { contains: term, mode: 'insensitive' as const } },
    { detectedInvoiceNumber: { contains: term, mode: 'insensitive' as const } },
  ];
};

type RuleAction = 'archive' | 'ignore';

const RULE_EVIDENCE_THRESHOLD = 2;

const toRuleAction = (action: RuleAction) => (action === 'archive' ? 'ARCHIVE' : 'IGNORE');

const toRuleStatus = (status: 'active' | 'dismissed') =>
  status === 'active' ? 'ACTIVE' : 'DISMISSED';

const buildSenderDomainRuleSuggestions = async ({
  teamId,
  userId,
}: {
  teamId: number;
  userId: number;
}) => {
  const grouped = await prisma.discoveryDocument.groupBy({
    by: ['senderDomain', 'status'],
    where: {
      teamId,
      uploadedById: userId,
      senderDomain: { not: null },
      status: { in: ['ACCEPTED', 'SIGNED', 'ARCHIVED', 'IGNORED'] },
    },
    _count: { _all: true },
    _max: { capturedAt: true },
  });

  const byDomain = new Map<
    string,
    { archive: number; ignore: number; lastMatchedAt: Date | null }
  >();

  for (const row of grouped) {
    if (!row.senderDomain) continue;
    const current = byDomain.get(row.senderDomain) ?? {
      archive: 0,
      ignore: 0,
      lastMatchedAt: null,
    };
    if (row.status === 'IGNORED') current.ignore += row._count._all;
    else current.archive += row._count._all;
    if (
      row._max.capturedAt &&
      (!current.lastMatchedAt || row._max.capturedAt > current.lastMatchedAt)
    ) {
      current.lastMatchedAt = row._max.capturedAt;
    }
    byDomain.set(row.senderDomain, current);
  }

  const existingRules = await prisma.discoveryRule.findMany({
    where: {
      teamId,
      userId,
      scope: 'SENDER_DOMAIN',
    },
    select: {
      id: true,
      pattern: true,
      action: true,
      status: true,
      confidence: true,
      evidenceCount: true,
      lastMatchedAt: true,
    },
  });
  const existingByKey = new Map(
    existingRules.map((rule) => [`${rule.pattern}:${rule.action}`, rule]),
  );

  const rules = [...byDomain.entries()]
    .flatMap(([domain, stats]) => {
      const candidates: Array<{
        action: RuleAction;
        evidenceCount: number;
        oppositeCount: number;
      }> = [];
      if (stats.archive >= RULE_EVIDENCE_THRESHOLD) {
        candidates.push({
          action: 'archive',
          evidenceCount: stats.archive,
          oppositeCount: stats.ignore,
        });
      }
      if (stats.ignore >= RULE_EVIDENCE_THRESHOLD) {
        candidates.push({
          action: 'ignore',
          evidenceCount: stats.ignore,
          oppositeCount: stats.archive,
        });
      }

      return candidates.map((candidate) => {
        const action = toRuleAction(candidate.action);
        const existing = existingByKey.get(`${domain}:${action}`);
        const confidence = Math.max(
          55,
          Math.min(98, 65 + candidate.evidenceCount * 8 - candidate.oppositeCount * 18),
        );
        return {
          id: existing?.id ?? null,
          scope: 'sender-domain' as const,
          pattern: domain,
          label: domain,
          action: candidate.action,
          status:
            existing?.status === 'ACTIVE'
              ? ('active' as const)
              : existing?.status === 'DISMISSED'
                ? ('dismissed' as const)
                : ('suggested' as const),
          confidence: existing?.confidence ?? confidence,
          evidenceCount: Math.max(existing?.evidenceCount ?? 0, candidate.evidenceCount),
          oppositeCount: candidate.oppositeCount,
          lastMatchedAt: existing?.lastMatchedAt ?? stats.lastMatchedAt,
        };
      });
    })
    .filter((suggestion) => suggestion.status !== 'dismissed')
    .filter((suggestion) => suggestion.status === 'active' || suggestion.confidence >= 70);

  const activeRules = rules
    .filter((rule) => rule.status === 'active')
    .sort((a, b) => b.confidence - a.confidence || b.evidenceCount - a.evidenceCount);

  const suggestedRules = rules
    .filter((rule) => rule.status === 'suggested')
    .sort((a, b) => {
      return b.confidence - a.confidence || b.evidenceCount - a.evidenceCount;
    })
    .slice(0, 5);

  return [...activeRules, ...suggestedRules];
};

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
          // Brauchen wir, um pro Quelle den Host (verschlüsselt) zu lesen und
          // ihn fürs Frontend (Gmail-Banner-Trigger u. a.) bereitzustellen.
          encryptedConfig: true,
          encryptedConfigKeyVersion: true,
          // Letzter erfolgreich abgeschlossener SyncRun je Quelle — sein rangeTo
          // ist das natürliche Start-Datum für den nächsten Lauf (inkrementelle
          // Sync-Semantik). Index `[sourceId, startedAt desc]` deckt das ab.
          syncRuns: {
            where: { status: 'SUCCESS' },
            orderBy: { startedAt: 'desc' },
            take: 1,
            select: { rangeTo: true, mailsChecked: true, rangeFrom: true },
          },
        },
      });

      // Host-Lookup: nur fuer IMAP-Quellen, dezentral entschluesselt. Wenn der
      // Decrypt scheitert (z. B. nach Key-Rotation ohne Migration), schalten
      // wir host auf null statt das ganze Listing scheitern zu lassen.
      const { decryptImapConfig } = await import('@nexasign/lib/server-only/sources/imap');
      const sourceSummaries = sources.map((source) => {
        let host: string | null = null;
        if (source.kind === 'IMAP') {
          try {
            const cfg = decryptImapConfig({
              ciphertext: source.encryptedConfig,
              keyVersion: source.encryptedConfigKeyVersion,
            });
            host = cfg.host.toLowerCase();
          } catch {
            host = null;
          }
        }
        const lastRun = source.syncRuns[0] ?? null;
        return {
          id: source.id,
          kind: source.kind,
          label: source.label,
          host,
          lastSyncAt: source.lastSyncAt,
          lastSyncStatus: source.lastSyncStatus,
          lastSuccessfulSyncRangeTo: lastRun?.rangeTo ?? null,
          lastSuccessfulSyncRangeFrom: lastRun?.rangeFrom ?? null,
          lastSuccessfulSyncMailsChecked: lastRun?.mailsChecked ?? null,
        };
      });

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

  getRuleSuggestions: authenticatedProcedure
    .output(ZGetDiscoveryRuleSuggestionsResponseSchema)
    .query(async ({ ctx }) => {
      const { teamId, user } = ctx;
      if (!teamId) {
        return { suggestions: [] };
      }

      const suggestions = await buildSenderDomainRuleSuggestions({
        teamId,
        userId: user.id,
      });

      return { suggestions };
    }),

  updateRuleStatus: authenticatedProcedure
    .input(ZUpdateDiscoveryRuleStatusRequestSchema)
    .output(ZUpdateDiscoveryRuleStatusResponseSchema)
    .mutation(async ({ input, ctx }) => {
      const { teamId, user } = ctx;
      if (!teamId) {
        throw new AppError(AppErrorCode.UNAUTHORIZED, {
          message: 'Regeln brauchen einen Team-Kontext.',
        });
      }

      await prisma.discoveryRule.upsert({
        where: {
          teamId_userId_scope_pattern_action: {
            teamId,
            userId: user.id,
            scope: 'SENDER_DOMAIN',
            pattern: input.pattern,
            action: toRuleAction(input.action),
          },
        },
        create: {
          teamId,
          userId: user.id,
          scope: 'SENDER_DOMAIN',
          pattern: input.pattern,
          label: input.label,
          action: toRuleAction(input.action),
          status: toRuleStatus(input.status),
          confidence: input.confidence,
          evidenceCount: input.evidenceCount,
          lastMatchedAt: input.lastMatchedAt ?? null,
        },
        update: {
          label: input.label,
          status: toRuleStatus(input.status),
          confidence: input.confidence,
          evidenceCount: input.evidenceCount,
          lastMatchedAt: input.lastMatchedAt ?? null,
        },
      });

      return { ok: true };
    }),

  /**
   * Status-Aktionen auf einem DiscoveryDocument: accept / archive / ignore /
   * mark-pending-manual. Auth-Modell: Team-Member darf lokale Uploads ändern,
   * eigene IMAP-Belege ändern. Fremde IMAP-Belege bleiben unsichtbar (siehe
   * db-reader.buildWhere) und damit auch unveränderbar.
   *
   * Zwei-Stufen-GoBD-Lifecycle:
   *   Stufe 1 (`acceptedAt`): User hat den Beleg als Geschäftsbeleg übernommen.
   *           Status wird ACCEPTED, Felder bleiben editierbar, der Beleg lebt
   *           im Archiv-Tab unter "Zur Ablage bereit".
   *   Stufe 2 (`archivedAt`): User hat "Rechtssicher archivieren" geklickt.
   *           Status wird ARCHIVED, ab jetzt greift WORM, die 10-Jahres-
   *           Aufbewahrungsfrist läuft, der Datensatz ist read-only.
   *
   * WORM-Regel: ab `archivedAt != null` sind keine Status- und Feld-Mutationen
   * mehr erlaubt. Vor archivedAt sind alle Übergänge frei (ein versehentlich
   * akzeptierter Beleg kann z.B. wieder ignoriert werden).
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
        select: {
          id: true,
          providerSource: true,
          status: true,
          acceptedAt: true,
          archivedAt: true,
        },
      });
      if (!doc) {
        throw new AppError(AppErrorCode.NOT_FOUND, {
          message: 'Dokument nicht gefunden oder nicht änderbar.',
        });
      }

      // WORM-Guard: ab archivedAt ist der Beleg rechtssicher archiviert und
      // unterliegt der 10-jährigen Aufbewahrung. Keine Status-Änderungen mehr.
      if (doc.archivedAt) {
        throw new AppError(AppErrorCode.UNAUTHORIZED, {
          message:
            'Dieses Dokument ist rechtssicher archiviert und unterliegt der ' +
            '10-jährigen Aufbewahrung (§ 147 AO / § 257 HGB). Es kann nicht ' +
            'mehr verändert werden — nur noch lesen und exportieren.',
        });
      }

      const newStatus = ACTION_STATUS_MAP[input.action];
      await prisma.$transaction(async (tx) => {
        // accept oder archive setzen acceptedAt einmalig (Stufe 1).
        // archive setzt zusätzlich archivedAt einmalig (Stufe 2 → WORM aktiv).
        // unaccept räumt acceptedAt + acceptedById wieder leer (zurück zu INBOX).
        const updateData: {
          status: typeof newStatus;
          acceptedAt?: Date | null;
          acceptedById?: number | null;
          archivedAt?: Date;
          archivedById?: number;
        } = { status: newStatus };
        const now = new Date();
        const setsAccept =
          !doc.acceptedAt && (input.action === 'accept' || input.action === 'archive');
        if (setsAccept) {
          updateData.acceptedAt = now;
          updateData.acceptedById = user.id;
        }
        const setsArchive = !doc.archivedAt && input.action === 'archive';
        if (setsArchive) {
          updateData.archivedAt = now;
          updateData.archivedById = user.id;
        }
        if (input.action === 'unaccept') {
          updateData.acceptedAt = null;
          updateData.acceptedById = null;
        }

        await tx.discoveryDocument.update({
          where: { id: doc.id },
          data: updateData,
        });

        const auditEvent = ACTION_AUDIT_MAP[input.action];

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
                acceptedSet: setsAccept,
                archivedSet: setsArchive,
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
          archivedBy: { select: { name: true } },
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
          archivedAt: doc.archivedAt,
          archivedByName: doc.archivedBy?.name ?? null,
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

      if (doc.archivedAt || doc.status === 'ARCHIVED') {
        throw new AppError(AppErrorCode.UNAUTHORIZED, {
          message:
            'Dieses Dokument ist bereits endgültig archiviert und kann nicht mehr zur Signatur vorbereitet werden.',
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
   * können. Felder bleiben editierbar bis zur Stufe-2-Archivierung
   * (`archivedAt`); danach greift WORM und der Mutator weist Edits ab.
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
          archivedAt: true,
          providerSource: true,
        },
      });
      if (!doc) {
        throw new AppError(AppErrorCode.NOT_FOUND, {
          message: 'Dokument nicht gefunden oder nicht änderbar.',
        });
      }
      if (doc.archivedAt) {
        throw new AppError(AppErrorCode.UNAUTHORIZED, {
          message:
            'Dieses Dokument ist rechtssicher archiviert und unterliegt der ' +
            '10-jährigen Aufbewahrung (§ 147 AO / § 257 HGB). Erkannte Felder ' +
            'können nach dem Archivieren nicht mehr geändert werden.',
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
          mailsTotal: true,
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
            mailsTotal: r.mailsTotal,
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
      archived: 0,
      ignored: 0,
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
    let archived = 0;
    let ignored = 0;
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
      if (d.status === 'ACCEPTED' || d.status === 'SIGNED') accepted += 1;
      if (d.status === 'ARCHIVED') archived += 1;
      if (d.status === 'IGNORED') ignored += 1;
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
      archived,
      ignored,
      needsReview,
      estimatedTotalCents,
      yearDistribution,
      rangeFrom,
      rangeTo,
      lastCompletedSyncAt: lastSync?.finishedAt ?? null,
    };
  }),

  /**
   * Vorschau für den Smart-Bulk-Accept. „Vollständig" heißt: noch nicht
   * akzeptiert (INBOX/PENDING_MANUAL), mit Anhang, mit erkanntem Betrag,
   * mit Korrespondent. Diese Kombination ist im echten Leben so robust,
   * dass die Persona auf einen Klick übernehmen kann ohne jeden Beleg
   * einzeln zu prüfen — eine massive Zeitersparnis.
   */
  getSmartAcceptCandidates: authenticatedProcedure
    .input(ZSmartAcceptCriteriaSchema)
    .output(ZSmartAcceptPreviewResponseSchema)
    .query(async ({ input, ctx }) => {
      const { teamId, user } = ctx;
      const empty = {
        totalCount: 0,
        sampleDocuments: [],
        allIds: [],
        groupedBySource: [],
      };
      if (!teamId) return empty;

      const docs = await prisma.discoveryDocument.findMany({
        where: {
          teamId,
          OR: [{ providerSource: 'local' }, { uploadedById: user.id }],
          status: { in: ['INBOX', 'PENDING_MANUAL'] },
          acceptedAt: null,
          detectedAmount: { not: null },
          correspondent: { not: null },
          archivePath: { not: null },
          artifacts: { some: { kind: 'ATTACHMENT' } },
          ...(input.sourceId ? { sourceId: input.sourceId } : {}),
        },
        orderBy: { documentDate: 'desc' },
        select: {
          id: true,
          title: true,
          correspondent: true,
          detectedAmount: true,
          documentDate: true,
          capturedAt: true,
          sourceId: true,
          source: { select: { label: true } },
        },
      });

      // Year-Filter erst nach dem DB-Read, weil documentDate fallback auf
      // capturedAt ist und Prisma kein UTC-Year-Filter über Coalesce kann.
      const filtered = input.year
        ? docs.filter((d) => {
            const dt = d.documentDate ?? d.capturedAt;
            return dt.getUTCFullYear() === input.year;
          })
        : docs;

      const sourceCounts = new Map<string, { label: string | null; count: number }>();
      for (const d of filtered) {
        const key = d.sourceId ?? '__local__';
        const entry = sourceCounts.get(key) ?? { label: d.source?.label ?? null, count: 0 };
        entry.count += 1;
        sourceCounts.set(key, entry);
      }

      return {
        totalCount: filtered.length,
        sampleDocuments: filtered.slice(0, 20).map((d) => ({
          id: d.id,
          title: d.title,
          correspondent: d.correspondent,
          detectedAmount: d.detectedAmount,
          documentDate: d.documentDate,
        })),
        allIds: filtered.map((d) => d.id),
        groupedBySource: [...sourceCounts.entries()].map(([key, v]) => ({
          sourceId: key === '__local__' ? null : key,
          sourceLabel: v.label,
          count: v.count,
        })),
      };
    }),

  /**
   * Bulk-Accept: bekommt explizite IDs vom Frontend, akzeptiert sie alle
   * unter Beibehaltung der WORM-Semantik (acceptedAt + acceptedById +
   * Audit-Log pro Beleg). Bereits akzeptierte oder nicht zugängliche IDs
   * werden in `skippedIds` zurückgegeben — Frontend kann das melden.
   *
   * Verarbeitung in Chunks à 100, damit eine einzelne Transaktion nicht
   * zu lange das Audit-Log lockt.
   */
  bulkAccept: authenticatedProcedure
    .input(ZBulkAcceptRequestSchema)
    .output(ZBulkAcceptResponseSchema)
    .mutation(async ({ input, ctx }) => {
      const { teamId, user } = ctx;
      if (!teamId) {
        throw new AppError(AppErrorCode.UNAUTHORIZED, {
          message: 'Aktion braucht einen Team-Kontext.',
        });
      }

      const eligible = await prisma.discoveryDocument.findMany({
        where: {
          id: { in: input.ids },
          teamId,
          OR: [{ providerSource: 'local' }, { uploadedById: user.id }],
          acceptedAt: null,
          status: { in: ['INBOX', 'PENDING_MANUAL'] },
        },
        select: { id: true, providerSource: true },
      });

      const eligibleIds = new Set(eligible.map((d) => d.id));
      const skippedIds = input.ids.filter((id) => !eligibleIds.has(id));

      if (eligible.length === 0) {
        return { acceptedCount: 0, skippedIds };
      }

      const now = new Date();
      const CHUNK = 100;

      for (let i = 0; i < eligible.length; i += CHUNK) {
        const chunk = eligible.slice(i, i + CHUNK);
        await prisma.$transaction(async (tx) => {
          await tx.discoveryDocument.updateMany({
            where: { id: { in: chunk.map((d) => d.id) } },
            data: {
              status: 'ACCEPTED',
              acceptedAt: now,
              acceptedById: user.id,
            },
          });

          await tx.discoveryAuditLog.createMany({
            data: chunk.map((d) => ({
              event: 'DISCOVERY_DOCUMENT_ARCHIVED' as const,
              discoveryDocumentId: d.id,
              userId: user.id,
              teamId,
              metadata: {
                action: 'bulk-smart-accept',
                providerSource: d.providerSource,
                retentionStarted: true,
              },
            })),
          });
        });
      }

      return { acceptedCount: eligible.length, skippedIds };
    }),

  /**
   * Bulk-Archive: explizite IDs aus dem Archiv-Tab endgültig rechtssicher
   * archivieren. Nur ACCEPTED-Belege ohne archivedAt sind zulässig.
   */
  bulkArchive: authenticatedProcedure
    .input(ZBulkArchiveRequestSchema)
    .output(ZBulkArchiveResponseSchema)
    .mutation(async ({ input, ctx }) => {
      const { teamId, user } = ctx;
      if (!teamId) {
        throw new AppError(AppErrorCode.UNAUTHORIZED, {
          message: 'Aktion braucht einen Team-Kontext.',
        });
      }

      const eligible = await prisma.discoveryDocument.findMany({
        where: {
          id: { in: input.ids },
          teamId,
          OR: [{ providerSource: 'local' }, { uploadedById: user.id }],
          archivedAt: null,
          status: 'ACCEPTED',
        },
        select: { id: true, providerSource: true },
      });

      const eligibleIds = new Set(eligible.map((d) => d.id));
      const skippedIds = input.ids.filter((id) => !eligibleIds.has(id));

      if (eligible.length === 0) {
        return { archivedCount: 0, skippedIds };
      }

      const now = new Date();
      const CHUNK = 100;
      for (let i = 0; i < eligible.length; i += CHUNK) {
        const chunk = eligible.slice(i, i + CHUNK);
        await prisma.$transaction(async (tx) => {
          await tx.discoveryDocument.updateMany({
            where: { id: { in: chunk.map((d) => d.id) } },
            data: {
              status: 'ARCHIVED',
              archivedAt: now,
              archivedById: user.id,
            },
          });

          await tx.discoveryAuditLog.createMany({
            data: chunk.map((d) => ({
              event: 'DISCOVERY_DOCUMENT_ARCHIVED' as const,
              discoveryDocumentId: d.id,
              userId: user.id,
              teamId,
              metadata: {
                action: 'bulk-archive',
                providerSource: d.providerSource,
                acceptedSet: false,
                archivedSet: true,
              },
            })),
          });
        });
      }

      return { archivedCount: eligible.length, skippedIds };
    }),

  /**
   * Gleiche Aktion wie bulkArchive, aber auf "alle Treffer in dieser Sicht".
   * Das Archiv-UI verwendet aktuell nur einen Textfilter, deshalb reicht hier
   * `query` statt eines komplexeren Kriterienobjekts.
   */
  bulkArchiveByFilter: authenticatedProcedure
    .input(ZBulkArchiveByFilterRequestSchema)
    .output(ZBulkArchiveResponseSchema)
    .mutation(async ({ input, ctx }) => {
      const { teamId, user } = ctx;
      if (!teamId) {
        throw new AppError(AppErrorCode.UNAUTHORIZED, {
          message: 'Aktion braucht einen Team-Kontext.',
        });
      }

      const searchFilter = buildArchiveSearchFilter(input.query);
      const eligible = await prisma.discoveryDocument.findMany({
        where: {
          teamId,
          archivedAt: null,
          status: 'ACCEPTED',
          AND: [
            { OR: [{ providerSource: 'local' }, { uploadedById: user.id }] },
            ...(searchFilter ? [{ OR: searchFilter }] : []),
          ],
        },
        select: { id: true, providerSource: true },
      });

      if (eligible.length === 0) {
        return { archivedCount: 0, skippedIds: [] };
      }

      const now = new Date();
      const CHUNK = 100;
      for (let i = 0; i < eligible.length; i += CHUNK) {
        const chunk = eligible.slice(i, i + CHUNK);
        await prisma.$transaction(async (tx) => {
          await tx.discoveryDocument.updateMany({
            where: { id: { in: chunk.map((d) => d.id) } },
            data: {
              status: 'ARCHIVED',
              archivedAt: now,
              archivedById: user.id,
            },
          });

          await tx.discoveryAuditLog.createMany({
            data: chunk.map((d) => ({
              event: 'DISCOVERY_DOCUMENT_ACCEPTED' as const,
              discoveryDocumentId: d.id,
              userId: user.id,
              teamId,
              metadata: {
                action: 'bulk-archive-filter',
                providerSource: d.providerSource,
                acceptedSet: false,
                archivedSet: true,
              },
            })),
          });
        });
      }

      return { archivedCount: eligible.length, skippedIds: [] };
    }),

  /**
   * Bulk-Ignore: explizite IDs vom Frontend, alle nicht-WORM-gesperrten werden
   * auf IGNORED gesetzt. Spiegelbild zu bulkAccept — wird vom Trefferlisten-
   * Bestätigen-Bar genutzt, der unmarkierte/abgelehnte Belege beim finalen
   * Commit zusammen verwirft.
   */
  bulkIgnore: authenticatedProcedure
    .input(ZBulkIgnoreRequestSchema)
    .output(ZBulkIgnoreResponseSchema)
    .mutation(async ({ input, ctx }) => {
      const { teamId, user } = ctx;
      if (!teamId) {
        throw new AppError(AppErrorCode.UNAUTHORIZED, {
          message: 'Aktion braucht einen Team-Kontext.',
        });
      }

      const eligible = await prisma.discoveryDocument.findMany({
        where: {
          id: { in: input.ids },
          teamId,
          OR: [{ providerSource: 'local' }, { uploadedById: user.id }],
          archivedAt: null,
          status: { in: ['INBOX', 'PENDING_MANUAL'] },
        },
        select: { id: true, providerSource: true },
      });

      const eligibleIds = new Set(eligible.map((d) => d.id));
      const skippedIds = input.ids.filter((id) => !eligibleIds.has(id));

      if (eligible.length === 0) {
        return { ignoredCount: 0, skippedIds };
      }

      const CHUNK = 100;
      for (let i = 0; i < eligible.length; i += CHUNK) {
        const chunk = eligible.slice(i, i + CHUNK);
        await prisma.$transaction(async (tx) => {
          await tx.discoveryDocument.updateMany({
            where: { id: { in: chunk.map((d) => d.id) } },
            data: { status: 'IGNORED' },
          });

          await tx.discoveryAuditLog.createMany({
            data: chunk.map((d) => ({
              event: 'DISCOVERY_DOCUMENT_IGNORED' as const,
              discoveryDocumentId: d.id,
              userId: user.id,
              teamId,
              metadata: {
                action: 'bulk-ignore',
                providerSource: d.providerSource,
              },
            })),
          });
        });
      }

      return { ignoredCount: eligible.length, skippedIds };
    }),

  /**
   * Bulk-Unaccept: ACCEPTED-Belege wieder zurück auf INBOX setzen — also
   * "aus dem Archiv entfernen". Endgültig archivierte Belege (archivedAt
   * gesetzt) sind GoBD-WORM-geschützt und werden in skippedIds zurückgegeben.
   */
  bulkUnaccept: authenticatedProcedure
    .input(ZBulkUnacceptRequestSchema)
    .output(ZBulkUnacceptResponseSchema)
    .mutation(async ({ input, ctx }) => {
      const { teamId, user } = ctx;
      if (!teamId) {
        throw new AppError(AppErrorCode.UNAUTHORIZED, {
          message: 'Aktion braucht einen Team-Kontext.',
        });
      }

      const eligible = await prisma.discoveryDocument.findMany({
        where: {
          id: { in: input.ids },
          teamId,
          OR: [{ providerSource: 'local' }, { uploadedById: user.id }],
          archivedAt: null,
          status: 'ACCEPTED',
        },
        select: { id: true, providerSource: true },
      });

      const eligibleIds = new Set(eligible.map((d) => d.id));
      const skippedIds = input.ids.filter((id) => !eligibleIds.has(id));

      if (eligible.length === 0) {
        return { unacceptedCount: 0, skippedIds };
      }

      const CHUNK = 100;
      for (let i = 0; i < eligible.length; i += CHUNK) {
        const chunk = eligible.slice(i, i + CHUNK);
        await prisma.$transaction(async (tx) => {
          await tx.discoveryDocument.updateMany({
            where: { id: { in: chunk.map((d) => d.id) } },
            data: {
              status: 'INBOX',
              acceptedAt: null,
              acceptedById: null,
            },
          });

          await tx.discoveryAuditLog.createMany({
            data: chunk.map((d) => ({
              event: 'DISCOVERY_DOCUMENT_UNACCEPTED' as const,
              discoveryDocumentId: d.id,
              userId: user.id,
              teamId,
              metadata: {
                action: 'bulk-unaccept',
                providerSource: d.providerSource,
              },
            })),
          });
        });
      }

      return { unacceptedCount: eligible.length, skippedIds };
    }),

  /**
   * Korrespondenten-Aggregat fuer den Hub: „wer hat mir Belege geschickt".
   * Gruppiert nach `correspondent`-Feld (vom Klassifikator extrahiert) und
   * zaehlt pro Eintrag, wieviele Belege mit/ohne PDF-Anhang vorliegen.
   *
   * Status-Filter: ohne IGNORED — nur was wirklich als Beleg taugt.
   * Sortierung: nach „ohne PDF" absteigend, sodass die Eintraege mit dem
   * meisten Portal-Aufwand zuerst kommen.
   */
  getCorrespondentSummary: authenticatedProcedure
    .output(ZGetCorrespondentSummaryResponseSchema)
    .query(async ({ ctx }) => {
      const { teamId, user } = ctx;
      if (!teamId) return { entries: [], totalDistinct: 0 };

      const { lookupPortalUrl } = await import('@nexasign/lib/server-only/sources/imap');

      const docs = await prisma.discoveryDocument.findMany({
        where: {
          teamId,
          OR: [{ providerSource: 'local' }, { uploadedById: user.id }],
          status: { in: ['INBOX', 'PENDING_MANUAL', 'ACCEPTED', 'ARCHIVED', 'SIGNED'] },
        },
        select: {
          correspondent: true,
          senderDomain: true,
          senderEmail: true,
          _count: { select: { artifacts: { where: { kind: 'ATTACHMENT' } } } },
        },
      });

      type Acc = {
        total: number;
        withPdf: number;
        withoutPdf: number;
        domainCounts: Map<string, number>;
        anyEmail: string | null;
      };
      const map = new Map<string, Acc>();
      for (const d of docs) {
        const key = (d.correspondent ?? '').trim() || '(ohne Absender-Erkennung)';
        const has = d._count.artifacts > 0;
        const e: Acc = map.get(key) ?? {
          total: 0,
          withPdf: 0,
          withoutPdf: 0,
          domainCounts: new Map(),
          anyEmail: null,
        };
        e.total += 1;
        if (has) e.withPdf += 1;
        else e.withoutPdf += 1;
        if (d.senderDomain) {
          e.domainCounts.set(
            d.senderDomain.toLowerCase(),
            (e.domainCounts.get(d.senderDomain.toLowerCase()) ?? 0) + 1,
          );
        }
        if (!e.anyEmail && d.senderEmail) e.anyEmail = d.senderEmail;
        map.set(key, e);
      }

      // Sortierung: zuerst nach „ohne PDF" (= meiste Portal-Arbeit), dann
      // nach total. Ergebnis-Cap auf 50, weil >50 fuer eine UI-Tabelle nicht
      // mehr scannbar ist; der User kann ueber die Trefferliste nachsuchen.
      const entries = [...map.entries()]
        .map(([correspondent, v]) => {
          // Haeufigste Domain in der Gruppe gewinnt — falls die Gruppe Mails
          // von mehreren Domains hat (selten, aber moeglich bei Klassifikator-
          // Heuristik-Variabilitaet).
          let topDomain: string | null = null;
          let topCount = 0;
          for (const [dom, n] of v.domainCounts) {
            if (n > topCount) {
              topCount = n;
              topDomain = dom;
            }
          }
          const portal = topDomain ? lookupPortalUrl(topDomain) : null;
          return {
            correspondent,
            senderDomain: topDomain,
            senderEmail: v.anyEmail,
            portalUrl: portal?.url ?? null,
            portalLabel: portal?.label ?? null,
            total: v.total,
            withPdf: v.withPdf,
            withoutPdf: v.withoutPdf,
          };
        })
        .sort((a, b) => b.withoutPdf - a.withoutPdf || b.total - a.total)
        .slice(0, 50);

      return { entries, totalDistinct: map.size };
    }),
});
