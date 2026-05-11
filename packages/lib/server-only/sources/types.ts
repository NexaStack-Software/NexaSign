// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 NexaStack, NexaSign contributors
import type { SourceKind } from '@prisma/client';

/**
 * Ausführungs-Kontext für einen User-getriggerten Sync-Lauf über einen
 * expliziten Zeitraum. Die Konfig (host, port, credentials, …) ist bereits
 * entschlüsselt — der Adapter muss nicht mit `encryptedConfig` umgehen.
 */
export type SyncRangeContext = {
  sourceId: string;
  userId: number;
  teamId: number;
  /** Beginn des User-gewählten Suchzeitraums (inklusiv). */
  from: Date;
  /** Ende des User-gewählten Suchzeitraums (exklusiv). */
  to: Date;
  /** Optionaler Suchbegriff für Betreff/Header/Body, z. B. "Rechnung". */
  searchTerm?: string | null;
  /** Adapter-spezifische Konfig nach Decrypt. Adapter validiert selbst. */
  decryptedConfig: unknown;
  /** Cancel-Polling — Adapter prüft das pro Mail. */
  isCancelled: () => Promise<boolean>;
  /** Progress-Reporting — Adapter ruft das in Intervallen auf. */
  onProgress: (progress: SyncRangeProgress) => Promise<void>;
};

export type SyncRangeProgress = {
  /**
   * Obergrenze: Anzahl Mails, die der Adapter im Range gefunden hat. Wird
   * einmalig nach dem IMAP-Search gesetzt und aendert sich danach nicht mehr.
   * Frontend kann mit mailsChecked + Zeit eine ETA berechnen.
   * Optional, weil aeltere Implementierungen das nicht reporten und der
   * Persistenz-Pfad das nullable verarbeiten muss.
   */
  mailsTotal?: number | null;
  mailsChecked: number;
  documentsAuto: number;
  documentsManual: number;
  documentsIgnored: number;
  documentsFailed: number;
};

/**
 * Grund fuer einen vorzeitig abgebrochenen Lauf.
 *   BYTES_CAP — RAM/Disk-Sicherheitsgrenze pro Lauf erreicht, Range nicht
 *               vollstaendig abgearbeitet. UI zeigt das als Hinweis.
 *   MAILS_CAP — Mail-Anzahl-Grenze pro Lauf erreicht (selten, nur bei riesigen
 *               Postfaechern + langen Ranges).
 * null — Lauf vollstaendig durch.
 *
 * User-Cancel ist KEINE Truncation und wird hier nicht gefuehrt; cancelRequested
 * im DB-Eintrag deckt das ab.
 */
export type SyncTruncationReason = 'BYTES_CAP' | 'MAILS_CAP' | null;

export type SyncRangeResult = SyncRangeProgress & {
  truncationReason?: SyncTruncationReason;
};

export type TestConnectionInput = {
  config: unknown;
};

export type TestConnectionResult = {
  ok: boolean;
  error?: string;
};

/**
 * SourceAdapter-Interface — pro Source-Typ (IMAP, später Cloud) eine
 * Implementierung. Der Adapter ist der Schreib-Pfad in `DiscoveryDocument`;
 * der Lese-Pfad lebt im DiscoveryReader (db-reader).
 *
 * Es gibt keinen impliziten „seit-letztem-Sync"-Cursor mehr — jeder Lauf
 * bekommt einen expliziten Zeitraum vom User.
 */
export interface SourceAdapter {
  readonly kind: SourceKind;

  /** Verbindungstest gegen die übergebene Konfig — kein Schreib-Effekt. */
  testConnection(input: TestConnectionInput): Promise<TestConnectionResult>;

  /** User-getriggerter Sync über einen expliziten Zeitraum. */
  syncRange(ctx: SyncRangeContext): Promise<SyncRangeResult>;
}
