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
  'uber.com',
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
    { domain: 'uber.com', url: 'https://riders.uber.com/trips', label: 'Uber Trips' },
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
