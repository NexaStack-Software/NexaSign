// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 NexaStack, NexaSign contributors

/**
 * Discovery-Schicht: Datenstrukturen für „Dokumente finden".
 *
 * Diese Typen sind backend-agnostisch. Ein Reader übersetzt zwischen seinem
 * nativen Datenmodell und diesen Typen, damit das UI den Reader nicht kennt.
 *
 * Discovery ist nur Lesen. Schreiben (Source-Sync, Upload) lebt in
 * `packages/lib/server-only/sources/` und `packages/lib/server-only/intake/`.
 */

export type DiscoveryDocumentStatus =
  | 'inbox' // Neu eingegangen, noch nicht gesichtet
  | 'pending-manual' // Hinweis erkannt, Beleg muss manuell beschafft werden
  | 'accepted' // Stufe 1: User hat als Geschäftsbeleg übernommen ("Zur Ablage bereit"). Editierbar, kein WORM.
  | 'archived' // Stufe 2: User hat rechtssicher archiviert (archivedAt gesetzt → WORM aktiv, GoBD-Frist läuft)
  | 'ignored' // User hat als irrelevant markiert
  | 'processed'; // Sammel-Filter: accepted ∪ archived ∪ ignored ∪ signed

export type DiscoveryConfidenceLabel = 'high' | 'medium' | 'low';

export type DiscoveryDocument = {
  /** Stabile, readerunabhängige ID */
  id: string;
  /** Reader-interne ID, falls für Detail-Aufrufe nötig */
  nativeId: string;
  /** Anzeigentitel des Dokuments */
  title: string;
  /** Korrespondent/Aussteller, falls erkannt */
  correspondent: string | null;
  /** Inhaltlicher Typ (z.B. „Rechnung", „Vertrag") */
  documentType: string | null;
  /** Tags vom Backend */
  tags: string[];
  /** Datum, das auf dem Dokument selbst steht (Belegdatum), falls erkannt */
  documentDate: Date | null;
  /** Wann es im Discovery-Backend aufgetaucht ist */
  capturedAt: Date;
  /** Lifecycle-Status aus Sicht des NexaFile-Nutzers */
  status: DiscoveryDocumentStatus;
  /** Optional in Listenansicht (vor allem bei akzeptierten Belegen). */
  detectedAmount?: string | null;
  detectedInvoiceNumber?: string | null;
  /** Erklärbare Trefferqualität für Review-UX und spätere Automationsregeln. */
  confidence?: number;
  confidenceLabel?: DiscoveryConfidenceLabel;
  confidenceReasons?: string[];
  riskFlags?: string[];
  duplicateCount?: number;
  duplicateGroupKey?: string | null;
  acceptedAt?: Date | null;
  acceptedByName?: string | null;
  /** Stufe-2-Trigger (Rechtssicher archiviert / WORM-Lock). */
  archivedAt?: Date | null;
  archivedByName?: string | null;
  /**
   * Anzahl ATTACHMENT-Artifacts mit nicht-leerem archivePath. 0 = nichts
   * herunterladbar (entweder MANUAL ohne PDF oder vor-Archive-Sync-Datensatz).
   */
  attachmentCount: number;
  /**
   * Hat das Document einen archivePath gesetzt UND mind. ein Artifact?
   * Convenience-Flag fuer UI: Download-Button enable/disable.
   */
  hasArchive: boolean;
  /** Vorbereitetes Signatur-Dokument aus Schritt 3, falls bereits erzeugt. */
  signingEnvelopeId?: string | null;
  /** Ob aus diesem Fund ein Signatur-Dokument erzeugt werden kann. */
  canCreateSigningDocument?: boolean;
  /** Quelle, aus der der Beleg stammt (null bei lokalen Uploads). */
  sourceLabel?: string | null;
};

export type DiscoveryListStatusFilter = DiscoveryDocumentStatus | 'all';

export type DiscoveryQualityFilter =
  | 'needs-review'
  | 'downloadable'
  | 'missing-amount'
  | 'missing-invoice-number';

export type DiscoveryFilter = {
  query?: string;
  /**
   * Status-Filter. 'all' bedeutet: alle Status zeigen — der Hauptzweck der
   * Listenansicht ist „welche Mail mit welcher Rechnung wann" — nicht ein
   * Workflow-getrennter Tabs-Blick.
   */
  status?: DiscoveryListStatusFilter;
  qualityFilter?: DiscoveryQualityFilter;
  correspondent?: string;
  documentDateFrom?: Date;
  documentDateTo?: Date;
};

export type DiscoveryPage = {
  documents: DiscoveryDocument[];
  total: number;
  nextCursor: string | null;
};

export type DiscoverySummary = {
  total: number;
  accepted: number;
  archived: number;
  ignored: number;
  needsReview: number;
  downloadable: number;
  missingAmount: number;
  missingInvoiceNumber: number;
  months: Array<{ key: string; count: number }>;
};

/**
 * Ausführungs-Kontext aus der Session. Reader, die Multi-Tenancy unterstützen
 * (DB-Reader für lokale Uploads + IMAP-Sync), nutzen teamId/userId. Externe
 * Reader (Paperless) ignorieren das Feld.
 */
export type DiscoveryContext = {
  teamId?: number;
  userId?: number;
};

export type DiscoveryReader = {
  /** Lesbarer Name für Logging/Diagnose, nie dem Nutzer angezeigt */
  readonly id: string;

  findDocuments(
    filter: DiscoveryFilter,
    cursor?: string | null,
    ctx?: DiscoveryContext,
  ): Promise<DiscoveryPage>;

  summarizeDocuments?(filter: DiscoveryFilter, ctx?: DiscoveryContext): Promise<DiscoverySummary>;

  getDocument(id: string, ctx?: DiscoveryContext): Promise<DiscoveryDocument | null>;

  getDocumentContent(id: string, ctx?: DiscoveryContext): Promise<Uint8Array | null>;
};
