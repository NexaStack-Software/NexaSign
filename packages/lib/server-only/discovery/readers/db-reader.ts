// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 NexaStack, NexaSign contributors
import type {
  Prisma,
  DiscoveryDocumentStatus as PrismaDiscoveryDocumentStatus,
} from '@prisma/client';

import { AppError, AppErrorCode } from '@nexasign/lib/errors/app-error';
import { prisma } from '@nexasign/prisma';

import type {
  DiscoveryConfidenceLabel,
  DiscoveryContext,
  DiscoveryDocument,
  DiscoveryDocumentStatus,
  DiscoveryFilter,
  DiscoveryPage,
  DiscoveryReader,
  DiscoverySummary,
} from '../types';

/**
 * DB-Reader — Default-Reader, liest aus der `DiscoveryDocument`-Tabelle.
 *
 * Source-Adapter (IMAP, später Cloud) und der manuelle Intake-Upload schreiben
 * dort hinein; dieser Reader liest nur, kein Schreib-Pfad.
 *
 * Mehrtenant: jedes Dokument ist team-gebunden. Für IMAP-importierte Dokumente
 * gilt zusätzlich `uploadedById === ctx.userId` — User A sieht User Bs Belege
 * im selben Team nicht.
 */

const PAGE_SIZE = 25;

const NATIVE_TO_UI_STATUS: Record<string, DiscoveryDocumentStatus> = {
  INBOX: 'inbox',
  PENDING_MANUAL: 'pending-manual',
  ACCEPTED: 'accepted',
  SIGNED: 'accepted', // signed ist eine Spezialform von akzeptiert
  ARCHIVED: 'archived',
  IGNORED: 'ignored',
};

const UI_TO_NATIVE_STATUS: Record<DiscoveryDocumentStatus, PrismaDiscoveryDocumentStatus[]> = {
  inbox: ['INBOX'],
  'pending-manual': ['PENDING_MANUAL'],
  accepted: ['ACCEPTED', 'SIGNED'],
  archived: ['ARCHIVED'],
  ignored: ['IGNORED'],
  processed: ['ACCEPTED', 'SIGNED', 'ARCHIVED', 'IGNORED'],
};

const requireTeam = (ctx: DiscoveryContext | undefined): number => {
  if (!ctx?.teamId) {
    throw new AppError(AppErrorCode.UNAUTHORIZED, {
      message: 'Discovery braucht einen Team-Kontext.',
    });
  }
  return ctx.teamId;
};

type DbDiscoveryDocument = {
  id: string;
  title: string;
  correspondent: string | null;
  documentType: string | null;
  documentDate: Date | null;
  capturedAt: Date;
  status: PrismaDiscoveryDocumentStatus;
  contentType: string | null;
  tags: string[];
  detectedAmount: string | null;
  detectedInvoiceNumber: string | null;
  senderDomain: string | null;
  acceptedAt: Date | null;
  acceptedBy: { name: string | null } | null;
  archivedAt: Date | null;
  archivedBy: { name: string | null } | null;
  archivePath: string | null;
  dataId: string | null;
  signingEnvelopeId: string | null;
  source: { label: string } | null;
  // `artifacts` wird mit Filter `kind = 'ATTACHMENT'` geladen — Anzahl ist
  // die echte Anhang-Zahl. `_count.artifacts` ist der ungefilterte Gesamt-
  // Count (inkl. EML/BODY/METADATA), nur für hasArchive: „Mail überhaupt
  // im Archiv?" — wenn 0, dann gibt es nicht mal die Standard-Artifacts.
  artifacts: { id: string }[];
  _count: { artifacts: number };
};

type QualitySignals = {
  confidence: number;
  confidenceLabel: DiscoveryConfidenceLabel;
  confidenceReasons: string[];
  riskFlags: string[];
  duplicateGroupKey: string | null;
};

type DuplicateKeySource = {
  detectedInvoiceNumber: string | null;
  senderDomain: string | null;
  correspondent: string | null;
};

const intersectStatus = (
  left: PrismaDiscoveryDocumentStatus[] | undefined,
  right: PrismaDiscoveryDocumentStatus[],
): PrismaDiscoveryDocumentStatus[] => {
  if (!left) return right;
  return left.filter((status) => right.includes(status));
};

const setStatusWhere = (
  where: Prisma.DiscoveryDocumentWhereInput,
  statuses: PrismaDiscoveryDocumentStatus[],
) => {
  const current =
    typeof where.status === 'object' && 'in' in where.status && Array.isArray(where.status.in)
      ? where.status.in
      : undefined;
  where.status = { in: intersectStatus(current, statuses) };
};

