// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 NexaStack, NexaSign contributors

/**
 * Markenname -> IMAP-Server-Mapping. Macht das Setup für Nicht-Tech-Nutzer
 * verdaulich: sie wählen "Gmail" statt "imap.gmail.com:993".
 *
 * Die Hostnamen MÜSSEN sich mit der Backend-Allowlist
 * (`getDefaultImapHostAllowlist`) decken — wenn der Server den Host nicht
 * akzeptiert, schlägt das Speichern fehl. Bei Erweiterungen also beide
 * Stellen pflegen.
 */

export type ImapProvider = {
  /** stabile ID, wird im UI-State und in Tests verwendet */
  id: string;
  /** Markenname wie er im Picker steht */
  label: string;
  /** Hostname (matcht Backend-Allowlist) */
  host: string;
  /** Default-Port für diesen Provider */
  port: 993 | 143;
  /** typische E-Mail-Endungen — für Auto-Detection beim Tippen der E-Mail */
  emailDomains: string[];
  /** Direktlink zur App-Passwort-Verwaltung (oder null wenn kein App-Passwort nötig) */
  appPasswordUrl: string | null;
  /** kurze Anleitung wie der Nutzer das App-Passwort findet */
  appPasswordHelp: string;
};

export const IMAP_PROVIDERS: ImapProvider[] = [
  {
    id: 'gmail',
    label: 'Gmail',
    host: 'imap.gmail.com',
    port: 993,
    emailDomains: ['gmail.com', 'googlemail.com'],
    appPasswordUrl: 'https://myaccount.google.com/apppasswords',
    appPasswordHelp:
      'Google-Konto öffnen → Sicherheit → 2-Faktor-Authentifizierung muss aktiv sein → „App-Passwörter" → neues App-Passwort für „Mail" erzeugen.',
  },
  {
    id: 'outlook',
    label: 'Outlook / Microsoft 365',
    host: 'outlook.office365.com',
    port: 993,
    emailDomains: ['outlook.com', 'hotmail.com', 'live.com', 'msn.com'],
    appPasswordUrl: 'https://account.microsoft.com/security',
    appPasswordHelp:
      'Microsoft-Konto öffnen → Sicherheit → „Erweiterte Sicherheitsoptionen" → 2-Schritt-Verifizierung muss aktiv sein → „App-Passwörter" → neues App-Passwort erstellen.',
  },
  {
    id: 'icloud',
    label: 'iCloud Mail',
    host: 'imap.mail.me.com',
    port: 993,
    emailDomains: ['icloud.com', 'me.com', 'mac.com'],
    appPasswordUrl: 'https://appleid.apple.com/account/manage',
    appPasswordHelp:
      'Apple-ID-Seite öffnen → Anmelden → „App-spezifische Passwörter" → neues Passwort generieren. Apple verlangt 2FA.',
  },
  {
    id: 'yahoo',
    label: 'Yahoo Mail',
    host: 'imap.mail.yahoo.com',
    port: 993,
    emailDomains: ['yahoo.com', 'yahoo.de', 'ymail.com'],
    appPasswordUrl: 'https://login.yahoo.com/account/security',
    appPasswordHelp:
      'Yahoo-Konto-Sicherheit → 2-Schritt-Verifizierung muss aktiv sein → „App-Passwort generieren" → „Mail" auswählen.',
  },
  {
    id: 't-online',
    label: 'Telekom (t-online.de)',
    host: 'secureimap.t-online.de',
    port: 993,
    emailDomains: ['t-online.de', 'magenta.de'],
    appPasswordUrl: 'https://email.t-online.de/em',
    appPasswordHelp:
      'E-Mail-Center öffnen → Einstellungen → „E-Mail-Programme" → bei Telekom heißt es „E-Mail-Passwort" und ist getrennt vom Web-Login-Passwort.',
  },
  {
    id: 'web-de',
    label: 'WEB.DE',
    host: 'imap.web.de',
    port: 993,
    emailDomains: ['web.de'],
    appPasswordUrl: 'https://web.de/email/pop-imap-zugriff/',
    appPasswordHelp:
      'WEB.DE-Postfach öffnen → Einstellungen → POP3/IMAP → Zugriff für externe Programme aktivieren. Es wird das normale Passwort verwendet.',
  },
  {
    id: 'gmx',
    label: 'GMX',
    host: 'imap.gmx.net',
    port: 993,
    emailDomains: ['gmx.de', 'gmx.net', 'gmx.at', 'gmx.ch'],
    appPasswordUrl: 'https://www.gmx.net/serviceabschnitte/email/email-einstellungen/',
    appPasswordHelp:
      'GMX-Postfach öffnen → Einstellungen → POP3/IMAP → externen Zugriff freischalten. Standard-Passwort wird verwendet.',
  },
  {
    id: 'fastmail',
    label: 'Fastmail',
    host: 'imap.fastmail.com',
    port: 993,
    emailDomains: ['fastmail.com', 'fastmail.fm'],
    appPasswordUrl: 'https://www.fastmail.com/settings/security/devicekeys',
    appPasswordHelp:
      'Fastmail-Settings → Privacy & Security → „App passwords" → neues Passwort mit „IMAP/SMTP"-Berechtigung erstellen.',
  },
  {
    id: 'mailbox-org',
    label: 'mailbox.org',
    host: 'mailbox.org',
    port: 993,
    emailDomains: ['mailbox.org'],
    appPasswordUrl: 'https://login.mailbox.org/',
    appPasswordHelp:
      'mailbox.org-Login → Einstellungen → Sicherheit → IMAP/POP3-Zugriff aktivieren. Bei aktivem 2FA muss ein Geräte-Passwort erzeugt werden.',
  },
  {
    id: 'posteo',
    label: 'Posteo',
    host: 'imap.posteo.de',
    port: 993,
    emailDomains: ['posteo.de', 'posteo.net'],
    appPasswordUrl: 'https://posteo.de/account/security',
    appPasswordHelp:
      'Posteo-Konto → Einstellungen → Konto-Sicherheit. Bei 2FA wird ein Passwort speziell für IMAP gesetzt.',
  },
];

/**
 * Findet einen Provider anhand der E-Mail-Domain. Wird live während der
 * E-Mail-Eingabe aufgerufen, damit das UI den Anbieter automatisch
 * vorauswählen kann, sobald der Nutzer "@gmail.com" tippt.
 */
export const detectProviderByEmail = (email: string): ImapProvider | undefined => {
  const at = email.lastIndexOf('@');
  if (at < 0 || at === email.length - 1) return undefined;
  const domain = email
    .slice(at + 1)
    .toLowerCase()
    .trim();
  if (!domain) return undefined;
  return IMAP_PROVIDERS.find((p) => p.emailDomains.includes(domain));
};

export const getProviderById = (id: string): ImapProvider | undefined => {
  return IMAP_PROVIDERS.find((p) => p.id === id);
};

export const getProviderByHost = (host: string): ImapProvider | undefined => {
  return IMAP_PROVIDERS.find((p) => p.host === host);
};
