// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 NexaStack, NexaSign contributors
import { Prisma } from '@prisma/client';
import { ImapFlow } from 'imapflow';
import { createHash } from 'node:crypto';

import { prisma } from '@nexasign/prisma';

import { putFileServerSide } from '../../../universal/upload/put-file.server';
import { createDocumentData } from '../../document-data/create-document-data';
import { writeArchive } from '../archive';
import { registerSourceAdapter } from '../registry';
import type {
  SourceAdapter,
  SyncRangeContext,
  SyncRangeProgress,
  SyncRangeResult,
  SyncTruncationReason,
  TestConnectionInput,
  TestConnectionResult,
} from '../types';
import { classifyAndExtract } from './classifier';
import { parseRawMail } from './extract';
import { validateImapHost } from './host-allowlist';
import { type ImapAccountConfig, ZImapAccountConfigSchema } from './types';

/**
 * IMAP-Source-Adapter — Schreib-Pfad in `DiscoveryDocument` für Mail-Belege.
 *
 * Härtungen aus dem Threat-Model:
 *   - Host-Allowlist + DNS-Resolution-Check (`validateImapHost`)
 *   - Connect-Timeout 10 s, Greeting-Timeout 30 s
 *   - Idempotenz via `messageIdHash` (sha256 vom Message-ID-Header)
 *   - Kein Body-Speichern: Klassifizierung läuft in-memory, persistiert wird
 *     nur was in `DiscoveryDocument` als strukturiertes Feld steht
 *
 * Sync-Modell: User-getriggert mit expliziter Datums-Range. Cancel wird
 * pro Mail geprüft; Progress-Reporting alle 25 Mails.
 */

const CONNECT_TIMEOUT_MS = 10_000;
const GREETING_TIMEOUT_MS = 30_000;

// Bei Gmail ist die Sammelansicht (INBOX + Archiv + Sent) je nach Konto-
// Sprache und Erstellungs-Aera anders benannt. RFC 6154 \All-Flag ist der
// einzige verlaessliche Marker — Pfadnamen sind nur Fallback fuer Server,
// die das Special-Use-Flag nicht exposen. Reihenfolge nach Haeufigkeit:
//   - "Alle E-Mails"       deutsch (aktuell, seit ca. 2018)
//   - "Alle Nachrichten"   deutsch (aelter)
//   - "All Mail"           englisch (Standard)
const GMAIL_UNIFIED = [
  '[Gmail]/Alle E-Mails',
  '[Gmail]/Alle Nachrichten',
  '[Gmail]/All Mail',
  '[Google Mail]/All Mail',
  '[Google Mail]/Alle E-Mails',
] as const;

// Heuristik für Belege/Archive bei Nicht-Gmail-Providern. Persona archiviert
// Rechnungen häufig in eigene Ordner (Outlook-Regel, manuelle Ablage). Wer
// nur INBOX scannt, übersieht das halbe Archiv.
const ARCHIVE_FOLDER_PATTERNS: ReadonlyArray<RegExp> = [
  /^archiv$/i,
  /^archive$/i,
  /^all mail$/i,
  /^rechnungen$/i,
  /^belege$/i,
  /^quittungen$/i,
  /^receipts$/i,
  /^invoices$/i,
  /^bills$/i,
  /^steuern$/i,
  /^finanzen$/i,
  // Übliche Sub-Folder-Schreibweisen unter INBOX (separator . oder /):
  /^INBOX[/.](Archiv|Archive|Rechnungen|Belege|Quittungen|Steuern|Finanzen|Receipts|Invoices|Bills)$/i,
];

// IMAP RFC-6154 SPECIAL-USE-Flags die einen unified Archive markieren.
const ARCHIVE_SPECIAL_USE = new Set(['\\All', '\\Archive']);

const PROGRESS_REPORT_EVERY = 25;
// Sicherheitsgrenzen pro Sync-Lauf. Werte mehrfach iteriert: 500 Mails / 20 MB
// war zu eng (Cap nach ~300 Mails), 10k / 500 MB hat nur ein halbes Gmail-Jahr
// geschafft. Aktuell: 2 GB / 30k Mails — typisches 1-3-Jahre-Gmail-Archiv geht
// in einem Lauf. Wenn doch geschnitten wird, wird das in `truncationReason`
// vermerkt, statt still als SUCCESS zu enden.
const MAX_MAILS_PER_SYNC = 30_000;
const MAX_BYTES_PER_SYNC = 2 * 1024 * 1024 * 1024;

