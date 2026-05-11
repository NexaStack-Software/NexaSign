// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 NexaStack, NexaSign contributors
import { Trans } from '@lingui/react/macro';
import { AlertTriangleIcon, ArrowRightIcon } from 'lucide-react';
import { Link } from 'react-router';

import type { TFindDiscoveryDocumentsResponse } from '@nexasign/trpc/server/discovery-router/schema';
import { Card } from '@nexasign/ui/primitives/card';

const SUSPICIOUSLY_LOW_MAILS = 1000;
const RELEVANT_RANGE_DAYS = 60;
const DAY_MS = 24 * 60 * 60 * 1000;

const isGmailHost = (host: string | null | undefined): boolean => {
  if (!host) return false;
  const lower = host.toLowerCase();
  return lower === 'imap.gmail.com' || lower.endsWith('.gmail.com') || lower === 'gmail.com';
};

type Source = TFindDiscoveryDocumentsResponse['sources'][number];

const isSuspectGmailSource = (s: Source): boolean => {
  if (!isGmailHost(s.host)) return false;
  const mailsChecked = s.lastSuccessfulSyncMailsChecked ?? null;
  const from = s.lastSuccessfulSyncRangeFrom ?? null;
  const to = s.lastSuccessfulSyncRangeTo ?? null;
  if (mailsChecked === null || from === null || to === null) return false;
  if (mailsChecked >= SUSPICIOUSLY_LOW_MAILS) return false;
  const rangeDays = (to.getTime() - from.getTime()) / DAY_MS;
  return rangeDays >= RELEVANT_RANGE_DAYS;
};

type Props = {
  sources: ReadonlyArray<Source>;
};

/**
 * Warn-Banner fuer Gmail-Sources, deren letzter Lauf verdaechtig wenig Mails
 * geprueft hat (typisch: nur INBOX, kein „Alle Nachrichten" in IMAP exposed).
 *
 * Trigger-Logik bewusst konservativ: nur wenn Range > 60 Tage UND mailsChecked
 * < 1000 — sonst false positives bei frischen Konten oder kurzen Test-Laeufen.
 */
export const GmailAllMailBanner = ({ sources }: Props) => {
  const suspect = sources.find(isSuspectGmailSource);
  if (!suspect) return null;

  return (
    <Card className="border-amber-300 bg-amber-50 p-4">
      <div className="flex items-start gap-3">
        <AlertTriangleIcon className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-amber-900">
            <Trans>Möglicher Gmail-Konfigurationsfehler bei „{suspect.label}"</Trans>
          </p>
          <p className="mt-1 text-sm text-amber-900">
            <Trans>
              Der letzte Lauf hat über{' '}
              {Math.round(
                ((suspect.lastSuccessfulSyncRangeTo?.getTime() ?? 0) -
                  (suspect.lastSuccessfulSyncRangeFrom?.getTime() ?? 0)) /
                  DAY_MS,
              )}{' '}
              Tage nur {suspect.lastSuccessfulSyncMailsChecked} Mails geprüft. Das ist deutlich
              weniger als bei einem Gmail-Konto zu erwarten — höchstwahrscheinlich ist „Alle
              Nachrichten" in Ihren Gmail-IMAP-Einstellungen nicht freigegeben. NexaFile sieht dann
              nur die Mails, die jetzt noch in Ihrem Posteingang liegen, und übersieht alles, was
              Sie in Gmail schon einmal archiviert haben (= meistens den Großteil Ihrer Belege).
            </Trans>
          </p>
          <p className="mt-3">
            <Link
              to={`/settings/sources/${suspect.id}`}
              className="inline-flex items-center gap-1 text-sm font-medium text-amber-900 underline-offset-4 hover:underline"
            >
              <Trans>Folder-Diagnose öffnen und Anleitung anzeigen</Trans>
              <ArrowRightIcon className="h-3.5 w-3.5" aria-hidden />
            </Link>
          </p>
        </div>
      </div>
    </Card>
  );
};
