// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 NexaStack, NexaSign contributors
import { z } from 'zod';

export const ZDiscoveryDocumentStatusSchema = z.enum([
  'inbox',
  'pending-manual',
  'accepted',
  'archived',
  'ignored',
  'processed',
]);

// Filter-Wert für die Listenansicht. „all" zeigt alle Belege unabhängig vom
// Status — Hauptzweck: Überblick „welche Mail mit welcher Rechnung wann".
// Der DB-Filter ignoriert dann die status-Spalte komplett.
export const ZDiscoveryListFilterSchema = z.union([
  z.literal('all'),
  ZDiscoveryDocumentStatusSchema,
]);

export const ZDiscoveryQualityFilterSchema = z.enum([
  'needs-review',
  'downloadable',
  'missing-amount',
  'missing-invoice-number',
]);

export const ZDiscoveryDocumentSchema = z.object({
  id: z.string(),
  nativeId: z.string(),
  title: z.string(),
  correspondent: z.string().nullable(),
  documentType: z.string().nullable(),
  tags: z.array(z.string()),
  documentDate: z.coerce.date().nullable(),
  capturedAt: z.coerce.date(),
  status: ZDiscoveryDocumentStatusSchema,
  // Optional in Listenansicht (vor allem akzeptierte Belege).
  detectedAmount: z.string().nullable().optional(),
  detectedInvoiceNumber: z.string().nullable().optional(),
  acceptedAt: z.coerce.date().nullable().optional(),
  acceptedByName: z.string().nullable().optional(),
  // Anzahl ATTACHMENT-Artifacts mit nicht-leerem archivePath. Wenn 0 → Mail
  // hat keine herunterladbaren Anhänge (entweder MANUAL ohne PDF, oder vor-
  // Archive-Sync-Datensatz). Wird im Listen-Loader vorberechnet.
  attachmentCount: z.number().int().nonnegative(),
  hasArchive: z.boolean(),
  signingEnvelopeId: z.string().nullable().optional(),
  canCreateSigningDocument: z.boolean().optional(),
  // Quelle, aus der der Beleg stammt — Persona mit mehreren Postfächern
  // (privat + business) muss in der Liste sehen, woher ein Beleg kommt.
  // null bei lokalen Uploads (providerSource = 'local').
  sourceLabel: z.string().nullable().optional(),
});

export const ZSourceKindSchema = z.enum(['IMAP']);

export const ZSourceSyncStatusSchema = z.enum(['PENDING', 'SUCCESS', 'FAILED', 'SUSPENDED']);

export const ZSourceSummarySchema = z.object({
  id: z.string(),
  kind: ZSourceKindSchema,
  label: z.string(),
  lastSyncAt: z.coerce.date().nullable(),
  lastSyncStatus: ZSourceSyncStatusSchema.nullable(),
  // rangeTo des letzten erfolgreichen SyncRun. Frontend nutzt das als
  // inkrementelles Default für `fromDate` — neuer Lauf zieht „seit zuletzt".
  // null = noch nie erfolgreich gelaufen → Onboarding-Pfad.
  lastSuccessfulSyncRangeTo: z.coerce.date().nullable(),
});

export const ZDiscoverySummarySchema = z.object({
  total: z.number().int().nonnegative(),
  accepted: z.number().int().nonnegative(),
  needsReview: z.number().int().nonnegative(),
  downloadable: z.number().int().nonnegative(),
  missingAmount: z.number().int().nonnegative(),
  missingInvoiceNumber: z.number().int().nonnegative(),
  months: z.array(
    z.object({
      key: z.string(),
      count: z.number().int().nonnegative(),
    }),
  ),
});

export const ZFindDiscoveryDocumentsRequestSchema = z.object({
  query: z.string().trim().optional(),
  // status entweder ein konkreter Status oder "all" für alle.
  status: ZDiscoveryListFilterSchema.optional(),
  qualityFilter: ZDiscoveryQualityFilterSchema.optional(),
  correspondent: z.string().trim().optional(),
  documentDateFrom: z.coerce.date().optional(),
  documentDateTo: z.coerce.date().optional(),
  cursor: z.string().nullable().optional(),
});

export const ZFindDiscoveryDocumentsResponseSchema = z.object({
  documents: z.array(ZDiscoveryDocumentSchema),
  total: z.number().int().nonnegative(),
  nextCursor: z.string().nullable(),
  configured: z.boolean(),
  hasAnySource: z.boolean(),
  sources: z.array(ZSourceSummarySchema),
  summary: ZDiscoverySummarySchema.nullable().optional(),
  focusSummary: ZDiscoverySummarySchema.nullable().optional(),
});

export const ZGetDiscoveryDocumentRequestSchema = z.object({
  id: z.string(),
});

export const ZGetDiscoveryDocumentResponseSchema = ZDiscoveryDocumentSchema.nullable();