const parseConfig = (raw: unknown): ImapAccountConfig => {
  return ZImapAccountConfigSchema.parse(raw);
};

const hashMessageId = (messageId: string): string =>
  createHash('sha256').update(messageId).digest('hex');

const buildClient = (config: ImapAccountConfig): ImapFlow => {
  return new ImapFlow({
    host: config.host,
    port: config.port,
    secure: config.port === 993,
    auth: {
      user: config.username,
      pass: config.password,
    },
    tls: {
      rejectUnauthorized: config.tlsVerify,
    },
    logger: false,
    emitLogs: false,
    connectionTimeout: CONNECT_TIMEOUT_MS,
    greetingTimeout: GREETING_TIMEOUT_MS,
    socketTimeout: GREETING_TIMEOUT_MS,
  });
};

/**
 * Sucht alle Mailboxen, die für den Beleg-Sync sinnvoll sind. Ergebnis:
 *   - Gmail: ein Eintrag (Alle Nachrichten / All Mail), das ist die
 *     Sammelansicht und enthält INBOX + Archiv ohne Duplikate.
 *   - Andere Provider: INBOX + alle erkannten Archiv-/Beleg-Ordner. Doppelte
 *     Mails (gleicher Message-ID-Hash) werden auf DB-Ebene per Unique-Index
 *     deduppt, also kein Risiko bei Übersprung.
 *
 * Leeres Array bedeutet, der Adapter hat selbst INBOX nicht gefunden — wird
 * vom Aufrufer als hartes Fail behandelt.
 */
type MailboxListClient = {
  list: () => Promise<Array<{ path: string; specialUse?: string | null }>>;
};

export const pickMailboxes = async (client: MailboxListClient): Promise<string[]> => {
  const list = await client.list();
  const known = list.map((entry) => ({
    path: entry.path,
    specialUse: entry.specialUse ?? null,
  }));

  // Sammelansicht via RFC-6154 \All-Flag — sprachunabhaengig, einzig verlaessliche
  // Methode. ImapFlow liefert specialUse als String wie "\\All".
  const allFlagFolder = known.find((e) => e.specialUse === '\\All');
  if (allFlagFolder) return [allFlagFolder.path];

  // Fallback: Pfadnamen-Heuristik fuer Server, die specialUse nicht exposen.
  for (const candidate of GMAIL_UNIFIED) {
    if (known.some((e) => e.path === candidate)) return [candidate];
  }

  const targets = new Set<string>();
  if (known.some((e) => e.path === 'INBOX')) targets.add('INBOX');

  for (const entry of known) {
    if (entry.specialUse && ARCHIVE_SPECIAL_USE.has(entry.specialUse)) {
      targets.add(entry.path);
      continue;
    }
    if (ARCHIVE_FOLDER_PATTERNS.some((p) => p.test(entry.path))) {
      targets.add(entry.path);
    }
  }

  return [...targets];
};

const testConnection = async (input: TestConnectionInput): Promise<TestConnectionResult> => {
  let config: ImapAccountConfig;
  try {
    config = parseConfig(input.config);
  } catch {
    return { ok: false, error: 'Konfiguration ungültig.' };
  }

  const hostCheck = await validateImapHost(config.host, config.port);
  if (!hostCheck.ok) {
    return { ok: false, error: hostCheck.reason ?? 'Host nicht erlaubt.' };
  }

  const client = buildClient(config);
  try {
    await client.connect();
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Verbindung fehlgeschlagen.',
    };
  } finally {
    if (client.usable) {
      try {
        await client.logout();
      } catch {
        /* ignore */
      }
    }
  }
};

/**
 * User-getriggerter Sync über einen expliziten Zeitraum. Connection-Fehler
 * werden geworfen — der Job-Handler entscheidet anhand des Wurfs, ob der
 * SyncRun FAILED ist (und Suspend-Counter erhöht).
 */
