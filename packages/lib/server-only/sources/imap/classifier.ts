// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 NexaStack, NexaSign contributors
import {
  IGNORE_KEYWORDS,
  KNOWN_RECHNUNG_DOMAINS,
  PORTAL_HINTS,
  RECHNUNG_KEYWORDS,
} from './keywords';

export type ClassificationVerdict = 'AUTO' | 'MANUAL' | 'IGNORE';

export type MailFeatures = {
  senderDomain: string;
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

/**
 * Beleg-Klassifizierung — Port aus rechnungen.py:classify().
 *
 *   AUTO   = Beleg-Hinweis erkannt UND PDF im Anhang.
 *   MANUAL = Beleg-Hinweis erkannt, aber kein PDF (User muss aus Portal ziehen).
 *   IGNORE = Werbung / Newsletter / nicht-Beleg.
 */
export const classifyMail = (features: MailFeatures): ClassificationVerdict => {
  const haystack = `${features.subject}\n${features.bodyText}`;

  const knownSender = isKnownSender(features.senderDomain);
  const hasRechnungKeyword = containsAny(haystack, RECHNUNG_KEYWORDS);
  const hasIgnoreKeyword = containsAny(haystack, IGNORE_KEYWORDS);

  // Bekannter Absender ODER Beleg-Keyword reicht als Vor-Treffer.
  const isRechnungsmail = knownSender || hasRechnungKeyword;

  if (!isRechnungsmail) {
    return 'IGNORE';
  }
  // Werbung mit Beleg-Keyword (z.B. „Rabatt-Newsletter") aussortieren.
  // Bekannte Beleg-Sender überstimmen das.
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