export const ZDiscoveryDocumentActionSchema = z.enum([
  'accept',
  'mark-pending-manual',
  'archive',
  'ignore',
]);

export const ZUpdateDiscoveryDocumentStatusRequestSchema = z.object({
  id: z.string(),
  action: ZDiscoveryDocumentActionSchema,
});

export const ZUpdateDiscoveryDocumentStatusResponseSchema = z.object({
  ok: z.boolean(),
});

/**
 * Manuelles Korrigieren der vom Klassifikator erkannten Felder. Heuristik
 * trifft nicht jeden Fall (Brutto vs. Netto, mehrwertige Rechnungs-Nr.,
 * abgekürzte Korrespondenten). Nach `acceptedAt` greift WORM und Edits
 * werden serverseitig abgewiesen — das ist die GoBD-Garantie für die
 * abgeschlossene Buchhaltung.
 *
 * Felder als optional: leerer String → null (Feld zurücksetzen). Nicht
 * gesetzte Schlüssel → unverändert.
 */
export const ZUpdateDetectedFieldsRequestSchema = z.object({
  id: z.string(),
  detectedAmount: z.string().trim().max(64).nullable().optional(),
  detectedInvoiceNumber: z.string().trim().max(64).nullable().optional(),
  correspondent: z.string().trim().max(255).nullable().optional(),
});

export const ZUpdateDetectedFieldsResponseSchema = z.object({
  ok: z.boolean(),
  detectedAmount: z.string().nullable(),
  detectedInvoiceNumber: z.string().nullable(),
  correspondent: z.string().nullable(),
});

export type TUpdateDetectedFieldsRequest = z.infer<typeof ZUpdateDetectedFieldsRequestSchema>;
export type TUpdateDetectedFieldsResponse = z.infer<typeof ZUpdateDetectedFieldsResponseSchema>;

export const ZDiscoveryArtifactKindSchema = z.enum([
  'MAIL_EML',
  'MAIL_BODY_TEXT',
  'MAIL_BODY_HTML',
  'MAIL_METADATA',
  'ATTACHMENT',
]);

export const ZDiscoveryArtifactSchema = z.object({
  id: z.string(),
  kind: ZDiscoveryArtifactKindSchema,
  fileName: z.string(),
  contentType: z.string(),
  fileSize: z.number().int().nonnegative(),
  sha256: z.string().length(64),
  relativePath: z.string(),
});

export const ZGetDocumentDetailRequestSchema = z.object({
  id: z.string(),
});

export const ZGetDocumentDetailResponseSchema = z
  .object({
    document: ZDiscoveryDocumentSchema.extend({
      bodyText: z.string().nullable(),
      bodyHasHtml: z.boolean(),
      archivePath: z.string().nullable(),
      detectedAmount: z.string().nullable(),
      detectedInvoiceNumber: z.string().nullable(),
      portalHint: z.string().nullable(),
      // Wenn der Beleg-Sender eine bekannte Anbieter-Domain hat, liefert das
      // Backend zusätzlich URL + Label des Kunden-Portals. Frontend rendert
      // das als anklickbaren Link, sodass Persona „im Portal nachziehen"
      // direkt zum Login springt statt googelt.
      portalUrl: z.string().url().nullable(),
      portalUrlLabel: z.string().nullable(),
      messageIdHash: z.string().nullable(),
      providerSource: z.string(),
      providerNativeId: z.string().nullable(),
      acceptedAt: z.coerce.date().nullable(),
      acceptedByName: z.string().nullable(),
      sourceLabel: z.string().nullable(),
      signingEnvelopeId: z.string().nullable(),
      canCreateSigningDocument: z.boolean(),
    }),
    artifacts: z.array(ZDiscoveryArtifactSchema),
    /** Absoluter Pfad auf dem Server zum Mail-Ordner (für FTP/SCP-Hinweis). */
    absoluteArchivePath: z.string().nullable(),
    /** Deep-Link zur Mail in Gmail, falls messageId vorhanden und Provider Gmail. */
    gmailDeepLink: z.string().nullable(),
  })
  .nullable();

export type TDiscoveryDocument = z.infer<typeof ZDiscoveryDocumentSchema>;
export type TSourceSummary = z.infer<typeof ZSourceSummarySchema>;
export type TDiscoverySummary = z.infer<typeof ZDiscoverySummarySchema>;
export type TDiscoveryDocumentAction = z.infer<typeof ZDiscoveryDocumentActionSchema>;
export type TDiscoveryArtifact = z.infer<typeof ZDiscoveryArtifactSchema>;
export type TGetDocumentDetailResponse = z.infer<typeof ZGetDocumentDetailResponseSchema>;