const syncRange = async (ctx: SyncRangeContext): Promise<SyncRangeResult> => {
  const config = parseConfig(ctx.decryptedConfig);

  const hostCheck = await validateImapHost(config.host, config.port);
  if (!hostCheck.ok) {
    throw new Error(hostCheck.reason ?? 'Host-Validierung fehlgeschlagen.');
  }

  const counters: SyncRangeProgress = {
    // Wird gesetzt, sobald die UID-Liste vom IMAP-Search vorliegt; bis dahin
    // null = „noch unbekannt", Frontend zeigt dann unbestimmten Indikator.
    mailsTotal: null,
    mailsChecked: 0,
    documentsAuto: 0,
    documentsManual: 0,
    documentsIgnored: 0,
    documentsFailed: 0,
  };

  const client = buildClient(config);

  // Aggregat-State über alle Folders: Mail-/Bytes-Limit gilt pro Sync-Run,
  // nicht pro Folder, sonst zieht man bei mehreren Archiv-Folders deutlich
  // mehr als gewünscht.
  let bytesProcessed = 0;
  let mailsTaken = 0;
  let cancelled = false;
  // truncationReason wird gesetzt, sobald ein Cap greift. Frontend zeigt das
  // als Hinweis-Banner statt den Lauf still als SUCCESS zu praesentieren.
  let truncationReason: SyncTruncationReason = null;

  try {
    await client.connect();

    const mailboxes = await pickMailboxes(client);
    if (mailboxes.length === 0) {
      throw new Error(
        'Keine geeignete Mailbox gefunden — weder INBOX noch ein erkennbarer Archiv-Ordner.',
      );
    }

    for (const mailbox of mailboxes) {
      if (cancelled) break;
      if (mailsTaken >= MAX_MAILS_PER_SYNC) {
        truncationReason = 'MAILS_CAP';
        break;
      }
      if (bytesProcessed >= MAX_BYTES_PER_SYNC) {
        truncationReason = 'BYTES_CAP';
        break;
      }

      const lock = await client.getMailboxLock(mailbox);
      try {
        const search = {
          since: ctx.from,
          before: ctx.to,
          ...(ctx.searchTerm ? { text: ctx.searchTerm } : {}),
        };

        const searchResult = await client.search(search, { uid: true });
        const uids: number[] = Array.isArray(searchResult) ? searchResult : [];

        // Neueste zuerst — ergibt sinnvolle Progress-Reihenfolge im UI.
        // Wir kappen pro Folder auf das verbleibende Sync-Budget, damit ein
        // riesiger Archiv-Ordner die nachfolgenden Ordner nicht aushungert.
        const remainingBudget = MAX_MAILS_PER_SYNC - mailsTaken;
        const orderedUids = uids
          .slice()
          .sort((a, b) => b - a)
          .slice(0, remainingBudget);

        // Wenn der Folder mehr UIDs liefert, als wir noch ins Budget bekommen,
        // ist das Mail-Cap getriggert. Wir markieren das hier proaktiv, denn
        // der innere Loop laeuft sonst sauber durch und setzt es nicht mehr.
        if (orderedUids.length < uids.length) {
          truncationReason = 'MAILS_CAP';
        }

        // mailsTotal kumuliert den echten Search-Umfang, nicht nur die gekappte
        // Verarbeitungsmenge. Sonst wirkt ein begrenzter Lauf im UI faelschlich
        // wie vollstaendig abgeschlossen.
        counters.mailsTotal = (counters.mailsTotal ?? 0) + uids.length;
        await ctx.onProgress({ ...counters });

        for (let i = 0; i < orderedUids.length; i += 1) {
          // Cancel alle 10 Mails prüfen (DB-Roundtrip), nicht jedes Mal.
          if (i % 10 === 0 && (await ctx.isCancelled())) {
            cancelled = true;
            break;
          }

          const uid = orderedUids[i];
          try {
            const message = await client.fetchOne(String(uid), { source: true }, { uid: true });
            if (!message || !message.source) {
              counters.mailsChecked += 1;
              continue;
            }

            const raw = Buffer.isBuffer(message.source)
              ? message.source
              : Buffer.from(message.source);
            if (bytesProcessed + raw.length > MAX_BYTES_PER_SYNC) {
              truncationReason = 'BYTES_CAP';
              cancelled = true;
              break;
            }
            bytesProcessed += raw.length;
            mailsTaken += 1;

            const parsed = await parseRawMail(raw);
            counters.mailsChecked += 1;

            if (!parsed.messageId) {
              counters.documentsIgnored += 1;
              continue;
            }

            const messageIdHash = hashMessageId(parsed.messageId);

            // Idempotenz: bereits gesehen → überspringen, zählt nicht als Treffer.
            const existing = await prisma.discoveryDocument.findFirst({
              where: { messageIdHash, sourceId: ctx.sourceId },
              select: { id: true },
            });
            if (existing) {
              counters.documentsIgnored += 1;
              continue;
            }

            // Hinweis: der `existing`-Check oben ist KEIN echter Race-Schutz —
            // bei parallelen Sync-Runs koennen beide den Datensatz noch nicht sehen
            // und beide schreiben. Der echte Schutz ist der Partial-Unique-Index
            // (sourceId, messageIdHash) in der DB (Migration 20260430080000_…).
            // Das innere try/catch unten faengt Prisma-P2002 ab und behandelt es
            // als „bereits vorhanden, ueberspringen", statt als FAILED zu zaehlen.

            const result = classifyAndExtract({
              senderDomain: parsed.fromDomain,
              senderEmail: parsed.fromAddress,
              userEmail: config.username,
              subject: parsed.subject,
              bodyText: parsed.bodyText,
              hasPdfAttachment: parsed.pdfAttachments.length > 0,
            });

            if (result.verdict === 'IGNORE') {
              counters.documentsIgnored += 1;
              continue;
            }

            // Archive-Write: schreibt mail.eml + body.txt + body.html (optional) +
            // metadata.json + attachments idempotent ins Filesystem mit sha256.
            const metadata = {
              sourceId: ctx.sourceId,
              messageIdHash,
              messageId: parsed.messageId,
              fromName: parsed.fromName,
              fromAddress: parsed.fromAddress,
              fromDomain: parsed.fromDomain,
              subject: parsed.subject,
              date: parsed.date.toISOString(),
              classification: result.verdict,
              detectedAmount: result.detectedAmount,
              detectedInvoiceNumber: result.detectedInvoiceNumber,
              portalHint: result.portalHint,
              providerSource: 'imap',
              providerNativeId: String(uid),
              attachmentsOriginalNames: parsed.pdfAttachments.map((a) => a.fileName),
            };

            const archive = await writeArchive({
              sourceId: ctx.sourceId,
              messageIdHash,
              receivedAt: parsed.date,
              rawEml: raw,
              bodyText: parsed.bodyText,
              bodyHtml: parsed.bodyHtml,
              metadata,
              attachments: parsed.pdfAttachments.map((att) => ({
                fileName: att.fileName,
                contentType: att.contentType || 'application/pdf',
                bytes: att.bytes,
              })),
            });

            if (result.verdict === 'AUTO') {
              // Erstes PDF-Attachment ist das primäre DocumentData (für Sign-Flow später).
              // Weitere Attachments liegen nur als Artifacts auf disk.
              const primary = parsed.pdfAttachments[0];
              const arrayBuffer = primary.bytes.buffer.slice(
                primary.bytes.byteOffset,
                primary.bytes.byteOffset + primary.bytes.byteLength,
              );
              const file = {
                name: primary.fileName,
                type: 'application/pdf',
                arrayBuffer: async () => Promise.resolve(arrayBuffer),
              };
              const stored = await putFileServerSide(file);
              const dataRecord = await createDocumentData({
                type: stored.type,
                data: stored.data,
              });

              await prisma.$transaction(async (tx) => {
                const created = await tx.discoveryDocument.create({
                  data: {
                    teamId: ctx.teamId,
                    uploadedById: ctx.userId,
                    sourceId: ctx.sourceId,
                    title: parsed.subject || primary.fileName,
                    correspondent: parsed.fromName || parsed.fromAddress,
                    senderEmail: parsed.fromAddress,
                    senderDomain: parsed.fromDomain,
                    documentDate: parsed.date,
                    capturedAt: new Date(),
                    status: 'INBOX',
                    providerSource: 'imap',
                    providerNativeId: String(uid),
                    contentType: 'application/pdf',
                    fileSize: primary.bytes.byteLength,
                    tags: [],
                    detectedAmount: result.detectedAmount,
                    detectedInvoiceNumber: result.detectedInvoiceNumber,
                    portalHint: null,
                    messageIdHash,
                    bodyText: parsed.bodyText,
                    bodyHasHtml: parsed.bodyHtml !== null,
                    archivePath: archive.archivePath,
                    dataId: dataRecord.id,
                  },
                  select: { id: true },
                });
                await tx.discoveryArtifact.createMany({
                  data: archive.artifacts.map((art) => ({
                    discoveryDocumentId: created.id,
                    kind: art.kind,
                    fileName: art.fileName,
                    contentType: art.contentType,
                    fileSize: art.fileSize,
                    sha256: art.sha256,
                    relativePath: art.relativePath,
                  })),
                });
                await tx.discoveryAuditLog.create({
                  data: {
                    event: 'IMAP_DOCUMENT_IMPORTED',
                    sourceId: ctx.sourceId,
                    userId: ctx.userId,
                    teamId: ctx.teamId,
                    discoveryDocumentId: created.id,
                    metadata: {
                      messageIdHash,
                      fromDomain: parsed.fromDomain,
                      classification: result.verdict,
                      archivePath: archive.archivePath,
                      artifactCount: archive.artifacts.length,
                    },
                  },
                });
              });
              counters.documentsAuto += 1;
            } else {
              // MANUAL — Beleg-Hinweis ohne PDF. DiscoveryDocument mit dataId=null,
              // aber Body + Archive werden trotzdem geschrieben.
              await prisma.$transaction(async (tx) => {
                const created = await tx.discoveryDocument.create({
                  data: {
                    teamId: ctx.teamId,
                    uploadedById: ctx.userId,
                    sourceId: ctx.sourceId,
                    title: parsed.subject || `Beleg-Hinweis von ${parsed.fromDomain}`,
                    correspondent: parsed.fromName || parsed.fromAddress,
                    senderEmail: parsed.fromAddress,
                    senderDomain: parsed.fromDomain,
                    documentDate: parsed.date,
                    capturedAt: new Date(),
                    status: 'PENDING_MANUAL',
                    providerSource: 'imap',
                    providerNativeId: String(uid),
                    contentType: null,
                    fileSize: null,
                    tags: [],
                    detectedAmount: result.detectedAmount,
                    detectedInvoiceNumber: result.detectedInvoiceNumber,
                    portalHint: result.portalHint,
                    messageIdHash,
                    bodyText: parsed.bodyText,
                    bodyHasHtml: parsed.bodyHtml !== null,
                    archivePath: archive.archivePath,
                    dataId: null,
                  },
                  select: { id: true },
                });
                await tx.discoveryArtifact.createMany({
                  data: archive.artifacts.map((art) => ({
                    discoveryDocumentId: created.id,
                    kind: art.kind,
                    fileName: art.fileName,
                    contentType: art.contentType,
                    fileSize: art.fileSize,
                    sha256: art.sha256,
                    relativePath: art.relativePath,
                  })),
                });
                await tx.discoveryAuditLog.create({
                  data: {
                    event: 'IMAP_DOCUMENT_IMPORTED',
                    sourceId: ctx.sourceId,
                    userId: ctx.userId,
                    teamId: ctx.teamId,
                    discoveryDocumentId: created.id,
                    metadata: {
                      messageIdHash,
                      fromDomain: parsed.fromDomain,
                      classification: result.verdict,
                      portalHint: result.portalHint,
                      detectedAmount: result.detectedAmount,
                      detectedInvoiceNumber: result.detectedInvoiceNumber,
                      archivePath: archive.archivePath,
                      artifactCount: archive.artifacts.length,
                    },
                  },
                });
              });
              counters.documentsManual += 1;
            }
          } catch (err) {
            // Prisma P2002 = unique constraint violation. Bei (sourceId, messageIdHash)
            // bedeutet das: ein paralleler Sync-Run hat den Datensatz zwischen unserem
            // findFirst() und create() bereits geschrieben. Kein Fehler — Idempotenz
            // greift, wir zaehlen es als ignored und machen weiter.
            if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
              counters.documentsIgnored += 1;
            } else {
              counters.documentsFailed += 1;
            }
          }

          // Progress alle PROGRESS_REPORT_EVERY Mails persistieren.
          if ((i + 1) % PROGRESS_REPORT_EVERY === 0) {
            await ctx.onProgress({ ...counters });
          }
        }
      } finally {
        lock.release();
      }
    }
  } finally {
    if (client.usable) {
      try {
        await client.logout();
      } catch {
        /* ignore */
      }
    }
  }

  // Final-Progress-Report.
  await ctx.onProgress({ ...counters });

  return { ...counters, truncationReason };
};

