// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 NexaStack, NexaSign contributors
import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react';
import { Trans } from '@lingui/react/macro';
import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  CircleSlashIcon,
  FolderIcon,
  Loader2Icon,
  RefreshCwIcon,
} from 'lucide-react';

import { trpc } from '@nexasign/trpc/react';
import { Button } from '@nexasign/ui/primitives/button';
import { Card } from '@nexasign/ui/primitives/card';

type Props = {
  sourceId: string;
  /** Wird unter dem Card-Titel angezeigt — z. B. „IMAP-Konto · Gmail". */
  subtitle?: React.ReactNode;
};

/**
 * Folder-Diagnose-Card. Zeigt die rohe IMAP-Folder-Liste eines Accounts und
 * markiert, welche Folder der Sync-Adapter wirklich scannen würde.
 *
 * Zweck: Gmail-User stossen visuell darauf, dass „[Gmail]/Alle Nachrichten"
 * fehlt — sonst sieht NexaFile nur die INBOX und das ganze archivierte
 * Beleg-Archiv bleibt unsichtbar. Die Card ruft `inspectImapFolders` lazy auf
 * (Connect zur Mailbox kostet Zeit), nur nach Klick auf „Diagnose starten".
 */
export const FolderDiagnosticsCard = ({ sourceId, subtitle }: Props) => {
  const { _ } = useLingui();

  const inspectMutation = trpc.sources.inspectImapFolders.useMutation();
  const data = inspectMutation.data;

  const hasGmailWarning = data && data.isGmailHost && !data.gmailAllMailVisible;

  return (
    <Card className="mt-6 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold">
            <Trans>IMAP-Folder-Diagnose</Trans>
          </h2>
          {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
          <p className="mt-1 text-sm text-muted-foreground">
            <Trans>
              Welche Folder gibt Ihr Postfach via IMAP frei, und welche scannt NexaFile beim Sync?
              Wenn das Archiv hier nicht auftaucht, finden wir nur die aktuell ungelesenen Mails.
            </Trans>
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={inspectMutation.isPending}
          onClick={() => inspectMutation.mutate({ sourceId })}
        >
          {inspectMutation.isPending ? (
            <Loader2Icon className="mr-2 h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <RefreshCwIcon className="mr-2 h-4 w-4" aria-hidden />
          )}
          {data ? <Trans>Erneut prüfen</Trans> : <Trans>Diagnose starten</Trans>}
        </Button>
      </div>

      {inspectMutation.isError && (
        <div className="mt-4 flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          <AlertTriangleIcon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <div>
            <p className="font-medium">
              <Trans>Verbindung fehlgeschlagen</Trans>
            </p>
            <p className="mt-1 text-xs">{inspectMutation.error?.message}</p>
          </div>
        </div>
      )}

      {hasGmailWarning && (
        <div className="mt-4 rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <div className="flex items-start gap-2">
            <AlertTriangleIcon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <div className="min-w-0">
              <p className="font-semibold">
                <Trans>
                  Achtung: „Alle Nachrichten" ist in Ihrem Gmail nicht für IMAP freigegeben
                </Trans>
              </p>
              <p className="mt-1">
                <Trans>
                  Damit sieht NexaFile nur die Mails, die jetzt noch in Ihrem Posteingang liegen.
                  Alles, was Sie in Gmail schon einmal archiviert haben — und das sind in der Regel
                  die meisten Ihrer Belege — bleibt unsichtbar.
                </Trans>
              </p>
              <ol className="mt-3 list-decimal space-y-1 pl-5 text-amber-900">
                <li>
                  <Trans>Gmail öffnen → Zahnrad oben rechts → „Alle Einstellungen anzeigen"</Trans>
                </li>
                <li>
                  <Trans>
                    Tab „Weiterleitung und POP/IMAP" → „Größenbeschränkung der Ordner": „nicht
                    beschränken (Standard)" wählen
                  </Trans>
                </li>
                <li>
                  <Trans>
                    Tab „Labels" → Reihe „Alle Nachrichten" → Spalte „In IMAP anzeigen" anhaken
                  </Trans>
                </li>
                <li>
                  <Trans>„Änderungen speichern" → in NexaFile neuen Lauf starten</Trans>
                </li>
              </ol>
            </div>
          </div>
        </div>
      )}

      {data && (
        <div className="mt-4 space-y-3">
          <div className="flex items-center gap-3 text-sm">
            <span className="font-medium text-foreground">
              <Trans>
                Gescannt: {data.scannedPaths.length} von {data.folders.length} Foldern
              </Trans>
            </span>
            {data.isGmailHost && (
              <span
                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ${
                  data.gmailAllMailVisible
                    ? 'bg-emerald-100 text-emerald-800'
                    : 'bg-amber-100 text-amber-900'
                }`}
              >
                {data.gmailAllMailVisible ? (
                  <>
                    <CheckCircle2Icon className="h-3 w-3" aria-hidden />
                    <Trans>„Alle Nachrichten" freigegeben</Trans>
                  </>
                ) : (
                  <>
                    <CircleSlashIcon className="h-3 w-3" aria-hidden />
                    <Trans>„Alle Nachrichten" fehlt</Trans>
                  </>
                )}
              </span>
            )}
          </div>

          <ul className="divide-y divide-border rounded-md border bg-muted/20 text-sm">
            {data.folders.map((f) => (
              <li
                key={f.path}
                className="flex items-center gap-3 px-3 py-2"
                title={f.specialUse ? `Special-Use: ${f.specialUse}` : undefined}
              >
                {f.scanned ? (
                  <CheckCircle2Icon
                    className="h-4 w-4 shrink-0 text-emerald-600"
                    aria-label={_(msg`Wird gescannt`)}
                  />
                ) : (
                  <FolderIcon
                    className="h-4 w-4 shrink-0 text-muted-foreground"
                    aria-label={_(msg`Wird nicht gescannt`)}
                  />
                )}
                <span
                  className={`flex-1 truncate ${
                    f.scanned ? 'font-medium text-foreground' : 'text-muted-foreground'
                  }`}
                >
                  {f.path}
                </span>
                {f.specialUse && (
                  <span className="rounded-sm bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                    {f.specialUse}
                  </span>
                )}
                {f.scanned && (
                  <span className="rounded-sm bg-emerald-100 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-emerald-800">
                    <Trans>aktiv</Trans>
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
};
