// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 NexaStack, NexaSign contributors
//
// /find-documents/range — Step 2 nach Wireframe finden-zeitraum.html.
// Sechs Quick-Range-Tiles + eingeklappter "Eigener Zeitraum" + "Suche starten".
import { useEffect, useState } from 'react';

import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react';
import { Trans } from '@lingui/react/macro';
import { ChevronDownIcon, Loader2Icon, MailSearchIcon } from 'lucide-react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';

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
import { useToast } from '@nexasign/ui/primitives/use-toast';

import { Illustration } from '~/components/general/illustration';
import { appMetaTags } from '~/utils/meta';

export function meta() {
  return appMetaTags(msg`Zeitraum wählen`);
}

type Range = {
  id: string;
  label: string;
  duration: string;
  recommended?: boolean;
  /** Wieviele Monate zurück. */
  months: number;
};

const RANGES: ReadonlyArray<Range> = [
  { id: '1m', label: 'Letzter Monat', duration: 'Schnell — etwa 1 Minute', months: 1 },
  { id: '3m', label: 'Letztes Quartal', duration: 'Etwa 3 Minuten', months: 3 },
  { id: '12m', label: 'Letztes Jahr', duration: 'Etwa 10 Minuten', months: 12 },
  { id: '24m', label: 'Letzte 2 Jahre', duration: 'Etwa 20 Minuten', months: 24 },
  {
    id: '36m',
    label: 'Letzte 3 Jahre',
    duration: 'Etwa 30 Minuten — deckt alle aktiven Steuerjahre ab',
    months: 36,
    recommended: true,
  },
  {
    id: '60m',
    label: 'Letzte 5 Jahre',
    duration: 'Etwa 1 bis 2 Stunden — fürs vollständige Steuer-Nachholen',
    months: 60,
  },
];

const monthsAgo = (n: number): Date => {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  return d;
};

const StepIndicator = ({ hasSource }: { hasSource: boolean }) => (
  <nav aria-label="Fortschritt" className="flex items-center justify-between">
    <ol className="flex flex-1 items-center gap-2 text-xs text-neutral-500">
      <li className="flex flex-1 items-center gap-2">
        {hasSource ? (
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-neutral-300 text-xs font-semibold text-white">
            ✓
          </span>
        ) : (
          <span className="flex h-6 w-6 items-center justify-center rounded-full border border-neutral-300 bg-white text-xs font-semibold text-neutral-400">
            1
          </span>
        )}
        <span className={hasSource ? 'text-neutral-700' : undefined}>
          <Trans>Postfach verbinden</Trans>
        </span>
        <span className="h-px flex-1 bg-neutral-300" />
      </li>
      <li className="flex flex-1 items-center gap-2">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-neutral-900 text-xs font-semibold text-white">
          2
        </span>
        <span className="font-medium text-neutral-900">
          <Trans>Zeitraum wählen</Trans>
        </span>
        <span className="h-px flex-1 bg-neutral-200" />
      </li>
      <li className="flex items-center gap-2">
        <span className="flex h-6 w-6 items-center justify-center rounded-full border border-neutral-300 bg-white text-xs font-semibold text-neutral-400">
          3
        </span>
        <span>
          <Trans>Belege durchgehen</Trans>
        </span>
      </li>
    </ol>
  </nav>
);