export type TFindDiscoveryDocumentsRequest = z.infer<typeof ZFindDiscoveryDocumentsRequestSchema>;
export type TFindDiscoveryDocumentsResponse = z.infer<typeof ZFindDiscoveryDocumentsResponseSchema>;
export type TGetDiscoveryDocumentRequest = z.infer<typeof ZGetDiscoveryDocumentRequestSchema>;
export type TGetDiscoveryDocumentResponse = z.infer<typeof ZGetDiscoveryDocumentResponseSchema>;

// Re-Sync einer einzelnen Mail aus IMAP — laedt Archive nach fuer Belege,
// die vor Aktivierung des Archive-Features importiert wurden.
export const ZResyncSingleDocumentRequestSchema = z.object({
  id: z.string(),
});

export const ZResyncSingleDocumentResponseSchema = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    archivePath: z.string(),
    attachmentsAdded: z.number().int().nonnegative(),
    alreadyHadArchive: z.boolean(),
  }),
  z.object({
    ok: z.literal(false),
    reason: z.string(),
  }),
]);

export type TResyncSingleDocumentRequest = z.infer<typeof ZResyncSingleDocumentRequestSchema>;
export type TResyncSingleDocumentResponse = z.infer<typeof ZResyncSingleDocumentResponseSchema>;

/**
 * Aktive Sync-Runs für die Hauptseite — schmaler Endpoint, der genau das
 * liefert, was der Inline-Status-Banner anzeigt: pro Quelle die laufenden/
 * pendenten Läufe mit ihrem Fortschritts-Counter. Wird im Frontend mit kurzem
 * `refetchInterval` (3s) gepollt, solange Einträge zurückkommen — sobald die
 * Liste leer ist, stoppt das Polling. Damit pollt die Persona auch nicht
 * dauerhaft den teuren `findDocuments`-Reader, sondern nur diesen kleinen Read.
 */
export const ZActiveSyncRunSchema = z.object({
  id: z.string(),
  sourceId: z.string(),
  sourceLabel: z.string(),
  status: z.enum(['PENDING', 'RUNNING']),
  rangeFrom: z.coerce.date(),
  rangeTo: z.coerce.date(),
  mailsChecked: z.number().int().nonnegative(),
  documentsAuto: z.number().int().nonnegative(),
  documentsManual: z.number().int().nonnegative(),
  startedAt: z.coerce.date(),
});

export const ZGetActiveSyncRunsResponseSchema = z.array(ZActiveSyncRunSchema);

export type TActiveSyncRun = z.infer<typeof ZActiveSyncRunSchema>;

/**
 * Aggregat-Endpoint für die „Wow-Card" oben auf der Find-Documents-Seite.
 *
 * Liefert eine Übersicht über alle Belege im Team — keine Pagination, kein
 * Status-Filter — damit die Persona auf einen Blick sieht: „so viele Belege,
 * so viel Geld, verteilt über diese Jahre". Beträge werden serverseitig aus
 * den `detectedAmount`-Strings geparst (ein und dieselbe Logik wie der
 * IMAP-Classifier sie geschrieben hat) und in Cent zurückgegeben — die UI
 * formatiert lokal-spezifisch.
 *
 * Zähler ohne Status-Filter (also auch akzeptierte und archivierte Belege),
 * weil es das „dein gesamtes Datenarchiv"-Bild ist, nicht ein Inbox-Bild.
 */
export const ZGetOverviewResponseSchema = z.object({
  total: z.number().int().nonnegative(),
  withAmount: z.number().int().nonnegative(),
  downloadable: z.number().int().nonnegative(),
  accepted: z.number().int().nonnegative(),
  needsReview: z.number().int().nonnegative(),
  /** Summe der erkannten Brutto-Beträge in Cent (EUR-äquivalent, nicht währungs-konvertiert). */
  estimatedTotalCents: z.number().int().nonnegative(),
  /** Aufschlüsselung pro Kalenderjahr, sortiert absteigend (neuestes zuerst). */
  yearDistribution: z.array(
    z.object({
      year: z.number().int(),
      count: z.number().int().nonnegative(),
    }),
  ),
  /** Frühestes/spätestes documentDate über alle Belege; null wenn keine Belege. */
  rangeFrom: z.coerce.date().nullable(),
  rangeTo: z.coerce.date().nullable(),
  /** Datum/Zeit des letzten erfolgreichen Sync über alle Sources. */
  lastCompletedSyncAt: z.coerce.date().nullable(),
});

export type TGetOverviewResponse = z.infer<typeof ZGetOverviewResponseSchema>;

export const ZCreateSigningDocumentRequestSchema = z.object({
  id: z.string(),
});

export const ZCreateSigningDocumentResponseSchema = z.object({
  envelopeId: z.string(),
  alreadyExisted: z.boolean(),
});

export type TCreateSigningDocumentRequest = z.infer<typeof ZCreateSigningDocumentRequestSchema>;
export type TCreateSigningDocumentResponse = z.infer<typeof ZCreateSigningDocumentResponseSchema>;
