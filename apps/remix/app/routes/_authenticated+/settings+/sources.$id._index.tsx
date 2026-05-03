// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 NexaStack, NexaSign contributors
import { useMemo, useState } from 'react';

import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react';
import { Trans } from '@lingui/react/macro';
import {
  AlertCircleIcon,
  ArrowLeftIcon,
  CheckCircleIcon,
  Loader2Icon,
  PlayCircleIcon,
  SquareIcon,
  TrashIcon,
  XCircleIcon,
} from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router';

import { trpc } from '@nexasign/trpc/react';
import type { TSyncRun, TSyncRunStatus } from '@nexasign/trpc/server/sources-router/schema';
import { Button } from '@nexasign/ui/primitives/button';
import { Card } from '@nexasign/ui/primitives/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@nexasign/ui/primitives/dialog';
import { Input } from '@nexasign/ui/primitives/input';
import { Label } from '@nexasign/ui/primitives/label';
import { Skeleton } from '@nexasign/ui/primitives/skeleton';
import { useToast } from '@nexasign/ui/primitives/use-toast';

import { SettingsHeader } from '~/components/general/settings-header';
import { appMetaTags } from '~/utils/meta';

export function meta() {
  return appMetaTags(msg`Quelle`);
}

const formatDateTime = (date: Date | null, locale: string): string => {
  if (!date) return '–';
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
};

