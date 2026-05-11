// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 NexaStack, NexaSign contributors
import {
  IGNORE_KEYWORDS,
  KNOWN_RECHNUNG_DOMAINS,
  NON_INVOICE_DOMAINS,
  NON_INVOICE_SENDER_PATTERNS,
  PORTAL_HINTS,
  RECHNUNG_KEYWORDS,
  STRONG_NEGATIVE_KEYWORDS,
  STRONG_NEGATIVE_PATTERNS,
} from './keywords';

export type ClassificationVerdict = 'AUTO' | 'MANUAL' | 'IGNORE';

export type MailFeatures = {
  senderDomain: string;
  /** Volle Sender-E-Mail-Adresse, fuer harten Veto-Vergleich gegen die
   *  NON_INVOICE_SENDER_PATTERNS-Liste. Optional, weil aeltere Aufrufer
   *  sie noch nicht durchreichen. */
  senderEmail?: string;
  /** E-Mail-Adresse des Konto-Inhabers. Wenn die Mail vom Konto an sich
   *  selbst gesendet wurde (Self-Forward, Notiz an mich), ist sie kein Beleg.
   *  Optional aus dem gleichen Grund wie senderEmail. */
  userEmail?: string;
  /** Weitere E-Mail-Adressen, unter denen der gleiche Mensch verschickt
   *  (z. B. private Gmail + Firmen-Adresse). Werden zusaetzlich zu
   *  userEmail gegen den Absender geprueft. Case-insensitiv, normalisiert
   *  wie userEmail. */
  selfAliases?: ReadonlyArray<string>;
  subject: string;
  bodyText: string;
  hasPdfAttachment: boolean;
};

export type ClassificationResult = {
  verdict: ClassificationVerdict;
  detectedAmount: string | null;
  detectedInvoiceNumber: string | null;
  portalHint: string | null;
};

const containsAny = (haystack: string, needles: ReadonlyArray<string>): boolean => {
  const low = haystack.toLowerCase();
  return needles.some((needle) => low.includes(needle));
};

const isKnownSender = (senderDomain: string): boolean => {
  const lower = senderDomain.toLowerCase();
  return KNOWN_RECHNUNG_DOMAINS.some((known) => lower === known || lower.endsWith(`.${known}`));
};

const isNonInvoiceSender = (senderEmail: string | undefined): boolean => {
  if (!senderEmail) return false;
  const lower = senderEmail.toLowerCase().trim();
  return NON_INVOICE_SENDER_PATTERNS.some((pat) => pat === lower);
};

const isNonInvoiceDomain = (senderDomain: string): boolean => {
  const lower = senderDomain.toLowerCase().trim();
  return NON_INVOICE_DOMAINS.some((dom) => lower === dom || lower.endsWith(`.${dom}`));
};

/**
 * Normalisiert eine E-Mail-Adresse fuer Self-Sent-Vergleich:
 * - case-fold + trim
 * - Gmail-Quirk: googlemail.com === gmail.com (gleiche Inbox bei Google).
 * - Gmail-Quirk: Punkte im Local-Part sind irrelevant (`e.b@gmail.com` ===
 *   `eb@gmail.com`); ebenso Plus-Aliasse (`emil+invoice@gmail.com` ===
 *   `emil@gmail.com`). Beides ist offizielles Gmail-Verhalten.
 *
 * Andere Provider (Outlook, Yahoo, custom) lassen wir unangetastet — dort
 * waeren die gleichen Tricks falsch positiv.
 */
const normalizeAddressForSelfMatch = (raw: string): string => {
  const lower = raw.toLowerCase().trim();
  const at = lower.lastIndexOf('@');
  if (at < 0) return lower;
  let local = lower.slice(0, at);
  let domain = lower.slice(at + 1);
  if (domain === 'googlemail.com') domain = 'gmail.com';
  if (domain === 'gmail.com') {
    const plus = local.indexOf('+');
    if (plus > 0) local = local.slice(0, plus);
    local = local.replace(/\./g, '');
  }
  return `${local}@${domain}`;
};