/**
 * Diagnose-Helfer: listet alle IMAP-Folder des Accounts und ermittelt, welche
 * davon der Sync-Adapter wirklich scannen wuerde. Wird vom Frontend genutzt,
 * damit die Persona sieht „Wir scannen INBOX, aber dein Gmail-Archiv liegt in
 * '[Gmail]/Alle Nachrichten' und das ist nicht freigegeben — hier die Schritte
 * zum Aktivieren."
 *
 * Wirft, wenn Connect/Login fehlschlaegt; Caller fängt und meldet als Toast.
 */
export type ImapFolderInfo = {
  path: string;
  specialUse: string | null;
  scanned: boolean;
};

export type InspectFoldersResult = {
  folders: ImapFolderInfo[];
  scannedPaths: string[];
  isGmailHost: boolean;
  gmailAllMailVisible: boolean;
};

export const inspectFolders = async (rawConfig: unknown): Promise<InspectFoldersResult> => {
  const config = parseConfig(rawConfig);

  const hostCheck = await validateImapHost(config.host, config.port);
  if (!hostCheck.ok) {
    throw new Error(hostCheck.reason ?? 'Host nicht erlaubt.');
  }

  const client = buildClient(config);
  try {
    await client.connect();
    const list = await client.list();
    const known = list.map((entry) => ({
      path: entry.path,
      specialUse: entry.specialUse ?? null,
    }));

    const scanned = await pickMailboxes(client);
    const scannedSet = new Set(scanned);

    const isGmailHost =
      /(^|\.)imap\.gmail\.com$/i.test(config.host) || /(^|\.)gmail\.com$/i.test(config.host);
    // „All Mail" gilt als freigegeben, sobald entweder das RFC-6154 \All-Flag
    // an einem Folder haengt ODER ein bekannter Gmail-Pfadname matcht.
    // Pfadnamen-Liste hier bewusst etwas breiter als GMAIL_UNIFIED, damit auch
    // alte „[Google Mail]/…"-Konten ohne \All-Flag korrekt erkannt werden.
    const ALL_MAIL_PATH_PATTERNS = [
      /^\[Gmail\]\/(Alle E-Mails|Alle Nachrichten|All Mail)$/i,
      /^\[Google Mail\]\/(Alle E-Mails|Alle Nachrichten|All Mail)$/i,
    ];
    const gmailAllMailVisible = known.some(
      (e) => e.specialUse === '\\All' || ALL_MAIL_PATH_PATTERNS.some((rx) => rx.test(e.path)),
    );

    return {
      folders: known.map((e) => ({
        path: e.path,
        specialUse: e.specialUse,
        scanned: scannedSet.has(e.path),
      })),
      scannedPaths: scanned,
      isGmailHost,
      gmailAllMailVisible,
    };
  } finally {
    if (client.usable) {
      try {
        await client.logout();
      } catch {
        /* ignore */
      }
    }
  }
};

export const imapSourceAdapter: SourceAdapter = {
  kind: 'IMAP',
  testConnection,
  syncRange,
};

// Selbst-Registrierung beim Import. Der Job-Handler / Sources-Router muss
// dieses Modul nur einmal importieren, dann ist der Adapter in der Registry.
registerSourceAdapter(imapSourceAdapter);