const appendAnd = (
  where: Prisma.DiscoveryDocumentWhereInput,
  condition: Prisma.DiscoveryDocumentWhereInput,
) => {
  const current = Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : [];
  where.AND = [...current, condition];
};

const toDiscoveryDocument = (doc: DbDiscoveryDocument): DiscoveryDocument => {
  // attachmentCount kommt jetzt aus einer dedizierten Relation-Selection mit
  // `where: { kind: 'ATTACHMENT' }`, kein `_count - 3`-Hack mehr. Damit ist
  // die Anzeige robust gegenüber Belegen, die weniger als 3 Standard-
  // Artifacts haben (z. B. ältere Sync-Stände ohne BODY_TEXT/METADATA).
  const attachmentCount = doc.artifacts.length;
  const hasArchive = doc.archivePath !== null && doc.archivePath !== '' && doc._count.artifacts > 0;
  const quality = buildQualitySignals(doc, attachmentCount, hasArchive);

  return {
    id: doc.id,
    nativeId: doc.id,
    title: doc.title,
    correspondent: doc.correspondent,
    documentType: doc.documentType,
    tags: doc.tags,
    documentDate: doc.documentDate,
    capturedAt: doc.capturedAt,
    status: NATIVE_TO_UI_STATUS[doc.status] ?? 'inbox',
    detectedAmount: doc.detectedAmount,
    detectedInvoiceNumber: doc.detectedInvoiceNumber,
    confidence: quality.confidence,
    confidenceLabel: quality.confidenceLabel,
    confidenceReasons: quality.confidenceReasons,
    riskFlags: quality.riskFlags,
    duplicateCount: 0,
    duplicateGroupKey: quality.duplicateGroupKey,
    acceptedAt: doc.acceptedAt,
    acceptedByName: doc.acceptedBy?.name ?? null,
    archivedAt: doc.archivedAt,
    archivedByName: doc.archivedBy?.name ?? null,
    attachmentCount,
    hasArchive,
    signingEnvelopeId: doc.signingEnvelopeId,
    canCreateSigningDocument: doc.dataId !== null || hasArchive,
    sourceLabel: doc.source?.label ?? null,
  };
};

const clampConfidence = (value: number): number => Math.max(5, Math.min(99, value));

const confidenceLabel = (confidence: number): DiscoveryConfidenceLabel => {
  if (confidence >= 82) return 'high';
  if (confidence >= 55) return 'medium';
  return 'low';
};