export default function RangePage() {
  const { _ } = useLingui();
  const { toast } = useToast();
  const params = useParams();
  const teamUrl = params.teamUrl ?? '';
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const [searchParams] = useSearchParams();
  const sourceIdParam = searchParams.get('sourceId') ?? '';

  const { data } = trpc.discovery.findDocuments.useQuery({ status: 'all' });
  const sources = data?.sources ?? [];

  const [sourceId, setSourceId] = useState(sourceIdParam);
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState(new Date().toISOString().slice(0, 10));
  const [customOpen, setCustomOpen] = useState(false);
  // Bestaetigungs-Dialog vor Start eines Laufes — verhindert versehentliches
  // Lostriggern grosser Zeitraeume durch Fehlklick auf einer Tile.
  const [pendingRange, setPendingRange] = useState<{
    from: Date;
    to: Date;
    label: string;
    duration: string;
  } | null>(null);

  useEffect(() => {
    if (!sourceId && sources[0]) setSourceId(sources[0].id);
  }, [sources, sourceId]);

  const startMutation = trpc.sources.startSyncRun.useMutation({
    onSuccess: () => {
      toast({
        title: _(msg`Lauf gestartet`),
        description: _(
          msg`Bereits bekannte Belege werden übersprungen, neue kommen automatisch zur Trefferliste hinzu. Sie können die Seite schließen.`,
        ),
      });
      void utils.discovery.findDocuments.invalidate();
      void utils.discovery.getActiveSyncRuns.invalidate();
      void navigate(`/t/${teamUrl}/find-documents`);
    },
    onError: (err) => {
      toast({
        title: _(msg`Lauf konnte nicht gestartet werden`),
        description: err.message,
        variant: 'destructive',
      });
    },
  });

  const sourceLabel = sources.find((s) => s.id === sourceId)?.label;

  const requireSource = (): boolean => {
    if (sourceId) return true;
    toast({
      title: _(msg`Kein Postfach gewählt`),
      description: _(msg`Bitte gehen Sie zurück zu Schritt 1 und wählen Sie ein Postfach.`),
      variant: 'destructive',
    });
    return false;
  };

  const handleStartTile = (range: Range) => {
    if (!requireSource()) return;
    setPendingRange({
      from: monthsAgo(range.months),
      to: new Date(),
      label: range.label,
      duration: range.duration,
    });
  };

  const handleStartCustom = () => {
    if (!requireSource()) return;
    const f = customFrom ? new Date(`${customFrom}T00:00:00`) : null;
    const t = customTo ? new Date(`${customTo}T23:59:59`) : null;
    if (!f || !t || f >= t) {
      toast({
        title: _(msg`Zeitraum prüfen`),
        description: _(msg`Das Von-Datum muss vor dem Bis-Datum liegen.`),
        variant: 'destructive',
      });
      return;
    }
    setPendingRange({
      from: f,
      to: t,
      label: _(msg`Eigener Zeitraum`),
      duration: '',
    });
  };

  const confirmStart = () => {
    if (!pendingRange || !sourceId) {
      setPendingRange(null);
      return;
    }
    // KEIN searchTerm: serverseitiger IMAP-Textfilter wuerde sonst alles ohne
    // genau dieses Wort raus filtern — englische Invoices (Anthropic, OpenAI,
    // Stripe), aber auch deutsche „Quittung"/„Beleg"/„Zahlung" wuerden fehlen.
    // Stattdessen fetcht der Adapter alle Mails im Zeitraum, der Heuristik-
    // Klassifikator (classifyAndExtract) entscheidet danach, was Beleg ist.
    startMutation.mutate({
      sourceId,
      from: pendingRange.from,
      to: pendingRange.to,
    });
    setPendingRange(null);
  };

  const fmtDate = (d: Date) =>
    new Intl.DateTimeFormat('de-DE', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }).format(d);

  return (
    <div className="mx-auto w-full max-w-3xl space-y-8 px-4 py-10 md:px-6">
      <StepIndicator hasSource={sources.length > 0} />

      {/* Bestätigung der Verbindung. */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-neutral-200 bg-white px-4 py-3 text-sm">
        <div className="flex items-center gap-2">
          <span className="text-emerald-600">✓</span>
          {sourceLabel ? (
            <span className="text-neutral-700">
              <Trans>
                Verbunden mit <strong>{sourceLabel}</strong>
              </Trans>
            </span>
          ) : (
            <span className="text-neutral-700">
              <Trans>Wählen Sie ein verbundenes Postfach.</Trans>
            </span>
          )}
        </div>
        <Link
          to="../connect"
          className="text-sm text-neutral-600 underline-offset-4 hover:underline"
        >
          <Trans>Anderes Postfach wählen</Trans>
        </Link>
      </div>

      {sources.length > 1 && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-neutral-600">
            <Trans>Quelle:</Trans>
          </span>
          {sources.map((s) => (
            <button
              key={s.id}
              onClick={() => setSourceId(s.id)}
              className={`rounded-md border px-3 py-1 text-xs ${
                sourceId === s.id
                  ? 'border-neutral-900 bg-neutral-900 text-white'
                  : 'border-neutral-300 bg-white text-neutral-700 hover:border-neutral-400'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      )}

      <section className="flex flex-col items-start gap-6 md:flex-row md:items-center">
        <div className="flex-1">
          <h1 className="text-2xl font-bold tracking-tight md:text-3xl">
            <Trans>Wie weit zurück sollen wir gehen?</Trans>
          </h1>
          <p className="mt-2 text-base text-neutral-600">
            <Trans>
              Beim ersten Mal lohnt sich ein längerer Zeitraum — dann holen wir alles auf einmal
              nach. Spätere Läufe nehmen automatisch nur das Neue dazu.
            </Trans>
          </p>
        </div>
        <Illustration
          name="range-clock"
          alt="Zeitraum wählen"
          tone="amber"
          className="h-28 w-40 shrink-0"
          hideOnError
        />
      </section>

      <section>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {RANGES.map((r) => (
            <button
              key={r.id}
              onClick={() => handleStartTile(r)}
              disabled={startMutation.isPending || !sourceId}
              className={`flex flex-col items-start gap-1 rounded-lg p-5 text-left shadow-sm transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60 ${
                r.recommended
                  ? 'border-2 border-neutral-900 bg-white hover:shadow-md'
                  : 'border border-neutral-200 bg-white hover:border-neutral-400 hover:shadow-md'
              }`}
            >
              <div className="flex w-full items-center justify-between">
                <div className="text-base font-semibold">{r.label}</div>
                {r.recommended && (
                  <span className="rounded-sm bg-neutral-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-neutral-700">
                    <Trans>Empfohlen</Trans>
                  </span>
                )}
              </div>
              <div className="text-sm text-neutral-500">{r.duration}</div>
              {startMutation.isPending && (
                <span className="mt-1 inline-flex items-center gap-1 text-xs text-neutral-500">
                  <Loader2Icon className="h-3 w-3 animate-spin" aria-hidden />
                  <Trans>Suche wird gestartet…</Trans>
                </span>
              )}
            </button>
          ))}
        </div>

        <details
          className="mt-4 rounded-md border border-neutral-200 bg-white"
          open={customOpen}
          onToggle={(e) => setCustomOpen(e.currentTarget.open)}
        >
          <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm text-neutral-700 hover:bg-neutral-50">
            <span>
              <Trans>Lieber einen eigenen Zeitraum wählen?</Trans>
            </span>
            <ChevronDownIcon
              className="h-4 w-4 transition-transform group-open:rotate-180"
              aria-hidden
            />
          </summary>
          <div className="space-y-3 border-t border-neutral-200 p-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1.5 text-sm">
                <span className="font-medium">
                  <Trans>Von</Trans>
                </span>
                <input
                  type="date"
                  value={customFrom}
                  onChange={(e) => setCustomFrom(e.target.value)}
                  className="rounded-md border border-neutral-300 bg-white px-3 py-1.5"
                />
              </label>
              <label className="flex flex-col gap-1.5 text-sm">
                <span className="font-medium">
                  <Trans>Bis</Trans>
                </span>
                <input
                  type="date"
                  value={customTo}
                  onChange={(e) => setCustomTo(e.target.value)}
                  className="rounded-md border border-neutral-300 bg-white px-3 py-1.5"
                />
              </label>
            </div>
            <Button
              onClick={handleStartCustom}
              disabled={startMutation.isPending || !sourceId || !customFrom || !customTo}
            >
              {startMutation.isPending ? (
                <Loader2Icon className="mr-2 h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <MailSearchIcon className="mr-2 h-4 w-4" aria-hidden />
              )}
              <Trans>Mit eigenem Zeitraum starten</Trans>
            </Button>
          </div>
        </details>
      </section>

      <div className="flex items-center justify-start gap-3 border-t border-neutral-200 pt-6">
        <Link
          to="../connect"
          className="text-sm text-neutral-600 underline-offset-4 hover:underline"
        >
          <Trans>← Zurück</Trans>
        </Link>
      </div>

      {/* Bestaetigungs-Dialog vor Start. Verhindert versehentliches Triggern
          eines mehrstuendigen Mailbox-Scans bei Fehlklick auf eine Tile. */}
      <AlertDialog
        open={pendingRange !== null}
        onOpenChange={(open) => !open && setPendingRange(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              <Trans>Suche jetzt starten?</Trans>
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-3">
              {pendingRange && (
                <>
                  <span className="block">
                    <Trans>
                      NexaFile durchsucht jetzt das Postfach <strong>{sourceLabel ?? ''}</strong>{' '}
                      nach Rechnungen und Belegen — im folgenden Zeitraum:
                    </Trans>
                  </span>
                  <span className="block rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm text-neutral-800">
                    <strong className="block">{pendingRange.label}</strong>
                    <span className="text-neutral-600">
                      {fmtDate(pendingRange.from)} – {fmtDate(pendingRange.to)}
                    </span>
                    {pendingRange.duration && (
                      <span className="mt-1 block text-xs text-neutral-500">
                        {pendingRange.duration}
                      </span>
                    )}
                  </span>
                  <span className="block rounded-md border border-sky-200 bg-sky-50 p-3 text-xs text-sky-900">
                    <strong className="block">Was mit Ihren bisherigen Belegen passiert:</strong>
                    <span className="mt-1 block">
                      <Trans>
                        Bereits gefundene Belege bleiben unverändert — wir erkennen jede Mail an
                        einer eindeutigen Kennung wieder und überspringen sie. Es entstehen{' '}
                        <strong>keine Duplikate</strong>, und nichts aus dem Archiv wird gelöscht.
                        Hinzu kommen nur Mails, die wir bisher nicht gesehen haben.
                      </Trans>
                    </span>
                  </span>
                  <span className="block text-sm text-neutral-600">
                    <Trans>
                      Der Lauf läuft im Hintergrund — Sie können die Seite schließen und später
                      zurückkommen.
                    </Trans>
                  </span>
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              <Trans>Abbrechen</Trans>
            </AlertDialogCancel>
            <AlertDialogAction onClick={confirmStart}>
              <Trans>Ja, jetzt starten</Trans>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
