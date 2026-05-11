// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 NexaStack, NexaSign contributors

/**
 * Klassifizierungs-Keywords für die IMAP-Discovery-Heuristik.
 *
 * Direkte Portierung aus dem Prototyp-Script (`Rechnungen erstellen/rechnungen.py`)
 * mit den Listen, die sich dort über Monate stabilisiert haben.
 */

/** Stichwörter, die auf eine Rechnungs-/Beleg-Mail hindeuten (Betreff oder Body). */
export const RECHNUNG_KEYWORDS: ReadonlyArray<string> = [
  'rechnung',
  'invoice',
  'beleg',
  'receipt',
  'quittung',
  'zahlungsbestätigung',
  'zahlungsbestaetigung',
  'payment confirmation',
  'abrechnung',
  'gutschrift',
  'kreditnote',
  'credit note',
  'auftragsbestätigung',
  'auftragsbestaetigung',
  'order confirmation',
];

/** Absender-Domains, die wir als verlässliche Beleg-Quellen kennen. */
export const KNOWN_RECHNUNG_DOMAINS: ReadonlyArray<string> = [
  'hetzner.com',
  'hetzner.de',
  'netcup.de',
  'netcup.eu',
  'all-inkl.com',
  'all-inkl.de',
  'strato.de',
  'strato.com',
  'anthropic.com',
  'openai.com',
  'cloudflare.com',
  'godaddy.com',
  'deutschepost.de',
  'flixbus.de',
  'amazon.de',
  'amazon.com',
  'paypal.com',
  'paypal.de',
  'telekom.de',
  'vodafone.de',
  'o2.de',
  '1und1.de',
  'ionos.de',
  'premiumsim.de',
  'congstar.de',
  'stripe.com',
  'suno.com',
  'github.com',
  'gitlab.com',
  'google.com',
  'microsoft.com',
  'apple.com',
  'wise.com',
  'n26.com',
  'dkb.de',
  'comdirect.de',
  'ing.de',
];

/** Mails, die diese Begriffe enthalten, gelten als Werbung/Newsletter und werden ignoriert. */
export const IGNORE_KEYWORDS: ReadonlyArray<string> = [
  'newsletter',
  'unsubscribe',
  'abmelden',
  'sale',
  'rabatt',
  '% off',
];

/**
 * Hartes Veto auf Subject/Body-Ebene: wenn eines dieser Patterns in Subject
 * oder Body auftaucht, ist es nie ein Beleg — auch wenn der Sender in
 * KNOWN_RECHNUNG_DOMAINS steht oder ein Betrag im Body steht.
 *
 * Praxis-Cases:
 *   - „Fehlgeschlagene Zahlung" / „payment failed" — keine Buchung, also
 *     auch keine Quittung
 *   - „Sicherheitstoken" / „2FA" — Login-Codes, kein Beleg
 *   - „Verifizierung" / „security alert" — Service-Notification
 *   - „Konto gesperrt" / „Konto geschlossen" — Compliance-Mail
 */
export const STRONG_NEGATIVE_KEYWORDS: ReadonlyArray<string> = [
  // Zahlungs-Misslingen (deutsch + englisch)
  'fehlgeschlagene zahlung',
  'zahlung fehlgeschlagen',
  'zahlung konnte nicht',
  'fehlgeschlagene abbuchung',
  'lastschrift fehlgeschlagen',
  'payment failed',
  'failed payment',
  'unsuccessful payment',
  'payment unsuccessful',
  'declined payment',
  'payment declined',
  // Login / Security / 2FA
  'sicherheitstoken',
  'security token',
  'verifizierungs-code',
  'verifizierungscode',
  'verification code',
  'login-bestätigung',
  'login confirmation',
  '2-faktor',
  'two-factor',
  'einmalpasswort',
  'one-time password',
  'security alert',
  'sicherheitswarnung',
  // Konto-Compliance (kein Beleg)
  'konto gesperrt',
  'konto geschlossen',
  'account suspended',
  'account closed',
  'account locked',
  'konto vorläufig gesperrt',
];

/**
 * Regex-Variante der STRONG_NEGATIVE_KEYWORDS — fuer Faelle, wo zwischen den
 * Schluesselwoertern Fuellwoerter stehen (typisch fuer maschinell generierte
 * Betreffe wie „€10.00 payment to Gamma was unsuccessful" oder „Eine
 * Rechnungszahlung fuer X ist fehlgeschlagen"). Substring-Match wuerde dort
 * versagen.
 *
 * Distanz: bis zu 60 Zeichen zwischen Anker-Woertern, das deckt die meisten
 * realen Faelle ab ohne ganze Newsletter-Absaetze zu treffen.
 */