const isSelfSent = (
  senderEmail: string | undefined,
  userEmail: string | undefined,
  selfAliases: ReadonlyArray<string> | undefined,
): boolean => {
  if (!senderEmail) return false;
  const sender = normalizeAddressForSelfMatch(senderEmail);
  if (userEmail && sender === normalizeAddressForSelfMatch(userEmail)) return true;
  if (!selfAliases || selfAliases.length === 0) return false;
  return selfAliases.some((alias) => sender === normalizeAddressForSelfMatch(alias));
};

/**
 * Beleg-Klassifizierung — Port aus rechnungen.py:classify(), inzwischen mit
 * mehreren Verschaerfungs-Stufen ueber dem urspruenglichen OR-basierten
 * Heuristik-Code.
 *
 *   AUTO   = Beleg-Hinweis erkannt UND PDF im Anhang.
 *   MANUAL = Beleg-Hinweis erkannt, aber kein PDF (User muss aus Portal ziehen).
 *   IGNORE = Werbung / Newsletter / Service-Notification / Self-Forward.
 *
 * Entscheidungs-Reihenfolge (Veto-Stufen vor positiven Signalen):
 *   1. Sender exakt in NON_INVOICE_SENDER_PATTERNS  → IGNORE (hart)
 *   2. Self-Sent (sender == user)                   → IGNORE
 *   3. Beleg-Signal vorhanden? (Keyword | PDF | Betrag im Body)
 *        — wenn nicht: IGNORE
 *   4. Bekannter Sender + Beleg-Signal              → AUTO/MANUAL
 *      Unbekannter Sender + Beleg-Keyword (Subject/Body) + nicht Newsletter
 *                                                    → AUTO/MANUAL
 *      sonst                                         → IGNORE
 */
export const classifyMail = (features: MailFeatures): ClassificationVerdict => {
  // Stufe 1a: hartes Veto fuer bekannte Service-Adressen (Calendar/Ads/etc.)
  if (isNonInvoiceSender(features.senderEmail)) {
    return 'IGNORE';
  }
  // Stufe 1b: Domain pauschal nicht relevant (z. B. Mitfahrdienste)
  if (isNonInvoiceDomain(features.senderDomain)) {
    return 'IGNORE';
  }
  // Stufe 2: Self-Forward / Notiz an mich
  if (isSelfSent(features.senderEmail, features.userEmail, features.selfAliases)) {
    return 'IGNORE';
  }

  const haystack = `${features.subject}\n${features.bodyText}`;

  // Stufe 2b: Subject/Body enthaelt ein hartes Negativ-Pattern
  // (Failed Payment, Sicherheitstoken, Konto gesperrt etc.). Schlaegt
  // sogar bekannte Beleg-Sender, weil diese Mails auch von ihnen kein
  // Beleg sind.
  if (containsAny(haystack, STRONG_NEGATIVE_KEYWORDS)) {
    return 'IGNORE';
  }
  // Stufe 2c: Regex-Patterns fuer „payment ... unsuccessful" / „Zahlung ... ist
  // fehlgeschlagen" — Substring-Match in 2b laesst diese durch, weil Fuellwoerter
  // zwischen den Schluesselwoertern stehen.
  if (STRONG_NEGATIVE_PATTERNS.some((rx) => rx.test(haystack))) {
    return 'IGNORE';
  }

  const knownSender = isKnownSender(features.senderDomain);
  const hasRechnungKeyword = containsAny(haystack, RECHNUNG_KEYWORDS);
  const hasIgnoreKeyword = containsAny(haystack, IGNORE_KEYWORDS);
  const hasAmount = extractAmount(haystack) !== null;

  // Stufe 3: ohne irgendein Beleg-Signal raus, egal woher die Mail kommt.
  // PDF-Anhang ist ein klares Signal, Beleg-Keyword auch, Betrag im Body
  // ebenfalls (Anbieter wie Anthropic/OpenAI schicken Belege auch ohne
  // explizites „Rechnung"-Wort, aber immer mit Betrag).
  const hasInvoiceSignal = hasRechnungKeyword || features.hasPdfAttachment || hasAmount;
  if (!hasInvoiceSignal) {
    return 'IGNORE';
  }

  // Stufe 4: Werbung mit Beleg-Keyword (z. B. „Rabatt-Newsletter") raus —
  // bekannte Beleg-Sender ueberstimmen das, weil ihre echten Belege manchmal
  // Marketing-Floskeln im Footer haben.
  if (hasIgnoreKeyword && !knownSender) {
    return 'IGNORE';
  }

  if (features.hasPdfAttachment) {
    return 'AUTO';
  }
  return 'MANUAL';
};

