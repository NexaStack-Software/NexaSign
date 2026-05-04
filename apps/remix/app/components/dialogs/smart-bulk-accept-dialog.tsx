// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 NexaStack, NexaSign contributors
import { useState } from 'react';

import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react';
import { Trans } from '@lingui/react/macro';
import { CheckCircle2Icon, Loader2Icon, SparklesIcon, ZapIcon } from 'lucide-react';

import { trpc } from '@nexasign/trpc/react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@nexasign/ui/primitives/alert-dialog';
import { Button } from '@nexasign/ui/primitives/button';
import { Card } from '@nexasign/ui/primitives/card';
import { useToast } from '@nexasign/ui/primitives/use-toast';

type Props = {
  /** Vor-Auswahl: nur Belege aus dieser Quelle akzeptieren. null = alle. */
  defaultSourceId?: string | null;
  /** Vor-Auswahl: nur Belege aus diesem Jahr. null = alle. */
  defaultYear?: number | null;
  locale: string;
  /** Optional: Trigger anpassen (z. B. ghost-Variante in der Wow-Card). */
  triggerLabel?: React.ReactNode;
  /** Trigger-Variante. */
  triggerVariant?: 'default' | 'outline' | 'secondary';
  triggerSize?: 'sm' | 'default';
};

/**
 * Smart-Bulk-Accept-Dialog. Zeigt der Persona, was genau auf einen Klick
 * akzeptiert werden würde — Anzahl, Aufschlüsselung pro Quelle, ein paar
 * Beispiel-Belege — und führt die Akzeptanz dann via tRPC-Mutation aus.
 *
 * Strategie: Server entscheidet, welche Belege „vollständig" sind
 * (Anhang + Betrag + Korrespondent + nicht akzeptiert). Frontend zeigt
 * nur an. Damit ist die Definition zentral änderbar.
 */
export const SmartBulkAcceptDialog = ({
  defaultSourceId,
  defaultYear,
  locale,
  triggerLabel,
  triggerVariant = 'default',
  triggerSize = 'sm',
}: Props) => {
  const { _ } = useLingui();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);

  const utils = trpc.useUtils();

  const candidates = trpc.discovery.getSmartAcceptCandidates.useQuery(
    {
      sourceId: defaultSourceId ?? undefined,
      year: defaultYear ?? undefined,
    },
    {
      enabled: open,
    },
  );

  const bulkAccept = trpc.discovery.bulkAccept.useMutation({
    onSuccess: (result) => {
      toast({
        title: _(msg`${result.acceptedCount} Belege akzeptiert`),
        description:
          result.skippedIds.length > 0
            ? _(
                msg`${result.skippedIds.length} bereits akzeptiert oder nicht eligibel — übersprungen.`,
              )
            : _(msg`Alle Kandidaten wurden in das Steuerpaket übernommen.`),
      });
      void utils.discovery.findDocuments.invalidate();
      void utils.discovery.getOverview.invalidate();
      void utils.discovery.getSmartAcceptCandidates.invalidate();
      setOpen(false);
    },
    onError: (err) => {
      toast({
        title: _(msg`Bulk-Akzeptieren fehlgeschlagen`),
        description: err.message,
        variant: 'destructive',
      });
    },
  });

  const data = candidates.data;
  const handleConfirm = () => {
    if (!data || data.totalCount === 0) return;
    bulkAccept.mutate({ ids: data.allIds });
  };

  const dateFmt = new Intl.DateTimeFormat(locale, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
  const numberFmt = new Intl.NumberFormat(locale);

  return (
    <>
      <Button size={triggerSize} variant={triggerVariant} onClick={() => setOpen(true)}>
        <ZapIcon className="mr-1.5 h-4 w-4" aria-hidden />
        {triggerLabel ?? <Trans>Vollständige Belege auf einen Klick akzeptieren</Trans>}
      </Button>

      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent className="max-w-xl">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <SparklesIcon className="h-5 w-5 text-primary" aria-hidden />
              <Trans>Vollständige Belege auf einen Klick</Trans>
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <span className="block">
                <Trans>
                  Wir akzeptieren in einem Rutsch alle Belege, bei denen wir uns sicher sind: Anhang
                  vorhanden, Betrag erkannt, Absender erkannt — und natürlich noch nicht akzeptiert.
                </Trans>
              </span>
              <span className="block text-amber-700 dark:text-amber-400">
                <Trans>
                  Achtung: Akzeptierte Belege unterliegen der 10-jährigen GoBD-Aufbewahrung und
                  können danach nur noch archiviert, nicht mehr ignoriert werden.
                </Trans>
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>

          {candidates.isLoading && (
            <div className="flex items-center justify-center py-6">
              <Loader2Icon className="h-5 w-5 animate-spin text-muted-foreground" aria-hidden />
            </div>
          )}

          {data && data.totalCount === 0 && (
            <Card className="bg-muted/30 p-4 text-center text-sm">
              <Trans>
                Aktuell gibt es keine Belege, die als „vollständig" gelten. Geh die offenen Belege
                manuell durch — vielleicht fehlt nur der Betrag oder der Absender, und du kannst das
                im Schnell-Review nachtragen.
              </Trans>
            </Card>
          )}

          {data && data.totalCount > 0 && (
            <div className="space-y-3">
              <div className="rounded-md border border-primary/30 bg-primary/5 p-3">
                <p className="text-2xl font-semibold">
                  {numberFmt.format(data.totalCount)}{' '}
                  <span className="text-base font-normal text-muted-foreground">
                    <Trans>Belege werden akzeptiert</Trans>
                  </span>
                </p>
                {data.groupedBySource.length > 1 && (
                  <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    {data.groupedBySource.map((g) => (
                      <li key={g.sourceId ?? '__local__'}>
                        {g.sourceLabel ?? _(msg`Lokale Uploads`)}: {numberFmt.format(g.count)}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div>
                <p className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">
                  <Trans>Beispiele (erste {Math.min(data.sampleDocuments.length, 20)})</Trans>
                </p>
                <ul className="max-h-44 space-y-1 overflow-y-auto rounded-md border bg-muted/30 p-2 text-xs">
                  {data.sampleDocuments.map((d) => (
                    <li
                      key={d.id}
                      className="flex items-center justify-between gap-2 border-b border-border/50 py-1 last:border-b-0"
                    >
                      <span className="flex min-w-0 flex-1 items-center gap-1.5">
                        <CheckCircle2Icon
                          className="h-3 w-3 flex-shrink-0 text-emerald-600"
                          aria-hidden
                        />
                        <span className="truncate" title={d.title}>
                          {d.correspondent ?? d.title}
                        </span>
                      </span>
                      <span className="flex flex-shrink-0 items-center gap-2 tabular-nums text-muted-foreground">
                        {d.detectedAmount && <span>{d.detectedAmount}</span>}
                        {d.documentDate && <span>{dateFmt.format(d.documentDate)}</span>}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          <AlertDialogFooter>
            <AlertDialogCancel disabled={bulkAccept.isPending}>
              <Trans>Abbrechen</Trans>
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirm}
              disabled={!data || data.totalCount === 0 || bulkAccept.isPending}
            >
              {bulkAccept.isPending && (
                <Loader2Icon className="mr-2 h-4 w-4 animate-spin" aria-hidden />
              )}
              <Trans>
                {data ? `${numberFmt.format(data.totalCount)} akzeptieren` : 'Akzeptieren'}
              </Trans>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};