export const STRONG_NEGATIVE_PATTERNS: ReadonlyArray<RegExp> = [
  // Englisch: payment ... unsuccessful/failed/declined (beide Reihenfolgen)
  /\bpayment\b[\s\S]{0,60}\b(unsuccessful|failed|declined|could not be processed)\b/i,
  /\b(unsuccessful|failed|declined)\b[\s\S]{0,60}\bpayment\b/i,
  // Deutsch: Zahlung/Rechnungszahlung/Abbuchung ... fehlgeschlagen/abgelehnt/nicht möglich
  /\b(zahlung|rechnungszahlung|abbuchung|lastschrift)\b[\s\S]{0,60}\b(fehlgeschlagen|abgelehnt|nicht möglich|konnte nicht|storniert)\b/i,
  /\b(fehlgeschlagene?|abgelehnte?)\b[\s\S]{0,60}\b(zahlung|abbuchung|lastschrift|rechnungszahlung)\b/i,
  // „Charge failed" / „Belastung fehlgeschlagen"
  /\bcharge\b[\s\S]{0,40}\bfailed\b/i,
  /\bbelastung\b[\s\S]{0,40}\bfehlgeschlagen\b/i,
];

/**
 * Hartes Veto auf Domain-Ebene: alle Mails von diesen Domains werden als
 * IGNORE behandelt. Ergaenzt NON_INVOICE_SENDER_PATTERNS (E-Mail-genau) um
 * Faelle wo der gesamte Anbieter pauschal raus soll, weil seine Mails fuer
 * den User nie als Beleg taugen — z. B. Mitfahrdienste, deren Quittungen
 * ueber andere Wege erfasst werden.
 *
 * Suffix-Match: '.uber.com' und 'uber.com' matchen beide.
 */
export const NON_INVOICE_DOMAINS: ReadonlyArray<string> = [
  'uber.com',
  // Estateguru: P2P-Invest-Plattform, schickt rein werbliche
  // „Neue Investitionsmoeglichkeit!"-Mails — keine Belege.
  'estateguru.co',
];

/**
 * Hartes Veto: Absender-Adressen, die nie Belege verschicken — auch wenn die
 * Mail Beleg-Keywords im Body enthaelt.
 *
 * Hintergrund: KNOWN_RECHNUNG_DOMAINS listet ganze Domains wie `google.com`,
 * `github.com`. Damit wuerden alle Service-Notifications dieser Anbieter (Ads-
 * Reports, Calendar-Einladungen, Search-Console-Berichte) faelschlich als
 * Beleg-Mails durchgehen. Diese Veto-Liste ueberstimmt die Domain-Whitelist
 * fuer eindeutige Service-Adressen, OHNE legitime Beleg-Sender (Stripe,
 * Anthropic billing, GitHub billing) zu blocken.
 *
 * Vergleich erfolgt case-insensitiv auf die volle E-Mail-Adresse.
 */
export const NON_INVOICE_SENDER_PATTERNS: ReadonlyArray<string> = [
  // Google Services (Payments/Workspace-Billing schlagen separat zu)
  'calendar-noreply@google.com',
  'googleads-noreply@google.com',
  'googleadwords-noreply@google.com',
  'searchconsole-noreply@google.com',
  'forwarding-noreply@google.com',
  'feedback-noreply@google.com',
  'noreply-googleplay@google.com',
  'googleplay-noreply@google.com',
  'noreply@youtube.com',
  'noreply@accounts.google.com',
  'no-reply@accounts.google.com',
  // GitHub Notifications (NICHT Billing — billing@github.com bleibt erlaubt)
  'notifications@github.com',
  'noreply@github.com',
  // LinkedIn / Xing Notifications
  'notifications-noreply@linkedin.com',
  'notifications@linkedin.com',
];

/**
 * Portal-Hinweise — Mail enthält Beleg-Indikator, aber kein PDF-Anhang.
 * Heißt: User muss sich im Kunden-Portal einloggen und dort die PDF ziehen.
 */
export const PORTAL_HINTS: ReadonlyArray<string> = [
  'im kundenportal',
  'im kundencenter',
  'in der servicewelt',
  'in ihrem konto',
  'im kundenlogin',
  'in ihrem account',
  'einloggen unter',
  'log in to',
  'anmelden unter',
  'rechnung abrufen',
  'rechnung steht zum download bereit',
  'view your invoice',
  'im ccp',
  'control panel',
];

/**
 * Bekannte Portal-URLs pro Anbieter, gekoppelt an die Sender-Domain. Wenn
 * der portalHint zugleich eine bekannte Domain hat, kann das Frontend einen
 * direkten Link rendern statt nur den Roh-Schnipsel anzuzeigen. Die Persona
 * mit „Beleg liegt im Portal" erspart sich Google-Suche + Login-Suche.
 *
 * Reihenfolge: Domain (Suffix-Match) → Portal-URL.
 */
