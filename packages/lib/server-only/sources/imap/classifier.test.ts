// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 NexaStack, NexaSign contributors

import { describe, expect, it } from 'vitest';

import { classifyAndExtract, classifyMail, extractAmount, extractInvoiceNumber } from './classifier';

describe('classifyMail', () => {
  it('AUTO bei bekanntem Beleg-Sender mit PDF', () => {
    expect(
      classifyMail({
        senderDomain: 'hetzner.com',
        subject: 'Ihre Rechnung',
        bodyText: 'Anbei Rechnung',
        hasPdfAttachment: true,
      }),
    ).toBe('AUTO');
  });

  it('AUTO bei unbekanntem Sender mit Beleg-Keyword + PDF', () => {
    expect(
      classifyMail({
        senderDomain: 'unbekannt.de',
        subject: 'Rechnung Nr 12345',
        bodyText: 'Anbei',
        hasPdfAttachment: true,
      }),
    ).toBe('AUTO');
  });

  it('MANUAL bei Beleg-Hinweis ohne PDF', () => {
    expect(
      classifyMail({
        senderDomain: 'telekom.de',
        subject: 'Ihre Rechnung steht im Kundenportal bereit',
        bodyText: 'Bitte einloggen',
        hasPdfAttachment: false,
      }),
    ).toBe('MANUAL');
  });

  it('IGNORE bei reiner Werbung', () => {
    expect(
      classifyMail({
        senderDomain: 'newsletter.de',
        subject: 'Sale 50% off',
        bodyText: 'Jetzt zugreifen!',
        hasPdfAttachment: false,
      }),
    ).toBe('IGNORE');
  });

  it('Bekannter Sender überstimmt Werbe-Keyword', () => {
    expect(
      classifyMail({
        senderDomain: 'amazon.de',
        subject: 'Ihre Rechnung — 20% Rabatt im nächsten Einkauf',
        bodyText: '',
        hasPdfAttachment: true,
      }),
    ).toBe('AUTO');
  });

  it('Subdomain bekannter Sender wird erkannt', () => {
    expect(
      classifyMail({
        senderDomain: 'noreply.stripe.com',
        subject: 'Receipt',
        bodyText: '',
        hasPdfAttachment: true,
      }),
    ).toBe('AUTO');
  });
});

describe('extractAmount', () => {
  it('erkennt EUR-Beträge mit Dezimalkomma', () => {
    expect(extractAmount('Gesamt: 19,99 EUR')).toBe('19,99 EUR');
  });

  it('erkennt USD-Beträge mit $ vorne', () => {
    expect(extractAmount('Total: $1,234.56')).toBe('1,234.56 USD');
  });

  it('erkennt Euro-Symbol vor Betrag', () => {
    expect(extractAmount('€ 99,00')).toBe('99,00 EUR');
  });

  it('null wenn nichts matched', () => {
    expect(extractAmount('Hallo Welt')).toBe(null);
  });

  it('waehlt den groessten Betrag (typisch Brutto-Gesamtbetrag)', () => {
    // Reale Hetzner-/Stripe-/Telekom-Mails listen Netto + MwSt + Gesamt
    // separat. Der Steuerberater braucht den Gesamtbetrag, nicht den Netto.
    const body = 'Netto: 19,99 EUR\nMwSt: 3,80 EUR\nGesamt: 23,79 EUR';
    expect(extractAmount(body)).toBe('23,79 EUR');
  });

  it('respektiert Tausender-Punkte beim Vergleich', () => {
    const body = 'Anzahlung: 250,00 EUR\nGesamt: 1.234,50 EUR';
    expect(extractAmount(body)).toBe('1.234,50 EUR');
  });
});

describe('extractInvoiceNumber', () => {
  it('erkennt Rechnungs-Nr', () => {
    expect(extractInvoiceNumber('Rechnungs-Nr: ABC-12345')).toBe('ABC-12345');
  });

  it('erkennt Invoice no', () => {
    expect(extractInvoiceNumber('Invoice no INV/2024/789')).toBe('INV/2024/789');
  });

  it('null wenn nichts matched', () => {
    expect(extractInvoiceNumber('Hallo Welt')).toBe(null);
  });
});

describe('classifyAndExtract', () => {
  it('extrahiert keine Felder bei IGNORE', () => {
    const result = classifyAndExtract({
      senderDomain: 'spam.com',
      subject: 'Tolle Angebote',
      bodyText: 'sale 99,99 EUR',
      hasPdfAttachment: false,
    });
    expect(result.verdict).toBe('IGNORE');
    expect(result.detectedAmount).toBe(null);
    expect(result.detectedInvoiceNumber).toBe(null);
  });

  it('extrahiert strukturierte Felder bei AUTO', () => {
    const result = classifyAndExtract({
      senderDomain: 'hetzner.com',
      subject: 'Rechnung R-2024-001',
      bodyText: 'Gesamtbetrag: 49,90 EUR. Rechnungs-Nr: R-2024-001',
      hasPdfAttachment: true,
    });
    expect(result.verdict).toBe('AUTO');
    expect(result.detectedAmount).toBe('49,90 EUR');
    expect(result.detectedInvoiceNumber).toBe('R-2024-001');
  });

  it('extrahiert portalHint nur bei MANUAL', () => {
    const result = classifyAndExtract({
      senderDomain: 'telekom.de',
      subject: 'Rechnung verfügbar',
      bodyText: 'Bitte einloggen unter mein-portal.de',
      hasPdfAttachment: false,
    });
    expect(result.verdict).toBe('MANUAL');
    expect(result.portalHint).toContain('einloggen unter');
  });
});
