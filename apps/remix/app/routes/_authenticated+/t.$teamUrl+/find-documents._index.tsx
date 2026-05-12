// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 NexaStack, NexaSign contributors
//
// /find-documents — Wireframe-konforme Trefferliste (finden-ergebnisse.html).
// Zeigt ausschliesslich Eingangs-Belege (status='inbox' + 'pending-manual').
// Per-Zeile merkt der Nutzer Entscheidungen client-seitig vor; der echte
// Commit passiert ueber "Bestätigen" oder explizite Sofort-Aktionen im Prüfmodus.
// Andere Status-Stages (Im Archiv, Endgültig archiviert) liegen unter /archiv.
import { useEffect, useMemo, useRef, useState } from 'react';

import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react';
import { Trans } from '@lingui/react/macro';
import {
  CheckCircleIcon,
  ClockIcon,
  ExternalLinkIcon,
  FileTextIcon,
  LayoutDashboardIcon,
  Loader2Icon,
  MailSearchIcon,
  MoreHorizontalIcon,
  PaperclipIcon,
  ShieldCheckIcon,
  TriangleAlertIcon,
  XCircleIcon,
} from 'lucide-react';
import { Link, useParams, useSearchParams } from 'react-router';

import { trpc } from '@nexasign/trpc/react';
import type { TFindDiscoveryDocumentsResponse } from '@nexasign/trpc/server/discovery-router/schema';
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
import { Badge } from '@nexasign/ui/primitives/badge';
import { Button } from '@nexasign/ui/primitives/button';
import { Card } from '@nexasign/ui/primitives/card';
import { Checkbox } from '@nexasign/ui/primitives/checkbox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@nexasign/ui/primitives/dropdown-menu';
import { Input } from '@nexasign/ui/primitives/input';
import { useToast } from '@nexasign/ui/primitives/use-toast';

import { CorrespondentSummaryCard } from '~/components/discovery/correspondent-summary-card';
import { Illustration } from '~/components/general/illustration';
import { GmailAllMailBanner } from '~/components/sources/gmail-allmail-banner';
import { appMetaTags } from '~/utils/meta';

export function meta() {
  return appMetaTags(msg`Belege finden`);
}

type Document = TFindDiscoveryDocumentsResponse['documents'][number];
type Decision = 'archive' | 'ignore' | 'undecided';
type FilterChip = 'all' | 'archive' | 'ignore' | 'undecided' | 'needs-check';
type WorkspaceTab = 'focus' | 'list' | 'senders' | 'runs' | 'memory';

const formatDate = (date: Date | null, locale: string): string => {
  if (!date) return '–';
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(date);
};