export const PORTAL_URLS_BY_DOMAIN: ReadonlyArray<{ domain: string; url: string; label: string }> =
  [
    {
      domain: 'hetzner.com',
      url: 'https://accounts.hetzner.com/login',
      label: 'Hetzner Cloud Console',
    },
    {
      domain: 'hetzner.de',
      url: 'https://accounts.hetzner.com/login',
      label: 'Hetzner Cloud Console',
    },
    { domain: 'netcup.de', url: 'https://www.customercontrolpanel.de/', label: 'Netcup CCP' },
    { domain: 'netcup.eu', url: 'https://www.customercontrolpanel.de/', label: 'Netcup CCP' },
    { domain: 'all-inkl.com', url: 'https://kas.all-inkl.com/', label: 'All-Inkl KAS' },
    { domain: 'all-inkl.de', url: 'https://kas.all-inkl.com/', label: 'All-Inkl KAS' },
    {
      domain: 'strato.de',
      url: 'https://www.strato.de/apps/CustomerService',
      label: 'Strato Kundenservice',
    },
    {
      domain: 'strato.com',
      url: 'https://www.strato.de/apps/CustomerService',
      label: 'Strato Kundenservice',
    },
    { domain: 'ionos.de', url: 'https://login.ionos.de/', label: 'IONOS Login' },
    { domain: '1und1.de', url: 'https://login.ionos.de/', label: '1&1 / IONOS Login' },
    {
      domain: 'telekom.de',
      url: 'https://www.telekom.de/kundencenter',
      label: 'Telekom Kundencenter',
    },
    { domain: 'vodafone.de', url: 'https://www.vodafone.de/meinvodafone/', label: 'MeinVodafone' },
    { domain: 'o2.de', url: 'https://www.o2online.de/ecare/', label: 'O2 Mein O2' },
    { domain: 'congstar.de', url: 'https://www.congstar.de/meincongstar/', label: 'Mein congstar' },
    { domain: 'premiumsim.de', url: 'https://www.premiumsim.de/', label: 'PremiumSIM Login' },
    {
      domain: 'amazon.de',
      url: 'https://www.amazon.de/gp/your-account/order-history',
      label: 'Amazon Bestellungen',
    },
    {
      domain: 'amazon.com',
      url: 'https://www.amazon.com/gp/your-account/order-history',
      label: 'Amazon Orders',
    },
    {
      domain: 'paypal.com',
      url: 'https://www.paypal.com/myaccount/activities/',
      label: 'PayPal Aktivitäten',
    },
    {
      domain: 'paypal.de',
      url: 'https://www.paypal.com/myaccount/activities/',
      label: 'PayPal Aktivitäten',
    },
    { domain: 'stripe.com', url: 'https://dashboard.stripe.com/billing', label: 'Stripe Billing' },
    {
      domain: 'github.com',
      url: 'https://github.com/settings/billing/payment_history',
      label: 'GitHub Billing',
    },
    {
      domain: 'gitlab.com',
      url: 'https://gitlab.com/-/profile/billings',
      label: 'GitLab Billings',
    },
    {
      domain: 'google.com',
      url: 'https://payments.google.com/payments/u/0/home',
      label: 'Google Payments',
    },
    {
      domain: 'microsoft.com',
      url: 'https://account.microsoft.com/billing',
      label: 'Microsoft Billing',
    },
    { domain: 'apple.com', url: 'https://reportaproblem.apple.com/', label: 'Apple Bestellungen' },
    {
      domain: 'cloudflare.com',
      url: 'https://dash.cloudflare.com/?to=/:account/billing',
      label: 'Cloudflare Billing',
    },
    { domain: 'godaddy.com', url: 'https://account.godaddy.com/billing', label: 'GoDaddy Billing' },
    {
      domain: 'wise.com',
      url: 'https://wise.com/user/account/statements',
      label: 'Wise Statements',
    },
    { domain: 'n26.com', url: 'https://app.n26.com/', label: 'N26 Web' },
    { domain: 'dkb.de', url: 'https://www.dkb.de/banking', label: 'DKB Banking' },
    { domain: 'comdirect.de', url: 'https://kunde.comdirect.de/', label: 'Comdirect' },
    { domain: 'ing.de', url: 'https://banking.ing.de/', label: 'ING Banking' },
    {
      domain: 'anthropic.com',
      url: 'https://console.anthropic.com/settings/billing',
      label: 'Anthropic Console',
    },
    {
      domain: 'openai.com',
      url: 'https://platform.openai.com/account/billing/history',
      label: 'OpenAI Billing',
    },
    {
      domain: 'flixbus.de',
      url: 'https://www.flixbus.de/booking/manage',
      label: 'Flixbus Buchungen',
    },
    {
      domain: 'deutschepost.de',
      url: 'https://www.deutschepost.de/de/login.html',
      label: 'Deutsche Post Login',
    },
  ];

export const lookupPortalUrl = (senderDomain: string): { url: string; label: string } | null => {
  const lower = senderDomain.toLowerCase();
  for (const entry of PORTAL_URLS_BY_DOMAIN) {
    if (lower === entry.domain || lower.endsWith(`.${entry.domain}`)) {
      return { url: entry.url, label: entry.label };
    }
  }
  return null;
};