// Erkennt sowohl „12,99 €" / „12.99 EUR" als auch „$12.99" / „USD 12.99".
// `g`-Flag: matchAll iteriert alle Treffer. Wir wählen den größten — typische
// Rechnungs-Mails listen Netto und MwSt einzeln auf, der Brutto-Gesamtbetrag
// ist der höchste. „Erster Match gewinnt" extrahierte vorher oft den Netto-
// oder Teilbetrag, was die CSV für den Steuerberater unbrauchbar macht.
const AMOUNT_RX =
  /(?:(?<cur1>€|EUR|USD|\$)\s*(?<num1>\d{1,3}(?:[.,\s]\d{3})*[.,]\d{2}))|(?:(?<num2>\d{1,3}(?:[.,\s]\d{3})*[.,]\d{2})\s*(?<cur2>€|EUR|USD|\$))/gi;

const INVOICE_NR_RX =
  /(?:rechnungs?\s*-?\s*nr\.?|invoice\s*(?:no|number|#)|beleg\s*nr\.?|order\s*#?|auftrag\s*#?)\s*[:#]?\s*(?<nr>[A-Z0-9][A-Z0-9\-_/]{3,30})/i;

const normalizeCurrency = (cur: string): string => {
  const upper = cur.toUpperCase();
  if (upper === '$') return 'USD';
  if (upper === '€') return 'EUR';
  return upper;
};

// „1.234,56" / „1,234.56" / „1 234,56" robust auf Number bringen, ohne die
// Originaldarstellung zu verlieren. Heuristik: das letzte Trennzeichen ist
// das Dezimal-Trennzeichen (immer 2 Nachkommastellen via Regex), alle vorher
// sind Tausender-Trennzeichen.
export const parseAmountToNumber = (raw: string): number => {
  const cleaned = raw.replace(/\s/g, '');
  const lastDot = cleaned.lastIndexOf('.');
  const lastComma = cleaned.lastIndexOf(',');
  const decimalIdx = Math.max(lastDot, lastComma);
  if (decimalIdx < 0) return Number(cleaned);
  const intPart = cleaned.slice(0, decimalIdx).replace(/[.,\s]/g, '');
  const decPart = cleaned.slice(decimalIdx + 1);
  return Number(`${intPart}.${decPart}`);
};

export const extractAmount = (text: string): string | null => {
  let best: { display: string; value: number } | null = null;
  for (const match of text.matchAll(AMOUNT_RX)) {
    if (!match.groups) continue;
    const num = match.groups.num1 ?? match.groups.num2;
    const cur = match.groups.cur1 ?? match.groups.cur2;
    if (!num || !cur) continue;
    const value = parseAmountToNumber(num);
    if (!Number.isFinite(value)) continue;
    if (!best || value > best.value) {
      best = { display: `${num} ${normalizeCurrency(cur)}`.trim(), value };
    }
  }
  return best?.display ?? null;
};

export const extractInvoiceNumber = (text: string): string | null => {
  const match = INVOICE_NR_RX.exec(text);
  return match?.groups?.nr ?? null;
};

export const detectPortalHint = (text: string): string | null => {
  const low = text.toLowerCase();
  for (const hint of PORTAL_HINTS) {
    if (low.includes(hint)) return hint;
  }
  return null;
};

/**
 * Komplett-Klassifizierung inkl. strukturierter Felder. Body-Text wird hier
 * ein letztes Mal benutzt — nach diesem Aufruf wird er verworfen, nichts geht
 * an die DB außer den vier Rückgabe-Feldern.
 */
export const classifyAndExtract = (features: MailFeatures): ClassificationResult => {
  const verdict = classifyMail(features);
  if (verdict === 'IGNORE') {
    return {
      verdict,
      detectedAmount: null,
      detectedInvoiceNumber: null,
      portalHint: null,
    };
  }
  const haystack = `${features.subject}\n${features.bodyText}`;
  return {
    verdict,
    detectedAmount: extractAmount(haystack),
    detectedInvoiceNumber: extractInvoiceNumber(haystack),
    portalHint: verdict === 'MANUAL' ? detectPortalHint(haystack) : null,
  };
};