const formatDateRange = (from: Date, to: Date, locale: string): string => {
  const fmt = new Intl.DateTimeFormat(locale, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
  return `${fmt.format(from)} – ${fmt.format(to)}`;
};

const toIsoDate = (d: Date): string => d.toISOString().slice(0, 10);

// Schnellauswahl-Buttons. Liefert [from, to] in lokaler Zeit, danach in UTC ohne
// Drift, weil wir die Range als reine Datums-Eingabe verstehen.
const buildPreset = (
  preset: 'last-month' | 'last-quarter' | 'last-year' | 'previous-year',
): { from: Date; to: Date } => {
  const now = new Date();
  if (preset === 'last-month') {
    const from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const to = new Date(now.getFullYear(), now.getMonth(), 1);
    return { from, to };
  }
  if (preset === 'last-quarter') {
    const startMonth = Math.floor(now.getMonth() / 3) * 3 - 3;
    const from = new Date(now.getFullYear(), startMonth, 1);
    const to = new Date(now.getFullYear(), startMonth + 3, 1);
    return { from, to };
  }
  if (preset === 'last-year') {
    const from = new Date(now.getFullYear() - 1, 0, 1);
    const to = new Date(now.getFullYear(), 0, 1);
    return { from, to };
  }
  // previous-year
  const from = new Date(now.getFullYear() - 2, 0, 1);
  const to = new Date(now.getFullYear() - 1, 0, 1);
  return { from, to };
};

const SyncRunStatusIcon = ({ status }: { status: TSyncRunStatus }) => {
  if (status === 'RUNNING' || status === 'PENDING') {
    return <Loader2Icon className="h-4 w-4 flex-shrink-0 animate-spin text-primary" aria-hidden />;
  }
  if (status === 'SUCCESS') {
    return <CheckCircleIcon className="h-4 w-4 flex-shrink-0 text-green-600" aria-hidden />;
  }
  if (status === 'CANCELLED') {
    return <SquareIcon className="h-4 w-4 flex-shrink-0 text-muted-foreground" aria-hidden />;
  }
  return <XCircleIcon className="h-4 w-4 flex-shrink-0 text-destructive" aria-hidden />;
};

const SyncRunRow = ({
  run,
  locale,
  onCancel,
  isCancelling,
}: {
  run: TSyncRun;
  locale: string;
  onCancel: (id: string) => void;
  isCancelling: boolean;
}) => {
  const isActive = run.status === 'PENDING' || run.status === 'RUNNING';
  return (
    <Card className="flex items-start justify-between gap-3 p-3 text-sm">
      <div className="flex min-w-0 items-start gap-2">
        <SyncRunStatusIcon status={run.status} />
        <div className="min-w-0">
          <p className="font-medium">{formatDateRange(run.rangeFrom, run.rangeTo, locale)}</p>
          {run.status === 'SUCCESS' || run.status === 'CANCELLED' || isActive ? (
            <p className="text-xs text-muted-foreground">
              <Trans>
                {run.documentsAuto} importiert, {run.documentsManual} manuell,{' '}
                {run.documentsIgnored} ignoriert · {run.mailsChecked} Mails geprüft
              </Trans>
            </p>
          ) : null}
          {run.status === 'FAILED' && run.errorMessage && (
            <p className="text-xs text-destructive">{run.errorMessage}</p>
          )}
          <p className="mt-0.5 text-xs text-muted-foreground">
            {isActive ? (
              <Trans>Gestartet {formatDateTime(run.startedAt, locale)}</Trans>
            ) : (
              <Trans>Beendet {formatDateTime(run.finishedAt, locale)}</Trans>
            )}
          </p>
        </div>
      </div>
      {isActive && (
        <Button
          variant="ghost"
          size="sm"
          disabled={isCancelling || run.cancelRequested}
          onClick={() => onCancel(run.id)}
        >
          {run.cancelRequested ? <Trans>Wird abgebrochen…</Trans> : <Trans>Abbrechen</Trans>}
        </Button>
      )}
    </Card>
  );
};

export default function SettingsSourceDetail() {
  const params = useParams();
  const sourceId = params.id ?? '';
  const navigate = useNavigate();
  const { _, i18n } = useLingui();
  const { toast } = useToast();

  const utils = trpc.useUtils();
  const { data: sources, isLoading } = trpc.sources.listSources.useQuery();
  const source = sources?.find((s) => s.id === sourceId);

  const { data: runs } = trpc.sources.listSyncRuns.useQuery(
    { sourceId, limit: 10 },
    {
      enabled: Boolean(sourceId && source),
      // Pollt alle 3 Sekunden, solange ein Lauf RUNNING/PENDING ist.
      refetchInterval: (query) => {
        const items = query.state.data ?? [];
        return items.some((r) => r.status === 'RUNNING' || r.status === 'PENDING') ? 3000 : false;
      },
    },
  );

  const activeRun = useMemo(
    () => runs?.find((r) => r.status === 'RUNNING' || r.status === 'PENDING') ?? null,
    [runs],
  );

  const [from, setFrom] = useState<string>('');
  const [to, setTo] = useState<string>('');

  const applyPreset = (preset: 'last-month' | 'last-quarter' | 'last-year' | 'previous-year') => {
    const range = buildPreset(preset);
    setFrom(toIsoDate(range.from));
    setTo(toIsoDate(range.to));
  };

  const test = trpc.sources.testSource.useMutation({
    onSuccess: (result) => {
      toast({
        title: result.ok ? _(msg`Verbindung erfolgreich`) : _(msg`Verbindung fehlgeschlagen`),
        description: result.error,
        variant: result.ok ? 'default' : 'destructive',
      });
    },
    onError: (err) =>
      toast({
        title: _(msg`Test fehlgeschlagen`),
        description: err.message,
        variant: 'destructive',
      }),
  });

  const startSyncRun = trpc.sources.startSyncRun.useMutation({
    onSuccess: () => {
      void utils.sources.listSyncRuns.invalidate();
      void utils.sources.listSources.invalidate();
      void utils.discovery.findDocuments.invalidate();
      toast({
        title: _(msg`Sync-Lauf gestartet`),
        description: _(msg`Der Fortschritt wird unten angezeigt.`),
      });
      setFrom('');
      setTo('');
    },
    onError: (err) =>
      toast({
        title: _(msg`Sync-Lauf konnte nicht starten`),
        description: err.message,
        variant: 'destructive',
      }),
  });

  const cancelSyncRun = trpc.sources.cancelSyncRun.useMutation({
    onSuccess: () => {
      void utils.sources.listSyncRuns.invalidate();
      toast({ title: _(msg`Abbruch wird ausgeführt`) });
    },
    onError: (err) =>
      toast({
        title: _(msg`Abbruch fehlgeschlagen`),
        description: err.message,
        variant: 'destructive',
      }),
  });

  const reactivate = trpc.sources.reactivateSource.useMutation({
    onSuccess: () => {
      void utils.sources.listSources.invalidate();
      toast({ title: _(msg`Quelle reaktiviert`) });
    },
    onError: (err) =>
      toast({
        title: _(msg`Reaktivieren fehlgeschlagen`),
        description: err.message,
        variant: 'destructive',
      }),
  });

  const remove = trpc.sources.deleteSource.useMutation({
    onSuccess: () => {
      void utils.sources.listSources.invalidate();
      void utils.discovery.findDocuments.invalidate();
      toast({ title: _(msg`Quelle entfernt`) });
      void navigate('/settings/sources');
    },
    onError: (err) =>
      toast({
        title: _(msg`Entfernen fehlgeschlagen`),
        description: err.message,
        variant: 'destructive',
      }),
  });

  if (isLoading) {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (!source) {
    return (
      <Card className="flex flex-col items-center gap-3 p-12 text-center">
        <AlertCircleIcon className="h-10 w-10 text-muted-foreground" aria-hidden />
        <div>
          <h2 className="text-lg font-semibold">
            <Trans>Quelle nicht gefunden</Trans>
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            <Trans>Diese Quelle existiert nicht oder wurde gelöscht.</Trans>
          </p>
        </div>
        <Button asChild variant="outline">
          <Link to="/settings/sources">
            <ArrowLeftIcon className="mr-2 h-4 w-4" aria-hidden />
            <Trans>Zurück zur Liste</Trans>
          </Link>
        </Button>
      </Card>
    );
  }

  const isSuspended = source.lastSyncStatus === 'SUSPENDED';
  const canStartRun = !isSuspended && !activeRun && from && to && !startSyncRun.isPending;

  return (
    <div>
      <SettingsHeader
        title={source.label}
        subtitle={_(msg`IMAP-Konto · Belege fließen in Team „${source.teamName}"`)}
      >
        <Button asChild variant="ghost" size="sm">
          <Link to="/settings/sources">
            <ArrowLeftIcon className="mr-2 h-4 w-4" aria-hidden />
            <Trans>Alle Quellen</Trans>
          </Link>
        </Button>
      </SettingsHeader>

      {isSuspended && (
        <Card className="mt-6 flex flex-wrap items-center justify-between gap-3 border-destructive bg-destructive/5 p-4">
          <div className="text-sm text-destructive">
            <p className="font-semibold">
              <Trans>Diese Quelle ist gesperrt.</Trans>
            </p>
            <p className="mt-1">
              <Trans>
                Drei aufeinanderfolgende Login-Fehler. Bitte Zugangsdaten prüfen und reaktivieren.
              </Trans>
            </p>
            {source.lastSyncError && <p className="mt-1 text-xs">{source.lastSyncError}</p>}
          </div>
          <Button
            variant="outline"
            disabled={reactivate.isPending}
            onClick={() => reactivate.mutate({ sourceId: source.id })}
          >
            {reactivate.isPending && (
              <Loader2Icon className="mr-2 h-4 w-4 animate-spin" aria-hidden />
            )}
            <Trans>Reaktivieren</Trans>
          </Button>
        </Card>
      )}

      {/* Sync-Lauf starten */}
      <Card className="mt-6 p-6">
        <h2 className="text-base font-semibold">
          <Trans>Neuen Sync-Lauf starten</Trans>
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          <Trans>
            Wählen Sie einen Zeitraum aus. Belege aus diesem Zeitraum werden geprüft und in den
            Eingang importiert. Bereits importierte Belege werden automatisch übersprungen.
          </Trans>
        </p>

        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => applyPreset('last-month')}>
            <Trans>Letzter Monat</Trans>
          </Button>
          <Button variant="outline" size="sm" onClick={() => applyPreset('last-quarter')}>
            <Trans>Letztes Quartal</Trans>
          </Button>
          <Button variant="outline" size="sm" onClick={() => applyPreset('last-year')}>
            <Trans>Letztes Jahr</Trans>
          </Button>
          <Button variant="outline" size="sm" onClick={() => applyPreset('previous-year')}>
            <Trans>Vorletztes Jahr</Trans>
          </Button>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <Label htmlFor="sync-from">
              <Trans>Von</Trans>
            </Label>
            <Input
              id="sync-from"
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="sync-to">
              <Trans>Bis</Trans>
            </Label>
            <Input id="sync-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={test.isPending}
            onClick={() => test.mutate({ sourceId: source.id })}
          >
            {test.isPending ? (
              <Loader2Icon className="mr-2 h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <PlayCircleIcon className="mr-2 h-4 w-4" aria-hidden />
            )}
            <Trans>Verbindung testen</Trans>
          </Button>

          <Button
            disabled={!canStartRun}
            onClick={() => {
              // Backend behandelt `to` als exklusive obere Grenze. Im UI heißt
              // das Feld „Bis" (inklusiv), daher hier +1 Tag draufrechnen — sonst
              // würde der gewählte letzte Tag aus der Range fallen.
              const toExclusive = new Date(`${to}T00:00:00`);
              toExclusive.setDate(toExclusive.getDate() + 1);
              startSyncRun.mutate({
                sourceId: source.id,
                from: new Date(`${from}T00:00:00`),
                to: toExclusive,
              });
            }}
          >
            {startSyncRun.isPending && (
              <Loader2Icon className="mr-2 h-4 w-4 animate-spin" aria-hidden />
            )}
            <Trans>Belege ziehen</Trans>
          </Button>
        </div>

        {activeRun && (
          <p className="mt-3 text-xs text-amber-600">
            <Trans>
              Es läuft bereits ein Sync für diese Quelle. Bitte warten oder oben abbrechen.
            </Trans>
          </p>
        )}
      </Card>

      {/* Run-History */}
      <div className="mt-6">
        <h2 className="text-base font-semibold">
          <Trans>Vergangene Sync-Läufe</Trans>
        </h2>
        <div className="mt-2 flex flex-col gap-2">
          {!runs && (
            <>
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </>
          )}
          {runs && runs.length === 0 && (
            <Card className="p-4 text-sm text-muted-foreground">
              <Trans>Noch keine Sync-Läufe. Starten Sie oben einen Lauf.</Trans>
            </Card>
          )}
          {runs?.map((run) => (
            <SyncRunRow
              key={run.id}
              run={run}
              locale={i18n.locale}
              onCancel={(id) => cancelSyncRun.mutate({ syncRunId: id })}
              isCancelling={cancelSyncRun.isPending}
            />
          ))}
        </div>
      </div>

      {/* Konto-Aktionen */}
      <div className="mt-8 flex flex-wrap justify-end gap-2 border-t pt-4">
        <Dialog>
          <DialogTrigger asChild>
            <Button variant="destructive">
              <TrashIcon className="mr-2 h-4 w-4" aria-hidden />
              <Trans>Quelle entfernen</Trans>
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                <Trans>Quelle wirklich entfernen?</Trans>
              </DialogTitle>
              <DialogDescription>
                <Trans>
                  Bereits importierte Belege bleiben erhalten. Neue Belege werden ab sofort nicht
                  mehr eingelesen.
                </Trans>
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                variant="destructive"
                disabled={remove.isPending}
                onClick={() => remove.mutate({ sourceId: source.id })}
              >
                {remove.isPending && (
                  <Loader2Icon className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                )}
                <Trans>Endgültig entfernen</Trans>
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