const normalizeDuplicatePart = (value: string | null | undefined): string =>
  (value ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const duplicateGroupKeyFor = (doc: DuplicateKeySource): string | null => {
  const invoice = normalizeDuplicatePart(doc.detectedInvoiceNumber);
  if (!invoice) return null;
  const sender =
    normalizeDuplicatePart(doc.senderDomain) || normalizeDuplicatePart(doc.correspondent);
  if (!sender) return `invoice:${invoice}`;
  return `invoice:${sender}:${invoice}`;
};

const buildQualitySignals = (
  doc: DbDiscoveryDocument,
  attachmentCount: number,
  hasArchive: boolean,
): QualitySignals => {
  const reasons: string[] = [];
  const risks: string[] = [];
  let score = 35;

  if (attachmentCount > 0) {
    score += 24;
    reasons.push(
      attachmentCount === 1 ? 'PDF/Anhang vorhanden' : `${attachmentCount} Anhänge vorhanden`,
    );
  } else {
    score -= 18;
    risks.push('Kein herunterladbarer Anhang');
  }

  if (doc.detectedAmount) {
    score += 18;
    reasons.push(`Betrag erkannt: ${doc.detectedAmount}`);
  } else {
    score -= 10;
    risks.push('Kein Betrag erkannt');
  }

  if (doc.detectedInvoiceNumber) {
    score += 13;
    reasons.push(`Rechnungsnummer erkannt: ${doc.detectedInvoiceNumber}`);
  } else {
    risks.push('Keine Rechnungsnummer erkannt');
  }

  if (doc.correspondent) {
    score += 6;
    reasons.push(`Absender/Aussteller: ${doc.correspondent}`);
  }

  if (doc.senderDomain) {
    score += 4;
  }

  if (hasArchive) {
    score += 4;
  }

  if (doc.status === 'PENDING_MANUAL') {
    score -= 8;
    risks.push('Beleg muss wahrscheinlich im Portal nachgezogen werden');
  }

  const title = doc.title.toLowerCase();
  if (title.startsWith('re:') || title.startsWith('aw:') || title.startsWith('fwd:')) {
    score -= 18;
    risks.push('Antwort oder Weiterleitung');
  }

  const confidence = clampConfidence(score);
  return {
    confidence,
    confidenceLabel: confidenceLabel(confidence),
    confidenceReasons: reasons.slice(0, 3),
    riskFlags: risks.slice(0, 3),
    duplicateGroupKey: duplicateGroupKeyFor(doc),
  };
};

const attachDuplicateCounts = async (
  documents: DiscoveryDocument[],
  where: Prisma.DiscoveryDocumentWhereInput,
): Promise<DiscoveryDocument[]> => {
  const invoiceNumbers = [
    ...new Set(
      documents
        .map((doc) => doc.detectedInvoiceNumber?.trim())
        .filter((value): value is string => Boolean(value)),
    ),
  ];

  if (invoiceNumbers.length === 0) {
    return documents;
  }

  const candidates = await prisma.discoveryDocument.findMany({
    where: {
      AND: [where, { detectedInvoiceNumber: { in: invoiceNumbers } }],
    },
    select: {
      id: true,
      detectedInvoiceNumber: true,
      senderDomain: true,
      correspondent: true,
    },
  });

  const counts = new Map<string, number>();
  for (const candidate of candidates) {
    const key = duplicateGroupKeyFor(candidate);
    if (!key) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return documents.map((doc) => ({
    ...doc,
    duplicateCount: doc.duplicateGroupKey ? (counts.get(doc.duplicateGroupKey) ?? 1) - 1 : 0,
  }));
};

const getSummaryMonthKey = (doc: { documentDate: Date | null; capturedAt: Date }): string => {
  const date = doc.documentDate ?? doc.capturedAt;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
};

const buildWhere = (
  teamId: number,
  userId: number | undefined,
  filter: DiscoveryFilter,
): Prisma.DiscoveryDocumentWhereInput => {
  const where: Prisma.DiscoveryDocumentWhereInput = { teamId };

  // Multi-User-Isolation: Belege aus IMAP-Quellen sind privat — nur ihr Owner
  // sieht sie. Lokale Uploads (providerSource = 'local') bleiben Team-sichtbar.
  if (userId !== undefined) {
    where.OR = [{ providerSource: 'local' }, { uploadedById: userId }];
  }

  // 'all' überspringt den Status-Filter — Hauptanwendungsfall „Überblick".
  if (filter.status && filter.status !== 'all') {
    setStatusWhere(where, UI_TO_NATIVE_STATUS[filter.status]);
  }

  if (filter.query) {
    const text = filter.query;
    const textFilter = [
      { title: { contains: text, mode: 'insensitive' as const } },
      { correspondent: { contains: text, mode: 'insensitive' as const } },
      { detectedInvoiceNumber: { contains: text, mode: 'insensitive' as const } },
    ];
    appendAnd(where, { OR: textFilter });
  }

  if (filter.correspondent) {
    where.correspondent = { contains: filter.correspondent, mode: 'insensitive' };
  }

  if (filter.documentDateFrom || filter.documentDateTo) {
    where.documentDate = {
      gte: filter.documentDateFrom,
      lt: filter.documentDateTo,
    };
  }

  if (filter.qualityFilter === 'needs-review') {
    setStatusWhere(where, ['INBOX', 'PENDING_MANUAL']);
  }

  if (filter.qualityFilter === 'downloadable') {
    appendAnd(where, {
      archivePath: { not: null },
      artifacts: { some: { kind: 'ATTACHMENT' } },
    });
  }

  if (filter.qualityFilter === 'missing-amount') {
    where.detectedAmount = null;
  }

  if (filter.qualityFilter === 'missing-invoice-number') {
    where.detectedInvoiceNumber = null;
  }

  return where;
};

export const dbDiscoveryReader: DiscoveryReader = {
  id: 'db',

  async findDocuments(
    filter: DiscoveryFilter,
    cursor?: string | null,
    ctx?: DiscoveryContext,
  ): Promise<DiscoveryPage> {
    const teamId = requireTeam(ctx);
    const where = buildWhere(teamId, ctx?.userId, filter);

    const [total, results] = await Promise.all([
      prisma.discoveryDocument.count({ where }),
      prisma.discoveryDocument.findMany({
        where,
        // Dokumentdatum vor capturedAt — User will chronologische Sicht über
        // den Belegzeitraum, nicht über den Sync-Zeitpunkt.
        orderBy: [{ documentDate: 'desc' }, { capturedAt: 'desc' }],
        take: PAGE_SIZE + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        include: {
          acceptedBy: { select: { name: true } },
          archivedBy: { select: { name: true } },
          source: { select: { label: true } },
          // attachmentCount: dedizierter Filter auf kind=ATTACHMENT. Kostet
          // pro Page (PAGE_SIZE=25) eine extra Sub-Query, ist aber durch den
          // Foreign-Key-Index auf DiscoveryArtifact.discoveryDocumentId
          // gedeckt. hasArchive: braucht weiterhin den Gesamt-Count.
          artifacts: {
            where: { kind: 'ATTACHMENT' },
            select: { id: true },
          },
          _count: { select: { artifacts: true } },
        },
      }),
    ]);

    const hasMore = results.length > PAGE_SIZE;
    const slice = hasMore ? results.slice(0, PAGE_SIZE) : results;

    return {
      documents: await attachDuplicateCounts(slice.map(toDiscoveryDocument), where),
      total,
      nextCursor: hasMore ? slice[slice.length - 1].id : null,
    };
  },

  async summarizeDocuments(
    filter: DiscoveryFilter,
    ctx?: DiscoveryContext,
  ): Promise<DiscoverySummary> {
    const teamId = requireTeam(ctx);
    const where = buildWhere(teamId, ctx?.userId, filter);

    const docs = await prisma.discoveryDocument.findMany({
      where,
      select: {
        status: true,
        documentDate: true,
        capturedAt: true,
        detectedAmount: true,
        detectedInvoiceNumber: true,
        senderDomain: true,
        archivePath: true,
        artifacts: {
          where: { kind: 'ATTACHMENT' },
          select: { id: true },
        },
      },
    });

    const months = new Map<string, number>();
    let accepted = 0;
    let archived = 0;
    let ignored = 0;
    let needsReview = 0;
    let downloadable = 0;
    let missingAmount = 0;
    let missingInvoiceNumber = 0;

    docs.forEach((doc) => {
      const monthKey = getSummaryMonthKey(doc);
      months.set(monthKey, (months.get(monthKey) ?? 0) + 1);

      if (doc.status === 'ACCEPTED' || doc.status === 'SIGNED' || doc.status === 'ARCHIVED') {
        accepted += 1;
      }
      if (doc.status === 'ARCHIVED') {
        archived += 1;
      }
      if (doc.status === 'IGNORED') {
        ignored += 1;
      }
      if (doc.status === 'INBOX' || doc.status === 'PENDING_MANUAL') {
        needsReview += 1;
      }
      if (doc.archivePath && doc.artifacts.length > 0) {
        downloadable += 1;
      }
      if (!doc.detectedAmount) {
        missingAmount += 1;
      }
      if (!doc.detectedInvoiceNumber) {
        missingInvoiceNumber += 1;
      }
    });

    return {
      total: docs.length,
      accepted,
      archived,
      ignored,
      needsReview,
      downloadable,
      missingAmount,
      missingInvoiceNumber,
      months: Array.from(months.entries())
        .sort(([a], [b]) => b.localeCompare(a))
        .map(([key, count]) => ({ key, count })),
    };
  },

  async getDocument(id: string, ctx?: DiscoveryContext): Promise<DiscoveryDocument | null> {
    const teamId = requireTeam(ctx);
    const where = buildWhere(teamId, ctx?.userId, {});
    const doc = await prisma.discoveryDocument.findFirst({
      where: { ...where, id },
      include: {
        acceptedBy: { select: { name: true } },
        archivedBy: { select: { name: true } },
        source: { select: { label: true } },
        artifacts: {
          where: { kind: 'ATTACHMENT' },
          select: { id: true },
        },
        _count: { select: { artifacts: true } },
      },
    });
    return doc ? toDiscoveryDocument(doc) : null;
  },

  async getDocumentContent(id: string, ctx?: DiscoveryContext): Promise<Uint8Array | null> {
    const teamId = requireTeam(ctx);
    const where = buildWhere(teamId, ctx?.userId, {});
    const doc = await prisma.discoveryDocument.findFirst({
      where: { ...where, id },
      include: { data: true },
    });
    if (!doc) return null;
    if (!doc.data) return null;

    // Speicher-Provider abstrahiert Binär-Inhalte als String (Base64 oder S3-Key).
    // Tatsächliches Streaming bleibt dem Storage-Layer überlassen.
    if (doc.data.type === 'BYTES_64') {
      const { base64 } = await import('@scure/base');
      return base64.decode(doc.data.data);
    }

    // S3_PATH: hier müsste der Storage-Provider den Stream liefern.
    // Für V1 kein direktes Bytes-Lesen aus S3 vom Reader aus.
    return null;
  },
};