const formatDateRange = (from: Date, to: Date, locale: string): string => {
  const inclusiveTo = new Date(to);
  if (
    inclusiveTo.getHours() === 0 &&
    inclusiveTo.getMinutes() === 0 &&
    inclusiveTo.getSeconds() === 0 &&
    inclusiveTo.getMilliseconds() === 0
  ) {
    inclusiveTo.setDate(inclusiveTo.getDate() - 1);
  }
  const fmt = new Intl.DateTimeFormat(locale, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
  return `${fmt.format(from)} – ${fmt.format(inclusiveTo)}`;
};

const stripeColor = (decision: Decision): string => {
  if (decision === 'archive') return 'bg-emerald-500';
  if (decision === 'ignore') return 'bg-neutral-300';
  return 'bg-amber-400';
};

const decisionLabel = (decision: Decision, isManual: boolean, isReviewed = false): string => {
  const prefix = isManual ? 'Ihre Auswahl' : isReviewed ? 'Geprüft' : 'Empfehlung';
  if (decision === 'archive') return `${prefix}: ins Archiv`;
  if (decision === 'ignore') return `${prefix}: nicht übernehmen`;
  return isManual ? 'Von Ihnen offen gelassen' : 'Noch offen';
};

const decisionPillClass = (decision: Decision): string => {
  if (decision === 'archive') return 'bg-emerald-50 text-emerald-800 ring-emerald-200';
  if (decision === 'ignore') return 'bg-neutral-100 text-neutral-700 ring-neutral-200';
  return 'bg-amber-50 text-amber-900 ring-amber-200';
};

const confidenceLabel = (doc: Document): string => {
  if (doc.confidenceLabel === 'high') return 'Sehr sicher';
  if (doc.confidenceLabel === 'medium') return 'Plausibel';
  return 'Prüfen';
};

const confidenceClass = (doc: Document): string => {
  if (doc.confidenceLabel === 'high') return 'bg-emerald-50 text-emerald-800 ring-emerald-200';
  if (doc.confidenceLabel === 'medium') return 'bg-sky-50 text-sky-800 ring-sky-200';
  return 'bg-amber-50 text-amber-900 ring-amber-200';
};

const needsHumanCheck = (doc: Document): boolean =>
  doc.confidenceLabel === 'low' || (doc.duplicateCount ?? 0) > 0;

const issueSummary = (doc: Document): string | null => {
  const duplicateCount = doc.duplicateCount ?? 0;
  const riskCount = doc.riskFlags?.length ?? 0;

  if (duplicateCount > 0 && riskCount > 0) {
    return `${duplicateCount} mögliche Dubletten · ${riskCount} offene Punkte`;
  }

  if (duplicateCount > 0) {
    return duplicateCount === 1 ? 'Mögliche Dublette' : `${duplicateCount} mögliche Dubletten`;
  }

  if (riskCount > 0) {
    return riskCount === 1 ? '1 offener Punkt' : `${riskCount} offene Punkte`;
  }

  return null;
};

const ruleActionLabel = (action: 'archive' | 'ignore'): string =>
  action === 'archive'
    ? 'beim nächsten Mal eher ins Archiv legen'
    : 'beim nächsten Mal nicht übernehmen';

const ruleActionShortLabel = (action: 'archive' | 'ignore'): string =>
  action === 'archive' ? 'Meist ins Archiv' : 'Meist nicht übernehmen';

/**
 * Heuristik: einfache Signale (Reply-Mail, Newsletter, Bestellbestätigung,
 * keine Beträge ohne Anhang) liefern den Default-Vorschlag pro Zeile. Wenn
 * eines greift → "ignore", sonst "archive". Der User kann jederzeit
 * überstimmen.
 */
const heuristicDefault = (doc: Document): Decision => {
  if (doc.ruleMatch?.action === 'archive') return 'archive';
  if (doc.ruleMatch?.action === 'ignore') return 'ignore';

  const title = doc.title.toLowerCase();
  const sender = (doc.correspondent ?? '').toLowerCase();
  if (title.startsWith('aw:') || title.startsWith('re:') || title.startsWith('fwd:'))
    return 'ignore';
  if (sender.includes('newsletter') || title.includes('newsletter')) return 'ignore';
  if (title.includes('bestellbestätigung') || title.includes('bestellbestaetigung'))
    return 'ignore';
  if (title.includes('webinar') || title.includes('aktion')) return 'ignore';
  if (title.includes('sicherheitswarnung') || title.includes('passwort')) return 'ignore';
  if (title.includes('benachrichtigung')) return 'ignore';
  if (!doc.detectedAmount && doc.attachmentCount === 0) return 'ignore';
  return 'archive';
};

const heuristicHint = (doc: Document): string | null => {
  const title = doc.title.toLowerCase();
  const sender = (doc.correspondent ?? '').toLowerCase();
  if (title.startsWith('aw:') || title.startsWith('re:') || title.startsWith('fwd:'))
    return 'Antwort- oder Weiterleitungs-Mail — selbst kein Beleg.';
  if (sender.includes('newsletter') || title.includes('newsletter'))
    return 'Sieht nach Newsletter aus — Absender ist auf einer Werbe-Liste.';
  if (title.includes('bestellbestätigung') || title.includes('bestellbestaetigung'))
    return 'Eine Bestellbestätigung ist meist noch keine Rechnung.';
  if (title.includes('webinar') || title.includes('aktion'))
    return 'Marketing-Mail mit „Rechnung" im Betreff.';
  if (title.includes('sicherheitswarnung') || title.includes('passwort'))
    return 'System-Mail, kein Geschäftsbeleg.';
  if (title.includes('benachrichtigung')) return 'Kalender- oder System-Benachrichtigung.';
  if (!doc.detectedAmount && doc.attachmentCount === 0)
    return 'Kein Betrag erkannt, kein Anhang — vermutlich kein echter Beleg.';
  return null;
};

const decisionReason = (doc: Document, decision: Decision): string => {
  if (decision === 'undecided') {
    return 'Diese Zeile bleibt unverändert, bis Sie selbst entscheiden.';
  }

  if (doc.ruleMatch && doc.ruleMatch.action === decision) {
    return `Bekannter Absender: Mails von ${doc.ruleMatch.label} haben Sie bisher meist so behandelt.`;
  }

  if (decision === 'ignore') {
    return heuristicHint(doc) ?? 'Wir erkennen hier kein starkes Beleg-Signal.';
  }

  if (doc.confidenceReasons?.length) {
    return doc.confidenceReasons.join(' · ');
  }

  if (doc.attachmentCount > 0 && doc.detectedAmount) {
    return 'PDF-Anhang und Betrag erkannt — sehr wahrscheinlich ein echter Beleg.';
  }
  if (doc.attachmentCount > 0) {
    return 'PDF-Anhang erkannt — bitte kurz prüfen, dann übernehmen.';
  }
  if (doc.detectedAmount) {
    return 'Betrag erkannt, aber kein PDF — eventuell im Portal nachziehen.';
  }
  return 'Möglicher Beleg — bitte kurz prüfen, bevor Sie bestätigen.';
};

const DocumentRow = ({
  doc,
  locale,
  decision,
  isManual,
  isReviewed,
  isSelected,
  isPending,
  onChange,
  onMarkReviewed,
  onOpenReview,
  onToggleSelect,
}: {
  doc: Document;
  locale: string;
  decision: Decision;
  isManual: boolean;
  isReviewed: boolean;
  isSelected: boolean;
  isPending: boolean;
  onChange: (next: Decision) => void;
  onMarkReviewed: () => void;
  onOpenReview: () => void;
  onToggleSelect: () => void;
}) => {
  const hint = decisionReason(doc, decision);
  const dimmed = decision === 'ignore';
  const needsReview = needsHumanCheck(doc);
  const reviewOpen = needsReview && decision === 'archive' && !isReviewed;
  const issues = issueSummary(doc);
  const showReason =
    reviewOpen || decision === 'ignore' || isManual || Boolean(doc.ruleMatch) || Boolean(issues);

  return (
    <li
      data-rule-match={doc.ruleMatch ? 'true' : undefined}
      className={`group relative flex items-stretch overflow-hidden rounded-lg border shadow-sm transition-all hover:shadow-md ${
        isSelected
          ? 'border-primary ring-2 ring-primary/30'
          : reviewOpen
            ? 'border-amber-300 bg-amber-50/40'
            : dimmed
              ? 'border-neutral-200 bg-neutral-50/60'
              : 'border-neutral-200 bg-white'
      }`}
    >
      <span className={`w-1 shrink-0 ${stripeColor(decision)}`} aria-hidden />
      <div className="flex flex-1 flex-wrap items-start gap-3 px-4 py-3">
        <label className="flex cursor-pointer items-center pt-0.5">
          <Checkbox
            checked={isSelected}
            onCheckedChange={onToggleSelect}
            aria-label={`Beleg „${doc.title}" für Mehrfach-Aktion auswählen`}
            className="h-5 w-5"
          />
        </label>
        <Link
          to={doc.id}
          onClick={onOpenReview}
          className="flex min-w-0 flex-1 items-start gap-3 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <FileTextIcon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
              <div className="min-w-0">
                <div
                  className={`truncate font-medium ${dimmed ? 'text-neutral-500' : 'text-foreground'}`}
                >
                  {doc.correspondent ?? doc.title}
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                  {doc.detectedAmount && (
                    <span
                      className={`font-semibold tabular-nums ${dimmed ? 'text-neutral-400' : 'text-foreground'}`}
                    >
                      {doc.detectedAmount}
                    </span>
                  )}
                  <span className="tabular-nums text-neutral-500">
                    {formatDate(doc.documentDate ?? doc.capturedAt, locale)}
                  </span>
                  {doc.hasArchive && doc.attachmentCount > 0 && (
                    <span
                      className="inline-flex items-center gap-0.5 text-neutral-500"
                      title="Anhang vorhanden"
                    >
                      <PaperclipIcon className="h-3 w-3" aria-hidden />
                      {doc.attachmentCount}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {reviewOpen && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-950 ring-1 ring-amber-200">
                    <TriangleAlertIcon className="h-3 w-3" aria-hidden />
                    <Trans>Bitte prüfen</Trans>
                  </span>
                )}
                <Badge
                  variant={
                    isManual || isReviewed
                      ? 'secondary'
                      : decision === 'undecided'
                        ? 'warning'
                        : 'neutral'
                  }
                  size="small"
                  className={`rounded-full ${decisionPillClass(decision)}`}
                >
                  {decisionLabel(decision, isManual, isReviewed)}
                </Badge>
              </div>
            </div>

            <div
              className={`mt-1 truncate text-sm group-hover:underline ${
                dimmed ? 'text-neutral-500' : 'text-neutral-700'
              }`}
            >
              {doc.title}
            </div>

            {(showReason || issues || doc.confidenceLabel === 'low') && (
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {showReason && (
                  <span
                    className={`inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-md px-2 py-1 text-xs ${
                      reviewOpen
                        ? 'bg-amber-100 text-amber-950 ring-1 ring-amber-200'
                        : 'bg-neutral-50 text-neutral-600 ring-1 ring-neutral-200'
                    }`}
                  >
                    <span className="shrink-0 font-semibold text-neutral-800">
                      <Trans>Warum?</Trans>
                    </span>
                    <span className="truncate">{hint}</span>
                  </span>
                )}
                {issues && (
                  <span className="inline-flex items-center gap-1 rounded-md bg-amber-100 px-2 py-1 text-xs font-medium text-amber-950 ring-1 ring-amber-200">
                    <TriangleAlertIcon className="h-3 w-3" aria-hidden />
                    {issues}
                  </span>
                )}
                {doc.confidenceLabel === 'low' && !issues && (
                  <span
                    className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium ring-1 ${confidenceClass(doc)}`}
                    title={
                      typeof doc.confidence === 'number'
                        ? `Erkennungsqualität: ${doc.confidence}/100`
                        : undefined
                    }
                  >
                    <ShieldCheckIcon className="h-3 w-3" aria-hidden />
                    {confidenceLabel(doc)}
                  </span>
                )}
              </div>
            )}
          </div>
        </Link>

        <div className="flex w-full shrink-0 flex-col items-stretch gap-2 sm:w-auto sm:min-w-56 sm:items-end">
          <div className="rounded-lg border border-neutral-200 bg-white p-2 shadow-sm">
            <div className="mb-1 flex items-center justify-between gap-2">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
                <Trans>Ihre Entscheidung</Trans>
              </div>
              <div className="text-[11px] font-medium text-neutral-500">
                <Trans>noch nicht gespeichert</Trans>
              </div>
            </div>
            <div
              role="group"
              aria-label="Entscheidung für diesen Beleg"
              className="grid grid-cols-2 overflow-hidden rounded-md border border-neutral-300 bg-white"
            >
              <Button
                size="sm"
                variant="ghost"
                disabled={isPending}
                onClick={() => onChange('archive')}
                className={`rounded-none border-r border-neutral-300 px-3 ${
                  decision === 'archive'
                    ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                    : 'text-emerald-700 hover:bg-emerald-50'
                }`}
                aria-pressed={decision === 'archive'}
              >
                <CheckCircleIcon className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                <Trans>Ins Archiv</Trans>
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={isPending}
                onClick={() => onChange('ignore')}
                className={`rounded-none px-3 ${
                  decision === 'ignore'
                    ? 'bg-neutral-700 text-white hover:bg-neutral-800'
                    : 'text-neutral-600 hover:bg-neutral-100'
                }`}
                aria-pressed={decision === 'ignore'}
              >
                <XCircleIcon className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                <Trans>Nicht übernehmen</Trans>
              </Button>
            </div>
            <p className="mt-1 text-[11px] leading-snug text-neutral-500">
              {decision === 'archive' ? (
                <Trans>Wird beim Bestätigen ins Archiv gelegt.</Trans>
              ) : decision === 'ignore' ? (
                <Trans>Wird beim Bestätigen aus der Liste entfernt.</Trans>
              ) : (
                <Trans>Bleibt hier, bis Sie entscheiden.</Trans>
              )}
            </p>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-8 w-8 p-0" disabled={isPending}>
                <MoreHorizontalIcon className="h-4 w-4" aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => onChange('undecided')}>
                <ClockIcon className="mr-2 h-4 w-4" aria-hidden />
                <Trans>Offen lassen</Trans>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {reviewOpen && (
            <Button size="sm" variant="outline" disabled={isPending} onClick={onMarkReviewed}>
              <Trans>Als geprüft markieren</Trans>
            </Button>
          )}
        </div>
      </div>
    </li>
  );
};

export default function FindDocumentsPage() {
  const { _, i18n } = useLingui();
  const { toast } = useToast();
  const params = useParams();
  const teamUrl = params.teamUrl ?? '';
  const utils = trpc.useUtils();

  const [filter, setFilter] = useState<FilterChip>('all');
  const [query, setQuery] = useState('');
  // Lokale Entscheidungen pro Beleg-ID. Wird aus der Heuristik vorbefüllt,
  // sobald die Liste lädt — und beim Bestätigen am Ende batch-committet.
  const [decisions, setDecisions] = useState<Map<string, Decision>>(new Map());
  // Sichtbar machen, was der Nutzer aktiv geaendert hat. Das reduziert
  // Unsicherheit vor dem finalen Batch-Klick: Vorschlag vs. eigene Wahl.
  const [manualDecisionIds, setManualDecisionIds] = useState<Set<string>>(new Set());
  // Separat von "geaendert": Ein Treffer gilt als geprueft, sobald der Nutzer
  // ihn oeffnet, aktiv bestaetigt oder ausdruecklich als geprueft markiert.
  const [reviewedIds, setReviewedIds] = useState<Set<string>>(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
  // Multi-Select für Bulk-Aktionen (z.B. mehrere Zeilen gleichzeitig von
  // "Für Archivierung ausgewählt" auf "Zum Ignorieren ausgewählt" umstellen).
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [reviewQueueOpen, setReviewQueueOpen] = useState(false);
  const [reviewQueueIndex, setReviewQueueIndex] = useState(0);
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('focus');
  // Erfolgs-Seite nach Bestätigen — zeigt Klartext-Confirmation statt Toast.
  // archive/ignore: tatsaechlich vom Server akzeptiert (acceptedCount).
  // archiveSkipped/ignoreSkipped: bereits frueher verarbeitet, Server hat sie
  // uebersprungen — das verhindert die Wahrnehmung „doppelt im Archiv", wenn
  // der User aus stale-Cache nochmal auf Confirm klickt.
  const [successState, setSuccessState] = useState<{
    archive: number;
    ignore: number;
    archiveSkipped: number;
    ignoreSkipped: number;
  } | null>(null);

  // URL-Param `correspondent`: wird vom Hub-Korrespondenten-Tab gesetzt, um
  // die Trefferliste auf einen einzelnen Sender zu filtern.
  const [searchParams] = useSearchParams();
  const correspondentFilter = searchParams.get('correspondent') ?? undefined;

  // Trefferliste = Eingangs-Belege (inbox + pending-manual zusammen, weil das
  // aus User-Sicht der "noch zu entscheidende"-Stapel ist).
  // refetchOnMount: 'always' verhindert, dass nach Confirm + Navigation ein
  // veralteter Cache mit den bereits akzeptierten Belegen zu sehen ist.
  const reviewQueue = trpc.discovery.findDocuments.useInfiniteQuery(
    {
      status: 'all',
      qualityFilter: 'needs-review',
      query: query.trim() || undefined,
      correspondent: correspondentFilter,
    },
    {
      getNextPageParam: (lastPage) => lastPage.nextCursor,
      refetchOnMount: 'always',
    },
  );

  const allInboxDocs = useMemo(
    () => (reviewQueue.data?.pages ?? []).flatMap((page) => page.documents),
    [reviewQueue.data?.pages],
  );

  const queueMeta = reviewQueue.data?.pages[0];
  const totalHits = queueMeta?.total ?? 0;
  const isLoading = reviewQueue.isLoading;
  const hasConnectedSource = (queueMeta?.sources.length ?? 0) > 0;
  const ruleSuggestionsQuery = trpc.discovery.getRuleSuggestions.useQuery(undefined, {
    enabled: hasConnectedSource,
  });
  const ruleSuggestions = ruleSuggestionsQuery.data?.suggestions ?? [];
  const activeRules = ruleSuggestions.filter((rule) => rule.status === 'active');
  const suggestedRules = ruleSuggestions.filter((rule) => rule.status === 'suggested');
  const updateRuleStatusMutation = trpc.discovery.updateRuleStatus.useMutation({
    onSuccess: () => {
      void utils.discovery.getRuleSuggestions.invalidate();
      void utils.discovery.findDocuments.invalidate();
    },
  });

  // Aktive Sync-Runs pollen.
  const { data: activeRuns } = trpc.discovery.getActiveSyncRuns.useQuery(undefined, {
    refetchInterval: (q) => ((q.state.data?.length ?? 0) > 0 ? 3000 : false),
  });
  const { data: recentSyncRuns } = trpc.sources.listRecentSyncRuns.useQuery({ limit: 5 });
  const activeRunsCount = activeRuns?.length ?? 0;
  const latestCompletedRun =
    recentSyncRuns?.find((run) => run.status === 'SUCCESS' || run.status === 'FAILED') ?? null;
  const latestCompletedRangeLabel = latestCompletedRun
    ? formatDateRange(latestCompletedRun.rangeFrom, latestCompletedRun.rangeTo, i18n.locale)
    : null;
  const lastActiveCountRef = useRef(activeRunsCount);
  useEffect(() => {
    if (lastActiveCountRef.current > 0 && activeRunsCount === 0) {
      void utils.discovery.findDocuments.invalidate();
      void utils.discovery.getOverview.invalidate();
    }
    lastActiveCountRef.current = activeRunsCount;
  }, [activeRunsCount, utils.discovery.findDocuments, utils.discovery.getOverview]);

  // Heuristik-Defaults setzen, sobald neue Belege geladen sind. Bestehende
  // User-Overrides bleiben erhalten.
  useEffect(() => {
    if (allInboxDocs.length === 0) return;
    setDecisions((prev) => {
      const next = new Map(prev);
      let changed = false;
      for (const doc of allInboxDocs) {
        if (!next.has(doc.id)) {
          next.set(doc.id, heuristicDefault(doc));
          changed = true;
        }
      }
      // IDs entfernen, die nicht mehr in der Liste sind (z.B. nach Sync).
      for (const id of [...next.keys()]) {
        if (!allInboxDocs.some((d) => d.id === id)) {
          next.delete(id);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
    setManualDecisionIds((prev) => {
      const validIds = new Set(allInboxDocs.map((doc) => doc.id));
      const next = new Set([...prev].filter((id) => validIds.has(id)));
      return next.size === prev.size ? prev : next;
    });
    setReviewedIds((prev) => {
      const validIds = new Set(allInboxDocs.map((doc) => doc.id));
      const next = new Set([...prev].filter((id) => validIds.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [allInboxDocs]);

  const bulkAcceptMutation = trpc.discovery.bulkAccept.useMutation();
  const bulkIgnoreMutation = trpc.discovery.bulkIgnore.useMutation();
  const isCommitting = bulkAcceptMutation.isPending || bulkIgnoreMutation.isPending;

  const handleDecision = (id: string, next: Decision) => {
    setDecisions((prev) => {
      const map = new Map(prev);
      map.set(id, next);
      return map;
    });
    setManualDecisionIds((prev) => new Set(prev).add(id));
    setReviewedIds((prev) => new Set(prev).add(id));
  };

  const handleMarkReviewed = (id: string) => {
    setReviewedIds((prev) => new Set(prev).add(id));
  };

  const handleToggleSelect = (id: string) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const handleBulkDecision = (next: Decision) => {
    setDecisions((prev) => {
      const map = new Map(prev);
      for (const id of selectedIds) map.set(id, next);
      return map;
    });
    setManualDecisionIds((prev) => {
      const nextIds = new Set(prev);
      for (const id of selectedIds) nextIds.add(id);
      return nextIds;
    });
    setReviewedIds((prev) => {
      const nextIds = new Set(prev);
      for (const id of selectedIds) nextIds.add(id);
      return nextIds;
    });
    setSelectedIds(new Set());
  };

  const handleClearSelection = () => setSelectedIds(new Set());

  // Bilanz aller Entscheidungen.
  const counts = useMemo(() => {
    let archive = 0,
      ignore = 0,
      undecided = 0;
    for (const doc of allInboxDocs) {
      const d = decisions.get(doc.id) ?? 'undecided';
      if (d === 'archive') archive++;
      else if (d === 'ignore') ignore++;
      else undecided++;
    }
    return { archive, ignore, undecided, total: allInboxDocs.length };
  }, [allInboxDocs, decisions]);
  const manualChangeCount = useMemo(
    () => allInboxDocs.filter((doc) => manualDecisionIds.has(doc.id)).length,
    [allInboxDocs, manualDecisionIds],
  );
  const ruleAppliedCount = useMemo(
    () =>
      allInboxDocs.filter(
        (doc) =>
          doc.ruleMatch &&
          !manualDecisionIds.has(doc.id) &&
          decisions.get(doc.id) === doc.ruleMatch.action,
      ).length,
    [allInboxDocs, decisions, manualDecisionIds],
  );
  const qualityCounts = useMemo(() => {
    let high = 0;
    let medium = 0;
    let low = 0;
    let risks = 0;
    let duplicates = 0;
    let needsCheck = 0;

    for (const doc of allInboxDocs) {
      if (doc.confidenceLabel === 'high') high++;
      else if (doc.confidenceLabel === 'medium') medium++;
      else low++;

      if ((doc.riskFlags?.length ?? 0) > 0) risks++;
      if ((doc.duplicateCount ?? 0) > 0) duplicates++;
      if (needsHumanCheck(doc)) needsCheck++;
    }

    return { high, medium, low, risks, duplicates, needsCheck };
  }, [allInboxDocs]);

  const visibleDocs = useMemo(() => {
    if (filter === 'all') return allInboxDocs;
    if (filter === 'needs-check') {
      return allInboxDocs.filter(
        (doc) =>
          decisions.get(doc.id) === 'archive' && needsHumanCheck(doc) && !reviewedIds.has(doc.id),
      );
    }
    return allInboxDocs.filter((doc) => {
      const d = decisions.get(doc.id) ?? 'undecided';
      return d === filter;
    });
  }, [allInboxDocs, decisions, filter, reviewedIds]);

  const safeArchiveDocs = useMemo(
    () =>
      allInboxDocs.filter(
        (doc) =>
          decisions.get(doc.id) === 'archive' &&
          doc.confidenceLabel === 'high' &&
          !needsHumanCheck(doc) &&
          (doc.riskFlags?.length ?? 0) === 0,
      ),
    [allInboxDocs, decisions],
  );

  const pendingReviewDocs = useMemo(
    () =>
      allInboxDocs.filter(
        (doc) =>
          decisions.get(doc.id) === 'archive' && needsHumanCheck(doc) && !reviewedIds.has(doc.id),
      ),
    [allInboxDocs, decisions, reviewedIds],
  );

  useEffect(() => {
    setReviewQueueIndex((prev) => {
      if (pendingReviewDocs.length === 0) return 0;
      return Math.min(prev, pendingReviewDocs.length - 1);
    });
  }, [pendingReviewDocs.length]);

  const currentReviewDoc = pendingReviewDocs[reviewQueueIndex] ?? null;

  const unreviewedRiskyArchiveCount = useMemo(
    () => pendingReviewDocs.length,
    [pendingReviewDocs.length],
  );

  const goToNextPendingReview = () => {
    setReviewQueueOpen(true);
    setReviewQueueIndex((prev) =>
      pendingReviewDocs.length <= 1 ? 0 : (prev + 1) % pendingReviewDocs.length,
    );
  };

  const openList = (nextFilter: FilterChip) => {
    setFilter(nextFilter);
    setActiveTab('list');
    if (nextFilter === 'needs-check') {
      setReviewQueueOpen(true);
    }
  };

  const clearLocalDocumentState = (ids: string[]) => {
    const idSet = new Set(ids);

    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const id of idSet) next.delete(id);
      return next;
    });
    setDecisions((prev) => {
      const next = new Map(prev);
      for (const id of idSet) next.delete(id);
      return next;
    });
    setManualDecisionIds((prev) => {
      const next = new Set(prev);
      for (const id of idSet) next.delete(id);
      return next;
    });
    setReviewedIds((prev) => {
      const next = new Set(prev);
      for (const id of idSet) next.delete(id);
      return next;
    });
  };

  const handleAcceptSafeArchive = async () => {
    const ids = safeArchiveDocs.map((doc) => doc.id);
    if (ids.length === 0) return;

    try {
      const result = await bulkAcceptMutation.mutateAsync({ ids });

      clearLocalDocumentState(ids);

      await Promise.all([
        utils.discovery.findDocuments.invalidate(),
        utils.discovery.getOverview.invalidate(),
      ]);
      await reviewQueue.refetch();

      toast({
        title: _(msg`Sichere Belege übernommen`),
        description: _(
          msg`${result.acceptedCount} Belege liegen jetzt im Archiv. Unsichere Belege bleiben in der Liste.`,
        ),
      });
    } catch (err) {
      toast({
        title: _(msg`Sichere Belege konnten nicht übernommen werden`),
        description: err instanceof Error ? err.message : 'Unbekannter Fehler',
        variant: 'destructive',
      });
    }
  };

  const handleAcceptDocumentNow = async (doc: Document) => {
    try {
      const result = await bulkAcceptMutation.mutateAsync({ ids: [doc.id] });

      clearLocalDocumentState([doc.id]);
      if (pendingReviewDocs.length <= 1) {
        setReviewQueueOpen(false);
      }

      await Promise.all([
        utils.discovery.findDocuments.invalidate(),
        utils.discovery.getOverview.invalidate(),
      ]);
      await reviewQueue.refetch();

      toast({
        title:
          result.acceptedCount > 0
            ? _(msg`Beleg ins Archiv gelegt`)
            : _(msg`Beleg war bereits verarbeitet`),
        description:
          result.acceptedCount > 0
            ? _(msg`Sie finden ihn jetzt im Archiv unter „Zur Ablage bereit".`)
            : _(msg`Die Liste wurde aktualisiert.`),
      });
    } catch (err) {
      toast({
        title: _(msg`Beleg konnte nicht ins Archiv gelegt werden`),
        description: err instanceof Error ? err.message : 'Unbekannter Fehler',
        variant: 'destructive',
      });
    }
  };

  const handleIgnoreDocumentNow = async (doc: Document) => {
    try {
      const result = await bulkIgnoreMutation.mutateAsync({ ids: [doc.id] });

      clearLocalDocumentState([doc.id]);
      if (pendingReviewDocs.length <= 1) {
        setReviewQueueOpen(false);
      }

      await Promise.all([
        utils.discovery.findDocuments.invalidate(),
        utils.discovery.getOverview.invalidate(),
      ]);
      await reviewQueue.refetch();

      toast({
        title:
          result.ignoredCount > 0
            ? _(msg`Beleg nicht übernommen`)
            : _(msg`Beleg war bereits verarbeitet`),
        description:
          result.ignoredCount > 0
            ? _(msg`Er wurde aus dieser Liste entfernt.`)
            : _(msg`Die Liste wurde aktualisiert.`),
      });
    } catch (err) {
      toast({
        title: _(msg`Beleg konnte nicht entfernt werden`),
        description: err instanceof Error ? err.message : 'Unbekannter Fehler',
        variant: 'destructive',
      });
    }
  };

  const handleConfirm = async () => {
    const archiveIds = allInboxDocs
      .filter((d) => decisions.get(d.id) === 'archive')
      .map((d) => d.id);
    const ignoreIds = allInboxDocs.filter((d) => decisions.get(d.id) === 'ignore').map((d) => d.id);

    if (archiveIds.length === 0 && ignoreIds.length === 0) return;

    try {
      const emptySkippedIds: string[] = [];
      // Server-Wahrheit verwenden — der Server-Filter ueberspringt bereits
      // verarbeitete Belege. Wenn wir lokal "50 ins Archiv" angezeigt haetten,
      // der Server aber 0 verarbeitet hat (weil schon laengst akzeptiert),
      // darf die Erfolgsmeldung nicht von „50" sprechen — sonst entsteht der
      // Eindruck, der Beleg waere ein zweites Mal im Archiv gelandet.
      const [acceptResult, ignoreResult] = await Promise.all([
        archiveIds.length > 0
          ? bulkAcceptMutation.mutateAsync({ ids: archiveIds })
          : Promise.resolve({ acceptedCount: 0, skippedIds: emptySkippedIds }),
        ignoreIds.length > 0
          ? bulkIgnoreMutation.mutateAsync({ ids: ignoreIds })
          : Promise.resolve({ ignoredCount: 0, skippedIds: emptySkippedIds }),
      ]);

      setDecisions(new Map());
      setManualDecisionIds(new Set());
      setReviewedIds(new Set());
      // Erst Cache invalidieren (await), dann Erfolgs-View. Sonst zeigt der
      // „Weitere Belege durchgehen"-Klick kurz die alte Liste.
      await Promise.all([
        utils.discovery.findDocuments.invalidate(),
        utils.discovery.getOverview.invalidate(),
      ]);
      await reviewQueue.refetch();
      setSuccessState({
        archive: acceptResult.acceptedCount,
        ignore: ignoreResult.ignoredCount,
        archiveSkipped: acceptResult.skippedIds.length,
        ignoreSkipped: ignoreResult.skippedIds.length,
      });
      setConfirmOpen(false);
    } catch (err) {
      toast({
        title: _(msg`Bestätigen fehlgeschlagen`),
        description: err instanceof Error ? err.message : 'Unbekannter Fehler',
        variant: 'destructive',
      });
    }
  };

  // ERFOLGS-SEITE — wenn der User gerade bestätigt hat. Vollbild-Confirmation
  // statt Toast — der GF braucht einen klaren "Geschafft!"-Moment.
  if (successState) {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-12 md:px-6">
        <Card className="flex flex-col items-center gap-5 p-8 text-center md:p-12">
          <Illustration
            name="success-celebration"
            alt="Geschafft"
            tone="emerald"
            className="h-40 w-full max-w-[240px]"
          />
          <div>
            <h1 className="text-2xl font-bold tracking-tight md:text-3xl">
              {successState.archive === 0 && successState.ignore === 0 ? (
                <Trans>Schon erledigt</Trans>
              ) : (
                <Trans>Geschafft!</Trans>
              )}
            </h1>
            <p className="mt-2 text-base text-neutral-700">
              {successState.archive === 0 && successState.ignore === 0 ? (
                <Trans>
                  Alle ausgewählten Belege waren bereits verarbeitet — wir haben nichts doppelt
                  abgelegt.
                </Trans>
              ) : successState.archive > 0 && successState.ignore > 0 ? (
                <Trans>
                  <strong>{successState.archive} Belege</strong> liegen jetzt sicher in Ihrem
                  Archiv. <strong>{successState.ignore}</strong> haben Sie als kein-Beleg ignoriert.
                </Trans>
              ) : successState.archive > 0 ? (
                <Trans>
                  <strong>{successState.archive} Belege</strong> liegen jetzt sicher in Ihrem
                  Archiv.
                </Trans>
              ) : (
                <Trans>
                  <strong>{successState.ignore} Mails</strong> als kein-Beleg ignoriert.
                </Trans>
              )}
            </p>
            {(successState.archiveSkipped > 0 || successState.ignoreSkipped > 0) && (
              <p className="mt-2 text-sm text-neutral-500">
                <Trans>
                  Hinweis: {successState.archiveSkipped + successState.ignoreSkipped} Belege waren
                  schon verarbeitet und wurden nicht doppelt abgelegt.
                </Trans>
              </p>
            )}
          </div>
          <div className="flex flex-col items-stretch gap-2 sm:flex-row">
            {successState.archive > 0 && (
              <Button asChild>
                <Link to={`/t/${teamUrl}/archiv`}>
                  <CheckCircleIcon className="mr-2 h-4 w-4" aria-hidden />
                  <Trans>Im Archiv anschauen</Trans>
                </Link>
              </Button>
            )}
            <Button asChild variant="outline">
              <Link to={`/t/${teamUrl}/aufgaben`}>
                <Trans>Zurück zur Übersicht</Trans>
              </Link>
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setSuccessState(null);
                void utils.discovery.findDocuments.invalidate();
              }}
            >
              <Trans>Weitere Belege durchgehen</Trans>
            </Button>
          </div>
          <p className="mt-4 max-w-md text-xs text-neutral-500">
            <Trans>
              Tipp: Im Archiv können Sie Felder noch korrigieren. Wenn alles passt, klicken Sie dort
              auf „Endgültig archivieren" — dann sind die Belege 10 Jahre lang sicher abgelegt.
            </Trans>
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-6xl space-y-4 px-4 pb-32 pt-6 md:px-6">
      <header className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-sky-100 bg-gradient-to-br from-sky-50 via-white to-white p-4">
        <div className="flex items-center gap-4">
          <Illustration
            name="trefferliste-header"
            alt="Belege aus dem Postfach"
            tone="sky"
            className="h-14 w-16 shrink-0"
          />
          <div>
            <h1 className="text-xl font-bold tracking-tight md:text-2xl">
              {counts.total > 0 ? (
                latestCompletedRangeLabel ? (
                  <Trans>
                    Wir haben {totalHits} Beleg-Vorschläge im Zeitraum {latestCompletedRangeLabel}{' '}
                    gefunden
                  </Trans>
                ) : (
                  <Trans>Wir haben {totalHits} Beleg-Vorschläge gefunden</Trans>
                )
              ) : (
                <Trans>Belege aus dem Postfach</Trans>
              )}
            </h1>
            <p className="mt-1 text-sm text-neutral-600">
              <Trans>
                NexaFile zeigt zuerst, was Ihre Aufmerksamkeit braucht. Übernommen wird erst, wenn
                Sie unten bestätigen.
              </Trans>
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button asChild>
            <Link to={hasConnectedSource ? 'range' : 'connect'}>
              {activeRunsCount > 0 ? (
                <Loader2Icon className="mr-2 h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <MailSearchIcon className="mr-2 h-4 w-4" aria-hidden />
              )}
              {activeRunsCount > 0 ? (
                <Trans>Suche läuft… ({activeRunsCount})</Trans>
              ) : (
                <Trans>E-Mails erneut durchsuchen</Trans>
              )}
            </Link>
          </Button>
          <Button asChild variant="ghost" size="sm">
            <Link to="hub">
              <LayoutDashboardIcon className="mr-2 h-4 w-4" aria-hidden />
              <Trans>Übersicht</Trans>
            </Link>
          </Button>
        </div>
      </header>

      {correspondentFilter && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-sm">
          <span className="text-sky-900">
            <Trans>
              Filter aktiv: nur Belege von <strong>„{correspondentFilter}"</strong>
            </Trans>
          </span>
          <Link
            to={`/t/${teamUrl}/find-documents`}
            className="text-xs text-sky-900 underline-offset-4 hover:underline"
          >
            <Trans>Filter entfernen</Trans>
          </Link>
        </div>
      )}

      <GmailAllMailBanner sources={queueMeta?.sources ?? []} />

      {counts.total > 0 && (
        <Card className="border-neutral-200 bg-white p-2 shadow-sm">
          <div className="grid gap-2 md:grid-cols-5">
            <WorkspaceTabButton
              active={activeTab === 'focus'}
              onClick={() => setActiveTab('focus')}
              title={<Trans>Heute wichtig</Trans>}
              subtitle={<Trans>Der nächste sinnvolle Schritt</Trans>}
              count={pendingReviewDocs.length > 0 ? pendingReviewDocs.length : counts.archive}
              tone={pendingReviewDocs.length > 0 ? 'amber' : 'emerald'}
            />
            <WorkspaceTabButton
              active={activeTab === 'list'}
              onClick={() => setActiveTab('list')}
              title={<Trans>Alle Vorschläge</Trans>}
              subtitle={<Trans>Suchen, filtern, gesammelt ändern</Trans>}
              count={counts.total}
            />
            <WorkspaceTabButton
              active={activeTab === 'senders'}
              onClick={() => setActiveTab('senders')}
              title={<Trans>Absender</Trans>}
              subtitle={<Trans>Wer Belege geschickt hat</Trans>}
            />
            <WorkspaceTabButton
              active={activeTab === 'runs'}
              onClick={() => setActiveTab('runs')}
              title={<Trans>Durchsuchte Zeiträume</Trans>}
              subtitle={<Trans>Wann welches Postfach geprüft wurde</Trans>}
              count={activeRunsCount > 0 ? activeRunsCount : (recentSyncRuns?.length ?? 0)}
              tone={activeRunsCount > 0 ? 'amber' : 'neutral'}
            />
            <WorkspaceTabButton
              active={activeTab === 'memory'}
              onClick={() => setActiveTab('memory')}
              title={<Trans>Merken</Trans>}
              subtitle={<Trans>Wiederkehrende Absender</Trans>}
              count={activeRules.length + suggestedRules.length}
              tone={suggestedRules.length > 0 ? 'emerald' : 'neutral'}
            />
          </div>
        </Card>
      )}

      {isLoading && (
        <Card className="flex items-center justify-center py-12 text-neutral-500">
          <Loader2Icon className="mr-2 h-4 w-4 animate-spin" aria-hidden />
          <Trans>Belege werden geladen…</Trans>
        </Card>
      )}

      {!isLoading && counts.total === 0 && (
        <EmptyState hasSources={(queueMeta?.sources.length ?? 0) > 0} />
      )}

      {counts.total > 0 && activeTab === 'focus' && (
        <Card
          className={`overflow-hidden text-sm shadow-sm ${
            pendingReviewDocs.length > 0
              ? 'border-amber-200 bg-amber-50/60'
              : 'border-neutral-200 bg-white'
          }`}
        >
          <div className="grid gap-4 p-4 md:grid-cols-[1fr_18rem]">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
                <Trans>Heute wichtig</Trans>
              </div>
              <h2 className="mt-1 text-lg font-semibold tracking-tight text-neutral-950">
                {pendingReviewDocs.length > 0 ? (
                  <Trans>{pendingReviewDocs.length} Belege brauchen kurz Ihre Entscheidung</Trans>
                ) : counts.undecided > 0 ? (
                  <Trans>{counts.undecided} Vorschläge sind noch offen</Trans>
                ) : safeArchiveDocs.length > 0 ? (
                  <Trans>{safeArchiveDocs.length} sichere Belege können direkt ins Archiv</Trans>
                ) : (
                  <Trans>Bereit zum Übernehmen</Trans>
                )}
              </h2>
              <p className="mt-2 max-w-2xl text-sm text-neutral-700">
                {pendingReviewDocs.length > 0 ? (
                  <Trans>
                    Wir zeigen die unklaren Belege einzeln. Sie müssen nicht durch die komplette
                    Liste scrollen.
                  </Trans>
                ) : counts.undecided > 0 ? (
                  <Trans>
                    Öffnen Sie nur die offenen Vorschläge. Alles andere ist bereits eingeordnet.
                  </Trans>
                ) : safeArchiveDocs.length > 0 ? (
                  <Trans>
                    Diese Belege haben keine Warnhinweise. Sie können sie gesammelt übernehmen.
                  </Trans>
                ) : (
                  <Trans>
                    Mit „Bestätigen“ schließen Sie diesen Schritt ab. Vorher wird nichts dauerhaft
                    übernommen.
                  </Trans>
                )}
              </p>

              <div className="mt-4 flex flex-wrap items-center gap-2">
                {pendingReviewDocs.length > 0 ? (
                  <Button
                    onClick={() => {
                      setReviewQueueOpen(true);
                      setFilter('needs-check');
                    }}
                  >
                    <TriangleAlertIcon className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                    <Trans>Unklare Belege prüfen</Trans>
                  </Button>
                ) : counts.undecided > 0 ? (
                  <Button variant="outline" onClick={() => openList('undecided')}>
                    <Trans>Offene Vorschläge anzeigen</Trans>
                  </Button>
                ) : safeArchiveDocs.length > 0 ? (
                  <Button
                    onClick={() => void handleAcceptSafeArchive()}
                    disabled={safeArchiveDocs.length === 0 || isCommitting}
                  >
                    {isCommitting ? (
                      <Loader2Icon className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden />
                    ) : (
                      <CheckCircleIcon className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                    )}
                    <Trans>Sichere Belege übernehmen</Trans>
                  </Button>
                ) : (
                  <div className="rounded-md bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800 ring-1 ring-emerald-200">
                    <Trans>Bereit zur Bestätigung</Trans>
                  </div>
                )}
                <Button variant="ghost" onClick={() => openList('all')}>
                  <Trans>Alle Vorschläge öffnen</Trans>
                </Button>
              </div>
            </div>

            <div className="rounded-lg border border-white/70 bg-white/80 p-3 shadow-sm">
              <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
                <Trans>Stand</Trans>
              </div>
              <div className="mt-3 space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-neutral-600">
                    <Trans>Fürs Archiv</Trans>
                  </span>
                  <span className="font-semibold text-emerald-700">{counts.archive}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-neutral-600">
                    <Trans>Nicht übernehmen</Trans>
                  </span>
                  <span className="font-semibold text-neutral-700">{counts.ignore}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-neutral-600">
                    <Trans>Noch offen</Trans>
                  </span>
                  <span className="font-semibold text-amber-700">{counts.undecided}</span>
                </div>
                <div className="flex items-center justify-between gap-3 border-t border-neutral-100 pt-2">
                  <span className="text-neutral-600">
                    <Trans>Kurz prüfen</Trans>
                  </span>
                  <span className="font-semibold text-amber-700">{pendingReviewDocs.length}</span>
                </div>
              </div>
            </div>
          </div>
        </Card>
      )}

      {activeTab === 'focus' && reviewQueueOpen && currentReviewDoc && (
        <Card className="overflow-hidden border-amber-200 bg-white text-sm shadow-sm">
          <div className="h-1 bg-amber-100" aria-hidden>
            <div
              className="h-full bg-amber-500 transition-all"
              style={{
                width: `${Math.round(((reviewQueueIndex + 1) / pendingReviewDocs.length) * 100)}%`,
              }}
            />
          </div>

          <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-xs font-semibold uppercase tracking-wide text-amber-900">
                  <Trans>
                    Prüfen {reviewQueueIndex + 1} von {pendingReviewDocs.length}
                  </Trans>
                </div>
                <Button size="sm" variant="ghost" onClick={() => setReviewQueueOpen(false)}>
                  <Trans>Schließen</Trans>
                </Button>
              </div>

              <div className="mt-3 rounded-xl border border-neutral-200 bg-neutral-50/70 p-3">
                <h2 className="truncate text-lg font-semibold text-neutral-950">
                  {currentReviewDoc.correspondent ?? currentReviewDoc.title}
                </h2>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-neutral-600">
                  {currentReviewDoc.detectedAmount && (
                    <span className="rounded-md bg-white px-2 py-1 font-semibold tabular-nums text-neutral-950 ring-1 ring-neutral-200">
                      {currentReviewDoc.detectedAmount}
                    </span>
                  )}
                  <span className="rounded-md bg-white px-2 py-1 tabular-nums ring-1 ring-neutral-200">
                    {formatDate(
                      currentReviewDoc.documentDate ?? currentReviewDoc.capturedAt,
                      i18n.locale,
                    )}
                  </span>
                  {currentReviewDoc.attachmentCount > 0 && (
                    <span className="inline-flex items-center gap-1 rounded-md bg-white px-2 py-1 ring-1 ring-neutral-200">
                      <PaperclipIcon className="h-3.5 w-3.5" aria-hidden />
                      {currentReviewDoc.attachmentCount}
                    </span>
                  )}
                </div>
                <p className="mt-2 line-clamp-2 text-neutral-700">{currentReviewDoc.title}</p>
              </div>

              <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
                <span className="font-semibold">
                  <Trans>Warum liegt dieser Beleg hier?</Trans>
                </span>{' '}
                {decisionReason(
                  currentReviewDoc,
                  decisions.get(currentReviewDoc.id) ?? 'undecided',
                )}
              </div>
            </div>

            <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
                <Trans>Ihre Entscheidung</Trans>
              </div>
              <p className="mt-1 text-sm leading-snug text-neutral-600">
                <Trans>
                  Treffen Sie eine Auswahl. Danach bleibt der nächste unklare Beleg im Blick.
                </Trans>
              </p>

              <div className="mt-3 grid gap-2">
                <Button
                  size="lg"
                  onClick={() => void handleAcceptDocumentNow(currentReviewDoc)}
                  disabled={isCommitting}
                  className="justify-start bg-emerald-600 text-white hover:bg-emerald-700"
                >
                  {bulkAcceptMutation.isPending ? (
                    <Loader2Icon className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                  ) : (
                    <CheckCircleIcon className="mr-2 h-4 w-4" aria-hidden />
                  )}
                  <Trans>Ins Archiv</Trans>
                </Button>
                <Button
                  size="lg"
                  variant="outline"
                  onClick={() => void handleIgnoreDocumentNow(currentReviewDoc)}
                  disabled={isCommitting}
                  className="justify-start"
                >
                  {bulkIgnoreMutation.isPending ? (
                    <Loader2Icon className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                  ) : (
                    <XCircleIcon className="mr-2 h-4 w-4" aria-hidden />
                  )}
                  <Trans>Nicht übernehmen</Trans>
                </Button>
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    variant="ghost"
                    onClick={() => handleDecision(currentReviewDoc.id, 'undecided')}
                    disabled={isCommitting}
                  >
                    <ClockIcon className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                    <Trans>Später</Trans>
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={goToNextPendingReview}
                    disabled={pendingReviewDocs.length <= 1}
                  >
                    <Trans>Überspringen</Trans>
                  </Button>
                </div>
              </div>

              <Button asChild variant="link" className="mt-2 h-auto px-0 text-neutral-600">
                <Link
                  to={currentReviewDoc.id}
                  onClick={() => handleMarkReviewed(currentReviewDoc.id)}
                >
                  <ExternalLinkIcon className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                  <Trans>Details öffnen</Trans>
                </Link>
              </Button>
            </div>
          </div>
        </Card>
      )}

      {counts.total > 0 && activeTab === 'list' && (
        <Card className="border-neutral-200 bg-white p-3 shadow-sm">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="text-sm font-semibold text-neutral-950">
                <Trans>Alle Vorschläge</Trans>
              </div>
              <p className="text-xs text-neutral-500">
                <Trans>Suchen, filtern oder mehrere Belege auf einmal ändern.</Trans>
              </p>
            </div>

            <Input
              type="search"
              placeholder={_(msg`Suchen: Absender, Betreff, Rechnungs-Nr.`)}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="md:max-w-xs"
            />
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-1">
            {pendingReviewDocs.length > 0 && (
              <FilterPill
                active={filter === 'needs-check'}
                onClick={() => {
                  setFilter('needs-check');
                  setReviewQueueOpen(true);
                }}
                label={<Trans>Zu prüfen</Trans>}
                count={pendingReviewDocs.length}
                color="amber"
              />
            )}
            <FilterPill
              active={filter === 'archive'}
              onClick={() => setFilter('archive')}
              label={<Trans>Ins Archiv</Trans>}
              count={counts.archive}
              color="emerald"
            />
            <FilterPill
              active={filter === 'ignore'}
              onClick={() => setFilter('ignore')}
              label={<Trans>Ignorieren</Trans>}
              count={counts.ignore}
              color="neutral"
            />
            {counts.undecided > 0 && (
              <FilterPill
                active={filter === 'undecided'}
                onClick={() => setFilter('undecided')}
                label={<Trans>Offen</Trans>}
                count={counts.undecided}
                color="amber"
              />
            )}
            <FilterPill
              active={filter === 'all'}
              onClick={() => setFilter('all')}
              label={<Trans>Alle</Trans>}
              count={counts.total}
            />
          </div>
        </Card>
      )}

      {/* MULTI-SELECT-BULK-BAR — sticky oben, sichtbar sobald >=1 markiert. */}
      {activeTab === 'list' && selectedIds.size > 0 && (
        <div className="sticky top-2 z-10 flex flex-wrap items-center justify-between gap-3 rounded-md border border-neutral-900 bg-neutral-900 px-4 py-2.5 text-sm text-white shadow-md">
          <div className="flex items-center gap-3">
            <Checkbox
              checked
              onCheckedChange={handleClearSelection}
              aria-label="Auswahl aufheben"
              className="h-5 w-5 border-white/40 bg-white/10 data-[state=checked]:bg-white data-[state=checked]:text-neutral-900"
            />
            <span>
              <strong>{selectedIds.size}</strong> <Trans>von {visibleDocs.length} markiert</Trans>
            </span>
            <button
              className="text-xs text-neutral-300 underline-offset-2 hover:underline"
              onClick={handleClearSelection}
            >
              <Trans>Aufheben</Trans>
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-neutral-300">
              <Trans>Auswahl ändern zu:</Trans>
            </span>
            <Button
              size="sm"
              variant="outline"
              onClick={() => handleBulkDecision('archive')}
              className="border-emerald-300 bg-emerald-600 text-white hover:bg-emerald-700"
            >
              <CheckCircleIcon className="mr-1.5 h-3.5 w-3.5" aria-hidden />
              <Trans>Ins Archiv</Trans>
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => handleBulkDecision('ignore')}
              className="border-neutral-500 bg-neutral-700 text-white hover:bg-neutral-800"
            >
              <XCircleIcon className="mr-1.5 h-3.5 w-3.5" aria-hidden />
              <Trans>Nicht übernehmen</Trans>
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => handleBulkDecision('undecided')}
              className="text-neutral-300 hover:bg-white/10 hover:text-white"
            >
              <ClockIcon className="mr-1.5 h-3.5 w-3.5" aria-hidden />
              <Trans>Offen lassen</Trans>
            </Button>
          </div>
        </div>
      )}

      {/* MASTER-CHECKBOX um alle sichtbaren auszuwählen. */}
      {activeTab === 'list' &&
        counts.total > 0 &&
        visibleDocs.length > 0 &&
        selectedIds.size === 0 && (
          <label className="flex w-fit cursor-pointer items-center gap-2 rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50">
            <Checkbox
              checked={false}
              onCheckedChange={() => setSelectedIds(new Set(visibleDocs.map((d) => d.id)))}
              aria-label="Alle markieren"
              className="h-5 w-5"
            />
            <Trans>Alle {visibleDocs.length} markieren</Trans>
          </label>
        )}

      {activeTab === 'list' &&
        counts.total > 0 &&
        (visibleDocs.length === 0 ? (
          <Card className="px-6 py-12 text-center text-sm text-neutral-500">
            <Trans>Keine Belege in dieser Sicht.</Trans>
          </Card>
        ) : (
          <>
            <ul className="space-y-2">
              {visibleDocs.map((doc) => (
                <DocumentRow
                  key={doc.id}
                  doc={doc}
                  locale={i18n.locale}
                  decision={decisions.get(doc.id) ?? 'undecided'}
                  isManual={manualDecisionIds.has(doc.id)}
                  isReviewed={reviewedIds.has(doc.id)}
                  isSelected={selectedIds.has(doc.id)}
                  isPending={isCommitting}
                  onChange={(next) => handleDecision(doc.id, next)}
                  onMarkReviewed={() => handleMarkReviewed(doc.id)}
                  onOpenReview={() => handleMarkReviewed(doc.id)}
                  onToggleSelect={() => handleToggleSelect(doc.id)}
                />
              ))}
            </ul>
            <div className="text-center text-xs text-neutral-500">
              <Trans>
                {visibleDocs.length} von {totalHits} geladen
              </Trans>
            </div>
            {reviewQueue.hasNextPage && (
              <div className="flex justify-center pt-2">
                <Button
                  variant="outline"
                  onClick={() => void reviewQueue.fetchNextPage()}
                  disabled={reviewQueue.isFetchingNextPage}
                >
                  {reviewQueue.isFetchingNextPage ? (
                    <Loader2Icon className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                  ) : null}
                  <Trans>Weitere Belege laden</Trans>
                </Button>
              </div>
            )}
          </>
        ))}

      {counts.total > 0 &&
        (activeTab === 'senders' || activeTab === 'runs' || activeTab === 'memory') && (
          <section className="pt-2">
            <Card className="space-y-6 border-neutral-200 bg-white p-4 shadow-sm">
              {activeTab === 'memory' && ruleSuggestions.length > 0 && (
                <section className="rounded-lg border border-emerald-100 bg-emerald-50/60 p-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h2 className="text-sm font-semibold text-emerald-950">
                        <Trans>Wiederkehrende Absender</Trans>
                      </h2>
                      <p className="mt-1 text-xs text-emerald-900">
                        <Trans>
                          Wenn Sie denselben Absender mehrfach gleich behandeln, kann NexaFile sich
                          das merken. Sie entscheiden, was gespeichert wird.
                        </Trans>
                      </p>
                    </div>
                    <span className="rounded-full bg-white px-2.5 py-1 text-xs font-medium text-emerald-800 ring-1 ring-emerald-200">
                      <Trans>
                        {activeRules.length} gemerkt · {suggestedRules.length} neu
                      </Trans>
                    </span>
                  </div>

                  {activeRules.length > 0 && (
                    <div className="mt-3 space-y-2">
                      <div className="text-xs font-semibold uppercase tracking-wide text-emerald-900">
                        <Trans>Schon gemerkt</Trans>
                      </div>
                      <ul className="space-y-2">
                        {activeRules.map((rule) => {
                          const isPending = updateRuleStatusMutation.isPending;
                          return (
                            <li
                              key={`${rule.scope}:${rule.pattern}:${rule.action}`}
                              className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-emerald-300 bg-white px-3 py-2"
                            >
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                  <div className="font-medium text-neutral-900">
                                    <Trans>
                                      Mails von <strong>{rule.label}</strong>
                                    </Trans>
                                  </div>
                                  <Badge variant="secondary" size="small" className="rounded-full">
                                    {ruleActionShortLabel(rule.action)}
                                  </Badge>
                                </div>
                                <div className="mt-0.5 text-xs text-neutral-500">
                                  <Trans>
                                    Bisher: {rule.evidenceCount} gleiche Entscheidungen · Sicherheit{' '}
                                    {rule.confidence}%
                                  </Trans>
                                  {rule.lastMatchedAt && (
                                    <>
                                      {' '}
                                      ·{' '}
                                      <Trans>
                                        zuletzt {formatDate(rule.lastMatchedAt, i18n.locale)}
                                      </Trans>
                                    </>
                                  )}
                                </div>
                              </div>
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={isPending}
                                onClick={() =>
                                  updateRuleStatusMutation.mutate({
                                    ...rule,
                                    status: 'dismissed',
                                  })
                                }
                              >
                                <Trans>Nicht mehr merken</Trans>
                              </Button>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  )}

                  {suggestedRules.length > 0 && (
                    <div className="mt-3 space-y-2">
                      <div className="text-xs font-semibold uppercase tracking-wide text-emerald-900">
                        <Trans>Kann NexaFile sich merken</Trans>
                      </div>
                      <ul className="space-y-2">
                        {suggestedRules.map((rule) => {
                          const isPending = updateRuleStatusMutation.isPending;
                          return (
                            <li
                              key={`${rule.scope}:${rule.pattern}:${rule.action}`}
                              className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-emerald-200 bg-white px-3 py-2"
                            >
                              <div className="min-w-0">
                                <div className="font-medium text-neutral-900">
                                  <Trans>
                                    Mails von <strong>{rule.label}</strong>{' '}
                                    {ruleActionLabel(rule.action)}
                                  </Trans>
                                </div>
                                <div className="mt-0.5 text-xs text-neutral-500">
                                  <Trans>
                                    Bisher: {rule.evidenceCount} gleiche Entscheidungen · Sicherheit{' '}
                                    {rule.confidence}%
                                  </Trans>
                                  {rule.oppositeCount > 0 && (
                                    <>
                                      {' '}
                                      ·{' '}
                                      <Trans>{rule.oppositeCount} abweichende Entscheidungen</Trans>
                                    </>
                                  )}
                                </div>
                              </div>
                              <div className="flex items-center gap-2">
                                <Button
                                  size="sm"
                                  disabled={isPending}
                                  onClick={() =>
                                    updateRuleStatusMutation.mutate({
                                      ...rule,
                                      status: 'active',
                                    })
                                  }
                                >
                                  <ShieldCheckIcon className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                                  <Trans>Merken</Trans>
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  disabled={isPending}
                                  onClick={() =>
                                    updateRuleStatusMutation.mutate({
                                      ...rule,
                                      status: 'dismissed',
                                    })
                                  }
                                >
                                  <Trans>Nicht vorschlagen</Trans>
                                </Button>
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  )}
                </section>
              )}

              {activeTab === 'memory' && ruleSuggestions.length === 0 && (
                <section className="rounded-lg border border-neutral-200 bg-neutral-50 p-4 text-sm">
                  <h2 className="font-semibold text-neutral-950">
                    <Trans>Noch nichts gemerkt</Trans>
                  </h2>
                  <p className="mt-1 text-neutral-600">
                    <Trans>
                      Sobald Sie denselben Absender wiederholt gleich behandeln, schlägt NexaFile
                      vor, sich diese Entscheidung zu merken.
                    </Trans>
                  </p>
                </section>
              )}

              {activeTab === 'senders' && (
                <section>
                  <div className="mb-3">
                    <h2 className="text-sm font-semibold text-neutral-900">
                      <Trans>Wer hat Belege geschickt?</Trans>
                    </h2>
                    <p className="mt-0.5 text-xs text-neutral-500">
                      <Trans>
                        Öffnen Sie einen Absender, wenn Sie nur dessen Belege prüfen möchten.
                      </Trans>
                    </p>
                  </div>
                  <CorrespondentSummaryCard teamUrl={teamUrl} />
                </section>
              )}

              {activeTab === 'memory' && (
                <section>
                  <h2 className="text-sm font-semibold text-neutral-900">
                    <Trans>Warum Belege geprüft werden</Trans>
                  </h2>
                  <p className="mt-0.5 text-xs text-neutral-500">
                    <Trans>
                      Kurzüberblick über sichere Treffer, offene Punkte und mögliche Dubletten.
                    </Trans>
                  </p>
                  <div className="mt-3 grid gap-3 text-sm md:grid-cols-4">
                    <div className="rounded-md border border-emerald-100 bg-emerald-50 p-3">
                      <div className="text-xs font-medium uppercase tracking-wide text-emerald-800">
                        <Trans>Sicher erkannt</Trans>
                      </div>
                      <div className="mt-1 font-semibold text-neutral-900">
                        {qualityCounts.high}
                      </div>
                    </div>
                    <div className="rounded-md border border-sky-100 bg-sky-50 p-3">
                      <div className="text-xs font-medium uppercase tracking-wide text-sky-800">
                        <Trans>Plausibel</Trans>
                      </div>
                      <div className="mt-1 font-semibold text-neutral-900">
                        {qualityCounts.medium}
                      </div>
                    </div>
                    <div className="rounded-md border border-amber-100 bg-amber-50 p-3">
                      <div className="text-xs font-medium uppercase tracking-wide text-amber-800">
                        <Trans>Bitte prüfen</Trans>
                      </div>
                      <div className="mt-1 font-semibold text-neutral-900">
                        {qualityCounts.needsCheck}
                      </div>
                    </div>
                    <div className="rounded-md border border-neutral-200 bg-neutral-50 p-3">
                      <div className="text-xs font-medium uppercase tracking-wide text-neutral-600">
                        <Trans>Auffälligkeiten</Trans>
                      </div>
                      <div className="mt-1 font-semibold text-neutral-900">
                        <Trans>
                          {qualityCounts.risks} offene Punkte · {qualityCounts.duplicates} mögliche
                          Dubletten
                        </Trans>
                      </div>
                    </div>
                  </div>
                </section>
              )}

              {activeTab === 'runs' && recentSyncRuns && recentSyncRuns.length > 0 && (
                <section className="space-y-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h2 className="text-sm font-semibold text-neutral-900">
                        <Trans>Durchsuchte Zeiträume</Trans>
                      </h2>
                      <p className="mt-0.5 text-xs text-neutral-500">
                        <Trans>
                          Zur Nachvollziehbarkeit: welche Postfächer wann geprüft wurden.
                        </Trans>
                      </p>
                    </div>
                    <Button asChild variant="ghost" size="sm">
                      <Link to="/settings/sources">
                        <Trans>Postfächer verwalten</Trans>
                      </Link>
                    </Button>
                  </div>

                  <ul className="space-y-2">
                    {recentSyncRuns.map((run) => {
                      const importedCount = run.documentsAuto + run.documentsManual;
                      const statusLabel =
                        run.status === 'RUNNING' || run.status === 'PENDING'
                          ? _(msg`wird geprüft`)
                          : run.status === 'SUCCESS'
                            ? _(msg`fertig`)
                            : run.status === 'FAILED'
                              ? _(msg`fehlgeschlagen`)
                              : _(msg`abgebrochen`);

                      return (
                        <li
                          key={run.id}
                          className="flex flex-wrap items-start justify-between gap-3 rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                              <span className="font-medium text-neutral-900">
                                {run.sourceLabel}
                              </span>
                              <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-medium text-neutral-600">
                                {statusLabel}
                              </span>
                            </div>
                            <div className="mt-0.5 text-sm text-neutral-700">
                              {formatDateRange(run.rangeFrom, run.rangeTo, i18n.locale)}
                            </div>
                            <div className="mt-0.5 text-xs text-neutral-500">
                              <Trans>
                                {importedCount} Beleg-Vorschläge, {run.documentsIgnored} ignoriert,{' '}
                                {run.documentsFailed} fehlgeschlagen, {run.mailsChecked} Mails
                                geprüft
                              </Trans>
                            </div>
                            <div className="mt-0.5 text-xs text-neutral-500">
                              {run.finishedAt ? (
                                <Trans>Beendet am {formatDate(run.finishedAt, i18n.locale)}</Trans>
                              ) : (
                                <Trans>Gestartet am {formatDate(run.startedAt, i18n.locale)}</Trans>
                              )}
                            </div>
                            {run.errorMessage && (
                              <div className="mt-1 text-xs text-red-700">{run.errorMessage}</div>
                            )}
                            {run.truncationReason && (
                              <div className="mt-1 rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-xs text-amber-900">
                                {run.truncationReason === 'BYTES_CAP' ? (
                                  <Trans>
                                    Suche vorzeitig beendet: Datenmenge-Limit erreicht. Bitte einen
                                    weitere Suche für den älteren Teil starten.
                                  </Trans>
                                ) : (
                                  <Trans>
                                    Suche vorzeitig beendet: Mail-Anzahl-Limit erreicht. Bitte einen
                                    weitere Suche mit kürzerem Zeitraum starten.
                                  </Trans>
                                )}
                              </div>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              )}
              {activeTab === 'runs' && (!recentSyncRuns || recentSyncRuns.length === 0) && (
                <section className="rounded-lg border border-neutral-200 bg-neutral-50 p-4 text-sm">
                  <h2 className="font-semibold text-neutral-950">
                    <Trans>Noch keine Suche abgeschlossen</Trans>
                  </h2>
                  <p className="mt-1 text-neutral-600">
                    <Trans>
                      Sobald ein Postfach durchsucht wurde, sehen Sie hier den Zeitraum und das
                      Ergebnis.
                    </Trans>
                  </p>
                </section>
              )}
            </Card>
          </section>
        )}

      {/* BESTÄTIGEN-BAR — sticky bottom, immer sichtbar wenn Treffer da sind. */}
      {counts.total > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-neutral-200 bg-white shadow-lg">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3 md:px-6">
            <div className="text-sm">
              <div className="font-medium text-neutral-900">
                <span className="text-emerald-700">
                  <Trans>{counts.archive} ins Archiv</Trans>
                </span>{' '}
                ·{' '}
                <span className="text-neutral-600">
                  <Trans>{counts.ignore} ignorieren</Trans>
                </span>
                {counts.undecided > 0 && (
                  <>
                    {' '}
                    ·{' '}
                    <span className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-900">
                      <Trans>{counts.undecided} noch zu entscheiden</Trans>
                    </span>
                  </>
                )}
              </div>
              <div className="mt-0.5 text-xs text-neutral-500">
                {counts.undecided > 0 ? (
                  <>
                    <Trans>
                      Bitte erst die offenen Vorschläge entscheiden, damit nichts versehentlich
                      übersprungen wird.
                    </Trans>{' '}
                    <button
                      onClick={() => openList('undecided')}
                      className="font-medium text-amber-700 underline-offset-2 hover:underline"
                    >
                      <Trans>Offene Vorschläge anzeigen →</Trans>
                    </button>
                  </>
                ) : unreviewedRiskyArchiveCount > 0 ? (
                  <>
                    <Trans>
                      {unreviewedRiskyArchiveCount} Belege bitte kurz prüfen, bevor sie ins Archiv
                      gehen.
                    </Trans>{' '}
                    <button
                      onClick={() => {
                        setFilter('needs-check');
                        setReviewQueueOpen(true);
                        setActiveTab('focus');
                      }}
                      className="font-medium text-amber-700 underline-offset-2 hover:underline"
                    >
                      <Trans>Prüfung starten →</Trans>
                    </button>
                  </>
                ) : (
                  <>
                    <Trans>
                      Beim Bestätigen gehen {counts.archive} Belege in den Archivbereich. Dort
                      können Sie Felder korrigieren und endgültig archivieren.
                    </Trans>{' '}
                    {manualChangeCount > 0 && (
                      <span>
                        <Trans>{manualChangeCount} Entscheidungen haben Sie aktiv geändert.</Trans>
                      </span>
                    )}
                    {manualChangeCount === 0 && ruleAppliedCount > 0 && (
                      <span>
                        <Trans>
                          {ruleAppliedCount} Empfehlungen basieren auf bekannten Absendern.
                        </Trans>
                      </span>
                    )}
                  </>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
                <Button
                  size="lg"
                  disabled={
                    isCommitting ||
                    counts.undecided > 0 ||
                    unreviewedRiskyArchiveCount > 0 ||
                    (counts.archive === 0 && counts.ignore === 0)
                  }
                  onClick={() => setConfirmOpen(true)}
                >
                  {isCommitting ? (
                    <Loader2Icon className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                  ) : (
                    <CheckCircleIcon className="mr-2 h-4 w-4" aria-hidden />
                  )}
                  <Trans>Bestätigen — Entscheidungen übernehmen →</Trans>
                </Button>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>
                      <Trans>Entscheidungen übernehmen?</Trans>
                    </AlertDialogTitle>
                    <AlertDialogDescription className="space-y-3">
                      <span className="block">
                        <Trans>
                          Wir legen jetzt <strong>{counts.archive} Belege</strong> in den
                          Archivbereich und entfernen <strong>{counts.ignore} Mails</strong> aus
                          dieser Liste.
                        </Trans>
                      </span>
                      <span className="block">
                        <Trans>
                          Das ist noch nicht die endgültige Archivierung. Im Archiv können Sie die
                          übernommenen Belege weiter prüfen und korrigieren.
                        </Trans>
                      </span>
                      {counts.ignore > 0 && (
                        <span className="block rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 text-neutral-700">
                          <Trans>
                            Ignorierte Mails verschwinden aus dieser Liste. Falls Sie unsicher sind,
                            brechen Sie ab und lassen den Vorschlag offen.
                          </Trans>
                        </span>
                      )}
                      {manualChangeCount > 0 && (
                        <span className="block text-sky-800">
                          <Trans>
                            {manualChangeCount} Entscheidungen stammen von Ihnen, der Rest sind
                            NexaFile-Vorschläge.
                          </Trans>
                        </span>
                      )}
                      {ruleAppliedCount > 0 && (
                        <span className="block text-emerald-800">
                          <Trans>
                            {ruleAppliedCount} Empfehlungen basieren auf bekannten Absendern.
                          </Trans>
                        </span>
                      )}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel disabled={isCommitting}>
                      <Trans>Nochmal prüfen</Trans>
                    </AlertDialogCancel>
                    <AlertDialogAction onClick={() => void handleConfirm()} disabled={isCommitting}>
                      {isCommitting && (
                        <Loader2Icon className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                      )}
                      <Trans>Ja, übernehmen</Trans>
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const WorkspaceTabButton = ({
  active,
  onClick,
  title,
  subtitle,
  count,
  tone = 'neutral',
}: {
  active: boolean;
  onClick: () => void;
  title: React.ReactNode;
  subtitle: React.ReactNode;
  count?: React.ReactNode;
  tone?: 'amber' | 'emerald' | 'neutral';
}) => {
  const badgeClass = active
    ? 'bg-white/15 text-white ring-white/20'
    : tone === 'emerald'
      ? 'bg-emerald-50 text-emerald-800 ring-emerald-200'
      : tone === 'amber'
        ? 'bg-amber-50 text-amber-900 ring-amber-200'
        : 'bg-neutral-100 text-neutral-700 ring-neutral-200';

  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg border p-3 text-left transition-colors ${
        active
          ? 'border-neutral-950 bg-neutral-950 text-white shadow-sm'
          : 'border-neutral-200 bg-white text-neutral-900 hover:border-neutral-300 hover:bg-neutral-50'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-sm font-semibold">{title}</span>
        {count !== undefined && (
          <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ${badgeClass}`}>
            {count}
          </span>
        )}
      </div>
      <div className={`mt-1 text-xs ${active ? 'text-neutral-300' : 'text-neutral-500'}`}>
        {subtitle}
      </div>
    </button>
  );
};

const FilterPill = ({
  active,
  onClick,
  label,
  count,
  color,
}: {
  active: boolean;
  onClick: () => void;
  label: React.ReactNode;
  count: number;
  color?: 'emerald' | 'neutral' | 'amber';
}) => {
  const inactiveColor =
    color === 'emerald'
      ? 'text-emerald-700 hover:bg-emerald-50'
      : color === 'amber'
        ? 'text-amber-700 hover:bg-amber-50'
        : color === 'neutral'
          ? 'text-neutral-600 hover:bg-neutral-100'
          : 'text-neutral-600 hover:bg-neutral-100';
  return (
    <button
      onClick={onClick}
      className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
        active ? 'bg-neutral-900 text-white' : inactiveColor
      }`}
    >
      {label}
      <span className={`ml-1.5 ${active ? 'text-neutral-300' : 'text-neutral-400'}`}>{count}</span>
    </button>
  );
};

const EmptyState = ({ hasSources }: { hasSources: boolean }) => {
  if (!hasSources) {
    return (
      <Card className="flex flex-col items-center gap-4 px-6 py-12 text-center">
        <Illustration
          name="empty-mailbox"
          alt="Noch kein Postfach verbunden"
          tone="sky"
          className="h-32 w-full max-w-[200px]"
        />
        <h2 className="text-lg font-semibold">
          <Trans>Noch keine Quelle verbunden</Trans>
        </h2>
        <p className="max-w-md text-sm text-neutral-600">
          <Trans>
            Verbinden Sie ein E-Mail-Postfach, damit wir Belege automatisch finden können.
          </Trans>
        </p>
        <Button asChild>
          <Link to="connect">
            <ExternalLinkIcon className="mr-2 h-4 w-4" aria-hidden />
            <Trans>Postfach verbinden</Trans>
          </Link>
        </Button>
      </Card>
    );
  }

  return (
    <Card className="flex flex-col items-center gap-4 px-6 py-12 text-center">
      <Illustration
        name="all-done"
        alt="Alles entschieden"
        tone="emerald"
        className="h-32 w-full max-w-[200px]"
      />
      <h2 className="text-lg font-semibold">
        <Trans>Alles entschieden</Trans>
      </h2>
      <p className="max-w-md text-sm text-neutral-600">
        <Trans>
          Keine Belege warten mehr auf eine Entscheidung. Was schon übernommen ist, finden Sie im
          Archiv-Tab.
        </Trans>
      </p>
      <Button asChild variant="outline">
        <Link to="connect">
          <MailSearchIcon className="mr-2 h-4 w-4" aria-hidden />
          <Trans>Postfach erneut durchsuchen</Trans>
        </Link>
      </Button>
    </Card>
  );
};
