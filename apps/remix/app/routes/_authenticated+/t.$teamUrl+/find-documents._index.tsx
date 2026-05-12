// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 NexaStack, NexaSign contributors
//
// /find-documents — Wireframe-konforme Trefferliste (finden-ergebnisse.html).
// Zeigt ausschliesslich Eingangs-Belege (status='inbox' + 'pending-manual').
// Per-Zeile entscheidet der Nutzer client-seitig (Ins Archiv / Ignorieren),
// am Ende ein Klick auf Bestätigen → Batch-Commit (bulkAccept + bulkIgnore).
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
  SparklesIcon,
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

const decisionLabel = (decision: Decision, isManual: boolean): string => {
  const prefix = isManual ? 'Von Ihnen gewählt' : 'Vorschlag';
  if (decision === 'archive') return `${prefix}: ins Archiv`;
  if (decision === 'ignore') return `${prefix}: ignorieren`;
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

const ruleActionLabel = (action: 'archive' | 'ignore'): string =>
  action === 'archive' ? 'künftig als Beleg vorschlagen' : 'künftig eher ignorieren';

const ruleActionShortLabel = (action: 'archive' | 'ignore'): string =>
  action === 'archive' ? 'Ins Archiv vorschlagen' : 'Ignorieren vorschlagen';

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
    return `Ähnlicher Fall: Mails von ${doc.ruleMatch.label} haben Sie bisher meist so entschieden.`;
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
  isSelected,
  isPending,
  onChange,
  onToggleSelect,
}: {
  doc: Document;
  locale: string;
  decision: Decision;
  isManual: boolean;
  isSelected: boolean;
  isPending: boolean;
  onChange: (next: Decision) => void;
  onToggleSelect: () => void;
}) => {
  const hint = decisionReason(doc, decision);
  const dimmed = decision === 'ignore';

  return (
    <li
      data-rule-match={doc.ruleMatch ? 'true' : undefined}
      className={`group relative flex items-stretch overflow-hidden rounded-md border shadow-sm transition-all hover:shadow-md ${
        isSelected
          ? 'border-primary ring-2 ring-primary/30'
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
          className="flex min-w-0 flex-1 items-start gap-3 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <FileTextIcon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <span className={`font-medium ${dimmed ? 'text-neutral-500' : 'text-foreground'}`}>
                {doc.correspondent ?? doc.title}
              </span>
              {doc.detectedAmount && (
                <span
                  className={`text-sm tabular-nums ${dimmed ? 'text-neutral-400' : 'text-foreground'}`}
                >
                  {doc.detectedAmount}
                </span>
              )}
              <span className="text-xs tabular-nums text-neutral-500">
                {formatDate(doc.documentDate ?? doc.capturedAt, locale)}
              </span>
              {doc.hasArchive && doc.attachmentCount > 0 && (
                <span
                  className="inline-flex items-center gap-0.5 text-xs text-neutral-500"
                  title="Anhang vorhanden"
                >
                  <PaperclipIcon className="h-3 w-3" aria-hidden />
                  {doc.attachmentCount}
                </span>
              )}
              {decision === 'undecided' && (
                <span className="ml-1 rounded-sm bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-900">
                  <Trans>Noch zu entscheiden</Trans>
                </span>
              )}
              <Badge
                variant={isManual ? 'secondary' : decision === 'undecided' ? 'warning' : 'neutral'}
                size="small"
                className={`ml-1 rounded-full ${decisionPillClass(decision)}`}
              >
                {decisionLabel(decision, isManual)}
              </Badge>
              {typeof doc.confidence === 'number' && (
                <span
                  className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${confidenceClass(doc)}`}
                  title={`Trefferqualität: ${doc.confidence}/100`}
                >
                  <ShieldCheckIcon className="h-3 w-3" aria-hidden />
                  {confidenceLabel(doc)} · {doc.confidence}%
                </span>
              )}
              {doc.ruleMatch && (
                <span
                  className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-900 ring-1 ring-emerald-200"
                  title={`Sicherheit dieses Vorschlags: ${doc.ruleMatch.confidence}%`}
                >
                  <SparklesIcon className="h-3 w-3" aria-hidden />
                  <Trans>Ähnlicher Fall: {doc.ruleMatch.label}</Trans>
                </span>
              )}
            </div>
            <div
              className={`mt-0.5 truncate text-sm group-hover:underline ${
                dimmed ? 'text-neutral-500' : 'text-neutral-700'
              }`}
            >
              {doc.title}
            </div>
            <div className="mt-0.5 text-xs text-neutral-500">{hint}</div>
            {((doc.riskFlags?.length ?? 0) > 0 || (doc.duplicateCount ?? 0) > 0) && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {(doc.duplicateCount ?? 0) > 0 && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-900">
                    <TriangleAlertIcon className="h-3 w-3" aria-hidden />
                    {doc.duplicateCount === 1
                      ? 'Mögliche Dublette im aktuellen Filter'
                      : `${doc.duplicateCount} mögliche Dubletten im aktuellen Filter`}
                  </span>
                )}
                {(doc.riskFlags ?? []).map((flag) => (
                  <span
                    key={flag}
                    className="inline-flex items-center gap-1 rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-medium text-neutral-700"
                  >
                    <TriangleAlertIcon className="h-3 w-3" aria-hidden />
                    {flag}
                  </span>
                ))}
              </div>
            )}
          </div>
        </Link>

        <div className="flex shrink-0 items-center gap-2">
          <div
            role="group"
            aria-label="Entscheidung"
            className="flex overflow-hidden rounded-md border border-neutral-300"
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
              <Trans>Ignorieren</Trans>
            </Button>
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
                <Trans>Noch nicht entscheiden</Trans>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
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
  const [confirmOpen, setConfirmOpen] = useState(false);
  // Multi-Select für Bulk-Aktionen (z.B. mehrere Zeilen gleichzeitig von
  // "Für Archivierung ausgewählt" auf "Zum Ignorieren ausgewählt" umstellen).
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
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
    if (filter === 'needs-check') return allInboxDocs.filter(needsHumanCheck);
    return allInboxDocs.filter((doc) => {
      const d = decisions.get(doc.id) ?? 'undecided';
      return d === filter;
    });
  }, [allInboxDocs, decisions, filter]);

  const unreviewedRiskyArchiveCount = useMemo(
    () =>
      allInboxDocs.filter(
        (doc) =>
          decisions.get(doc.id) === 'archive' &&
          needsHumanCheck(doc) &&
          !manualDecisionIds.has(doc.id),
      ).length,
    [allInboxDocs, decisions, manualDecisionIds],
  );

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
                    Wir haben {totalHits} Treffer im Zeitraum {latestCompletedRangeLabel} gefunden
                  </Trans>
                ) : (
                  <Trans>Wir haben {totalHits} Treffer gefunden</Trans>
                )
              ) : (
                <Trans>Belege aus dem Postfach</Trans>
              )}
            </h1>
            <p className="mt-1 text-sm text-neutral-600">
              <Trans>
                Prüfen Sie die Trefferliste. Wenn ein Vorschlag passt, müssen Sie nichts ändern.
                Erst mit <strong>Bestätigen</strong> wird etwas übernommen.
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
                <Trans>Lauf läuft… ({activeRunsCount})</Trans>
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
        <Card className="grid gap-3 border-neutral-200 bg-white p-4 text-sm shadow-sm md:grid-cols-[1.4fr_1fr_auto] md:items-center">
          <div>
            <div className="text-xs font-medium uppercase tracking-wide text-neutral-500">
              <Trans>Nächster Schritt</Trans>
            </div>
            <div className="mt-1 font-semibold text-neutral-900">
              {qualityCounts.needsCheck > 0 ? (
                <Trans>{qualityCounts.needsCheck} unsichere Treffer zuerst prüfen</Trans>
              ) : counts.undecided > 0 ? (
                <Trans>{counts.undecided} offene Treffer entscheiden</Trans>
              ) : (
                <Trans>Stapel bereit zum Bestätigen</Trans>
              )}
            </div>
            <p className="mt-1 text-neutral-600">
              <Trans>
                Die Liste darunter ist die Arbeitsfläche. Statistiken und Suchlaufdetails stehen
                weiter unten.
              </Trans>
            </p>
          </div>
          <div className="flex flex-wrap gap-2 text-xs">
            <span className="rounded-full bg-emerald-50 px-2.5 py-1 font-medium text-emerald-800 ring-1 ring-emerald-200">
              <Trans>{counts.archive} ins Archiv</Trans>
            </span>
            <span className="rounded-full bg-neutral-100 px-2.5 py-1 font-medium text-neutral-700 ring-1 ring-neutral-200">
              <Trans>{counts.ignore} ignorieren</Trans>
            </span>
            {qualityCounts.needsCheck > 0 && (
              <span className="rounded-full bg-amber-50 px-2.5 py-1 font-medium text-amber-900 ring-1 ring-amber-200">
                <Trans>{qualityCounts.needsCheck} prüfen</Trans>
              </span>
            )}
            {ruleAppliedCount > 0 && (
              <span className="rounded-full bg-sky-50 px-2.5 py-1 font-medium text-sky-800 ring-1 ring-sky-200">
                <Trans>{ruleAppliedCount} ähnliche Fälle</Trans>
              </span>
            )}
          </div>
          <div className="flex flex-wrap gap-2 md:justify-end">
            {qualityCounts.needsCheck > 0 && (
              <Button size="sm" variant="outline" onClick={() => setFilter('needs-check')}>
                <Trans>Prüfen</Trans>
              </Button>
            )}
            {ruleAppliedCount > 0 && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setFilter('all');
                  window.requestAnimationFrame(() => {
                    document
                      .querySelector('[data-rule-match="true"]')
                      ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                  });
                }}
              >
                <Trans>Ähnliche Fälle</Trans>
              </Button>
            )}
          </div>
        </Card>
      )}

      {counts.total > 0 && (
        <div className="flex flex-col gap-3 rounded-xl border border-neutral-200 bg-white p-3 shadow-sm md:flex-row md:items-center md:justify-between">
          <div className="flex flex-wrap items-center gap-1">
            <FilterPill
              active={filter === 'all'}
              onClick={() => setFilter('all')}
              label={<Trans>Alle</Trans>}
              count={counts.total}
            />
            {qualityCounts.needsCheck > 0 && (
              <FilterPill
                active={filter === 'needs-check'}
                onClick={() => setFilter('needs-check')}
                label={<Trans>Zu prüfen</Trans>}
                count={qualityCounts.needsCheck}
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
          </div>

          <Input
            type="search"
            placeholder={_(msg`Suchen: Absender, Betreff, Rechnungs-Nr.`)}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="md:max-w-xs"
          />
        </div>
      )}

      {ruleSuggestions.length > 0 && (
        <Card className="border-emerald-100 bg-emerald-50/60 p-3 text-sm">
          <details>
            <summary className="cursor-pointer font-medium text-emerald-950">
              <Trans>Wiederkehrende Entscheidungen</Trans>
              <span className="ml-2 text-xs font-normal text-emerald-800">
                <Trans>
                  {activeRules.length} gemerkt · {suggestedRules.length} neu
                </Trans>
              </span>
            </summary>
            <p className="mt-2 text-emerald-900">
              <Trans>
                NexaFile erkennt ähnliche Absender und schlägt dieselbe Entscheidung vor, die Sie
                früher meist gewählt haben.
              </Trans>
            </p>

            {activeRules.length > 0 && (
              <div className="mt-3 space-y-2">
                <div className="text-xs font-semibold uppercase tracking-wide text-emerald-900">
                  <Trans>Gemerkte Entscheidungen</Trans>
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
                              Grundlage: {rule.evidenceCount} gleiche Entscheidungen · Sicherheit{' '}
                              {rule.confidence}%
                            </Trans>
                            {rule.lastMatchedAt && (
                              <>
                                {' '}
                                ·{' '}
                                <Trans>zuletzt {formatDate(rule.lastMatchedAt, i18n.locale)}</Trans>
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
                  <Trans>Neue Muster</Trans>
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
                              Mails von <strong>{rule.label}</strong> {ruleActionLabel(rule.action)}
                            </Trans>
                          </div>
                          <div className="mt-0.5 text-xs text-neutral-500">
                            <Trans>
                              Grundlage: {rule.evidenceCount} gleiche Entscheidungen · Sicherheit{' '}
                              {rule.confidence}%
                            </Trans>
                            {rule.oppositeCount > 0 && (
                              <>
                                {' '}
                                · <Trans>{rule.oppositeCount} abweichende Entscheidungen</Trans>
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
                            <Trans>Für ähnliche Fälle merken</Trans>
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
          </details>
        </Card>
      )}

      {counts.total > 0 && qualityCounts.needsCheck > 0 && filter !== 'needs-check' && (
        <Card className="flex flex-wrap items-start justify-between gap-3 border-amber-200 bg-amber-50 p-3 text-sm">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 font-semibold text-amber-950">
              <TriangleAlertIcon className="h-4 w-4" aria-hidden />
              <Trans>{qualityCounts.needsCheck} Treffer brauchen Ihre Prüfung</Trans>
            </div>
            <p className="mt-1 text-neutral-600">
              <Trans>Niedrige Sicherheit oder mögliche Dubletten. Prüfen Sie diese zuerst.</Trans>
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={() => setFilter('needs-check')}>
            <Trans>Anzeigen</Trans>
          </Button>
        </Card>
      )}

      {/* MULTI-SELECT-BULK-BAR — sticky oben, sichtbar sobald >=1 markiert. */}
      {selectedIds.size > 0 && (
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
              <Trans>Auswahl ändern auf:</Trans>
            </span>
            <Button
              size="sm"
              variant="outline"
              onClick={() => handleBulkDecision('archive')}
              className="border-emerald-300 bg-emerald-600 text-white hover:bg-emerald-700"
            >
              <CheckCircleIcon className="mr-1.5 h-3.5 w-3.5" aria-hidden />
              <Trans>Für Archivierung</Trans>
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => handleBulkDecision('ignore')}
              className="border-neutral-500 bg-neutral-700 text-white hover:bg-neutral-800"
            >
              <XCircleIcon className="mr-1.5 h-3.5 w-3.5" aria-hidden />
              <Trans>Zum Ignorieren</Trans>
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => handleBulkDecision('undecided')}
              className="text-neutral-300 hover:bg-white/10 hover:text-white"
            >
              <ClockIcon className="mr-1.5 h-3.5 w-3.5" aria-hidden />
              <Trans>Noch zu entscheiden</Trans>
            </Button>
          </div>
        </div>
      )}

      {/* MASTER-CHECKBOX um alle sichtbaren auszuwählen. */}
      {counts.total > 0 && visibleDocs.length > 0 && selectedIds.size === 0 && (
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

      {/* LISTE */}
      {isLoading ? (
        <Card className="flex items-center justify-center py-12 text-neutral-500">
          <Loader2Icon className="mr-2 h-4 w-4 animate-spin" aria-hidden />
          <Trans>Belege werden geladen…</Trans>
        </Card>
      ) : counts.total === 0 ? (
        <EmptyState hasSources={(queueMeta?.sources.length ?? 0) > 0} />
      ) : visibleDocs.length === 0 ? (
        <Card className="px-6 py-12 text-center text-sm text-neutral-500">
          <Trans>Keine Treffer in dieser Sicht.</Trans>
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
                isSelected={selectedIds.has(doc.id)}
                isPending={isCommitting}
                onChange={(next) => handleDecision(doc.id, next)}
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
                <Trans>Weitere Treffer laden</Trans>
              </Button>
            </div>
          )}
        </>
      )}

      {counts.total > 0 && (
        <section className="space-y-3 pt-2">
          <details className="rounded-xl border border-neutral-200 bg-white p-4">
            <summary className="cursor-pointer text-sm font-semibold text-neutral-900">
              <Trans>Absender und Quellen</Trans>
              <span className="ml-2 text-xs font-normal text-neutral-500">
                <Trans>nur öffnen, wenn Sie die Herkunft der Treffer prüfen möchten</Trans>
              </span>
            </summary>
            <div className="mt-4">
              <CorrespondentSummaryCard teamUrl={teamUrl} />
            </div>
          </details>

          <details className="rounded-xl border border-neutral-200 bg-white p-4">
            <summary className="cursor-pointer text-sm font-semibold text-neutral-900">
              <Trans>Qualität und Suchläufe</Trans>
              <span className="ml-2 text-xs font-normal text-neutral-500">
                <Trans>
                  {qualityCounts.high} sicher · {qualityCounts.medium} plausibel ·{' '}
                  {qualityCounts.low} unsicher
                </Trans>
              </span>
            </summary>

            <div className="mt-4 grid gap-3 text-sm md:grid-cols-4">
              <div className="rounded-md border border-emerald-100 bg-emerald-50 p-3">
                <div className="text-xs font-medium uppercase tracking-wide text-emerald-800">
                  <Trans>Sehr sicher</Trans>
                </div>
                <div className="mt-1 font-semibold text-neutral-900">{qualityCounts.high}</div>
              </div>
              <div className="rounded-md border border-sky-100 bg-sky-50 p-3">
                <div className="text-xs font-medium uppercase tracking-wide text-sky-800">
                  <Trans>Plausibel</Trans>
                </div>
                <div className="mt-1 font-semibold text-neutral-900">{qualityCounts.medium}</div>
              </div>
              <div className="rounded-md border border-amber-100 bg-amber-50 p-3">
                <div className="text-xs font-medium uppercase tracking-wide text-amber-800">
                  <Trans>Unsicher</Trans>
                </div>
                <div className="mt-1 font-semibold text-neutral-900">{qualityCounts.low}</div>
              </div>
              <div className="rounded-md border border-neutral-200 bg-neutral-50 p-3">
                <div className="text-xs font-medium uppercase tracking-wide text-neutral-600">
                  <Trans>Hinweise</Trans>
                </div>
                <div className="mt-1 font-semibold text-neutral-900">
                  <Trans>
                    {qualityCounts.risks} Risiken · {qualityCounts.duplicates} Dubletten
                  </Trans>
                </div>
              </div>
            </div>

            {recentSyncRuns && recentSyncRuns.length > 0 && (
              <div className="mt-5 space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-semibold text-neutral-900">
                      <Trans>Letzte Suchläufe</Trans>
                    </h2>
                    <p className="mt-0.5 text-xs text-neutral-600">
                      <Trans>
                        Technische Details dazu, aus welchen Zeiträumen die aktuellen Treffer
                        stammen.
                      </Trans>
                    </p>
                  </div>
                  <Button asChild variant="ghost" size="sm">
                    <Link to="/settings/sources">
                      <Trans>Quellen öffnen</Trans>
                    </Link>
                  </Button>
                </div>

                <ul className="space-y-2">
                  {recentSyncRuns.map((run) => {
                    const importedCount = run.documentsAuto + run.documentsManual;
                    const statusLabel =
                      run.status === 'RUNNING' || run.status === 'PENDING'
                        ? _(msg`läuft`)
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
                            <span className="font-medium text-neutral-900">{run.sourceLabel}</span>
                            <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-medium text-neutral-600">
                              {statusLabel}
                            </span>
                          </div>
                          <div className="mt-0.5 text-sm text-neutral-700">
                            {formatDateRange(run.rangeFrom, run.rangeTo, i18n.locale)}
                          </div>
                          <div className="mt-0.5 text-xs text-neutral-500">
                            <Trans>
                              {importedCount} Treffer, {run.documentsIgnored} ignoriert,{' '}
                              {run.documentsFailed} fehlgeschlagen, {run.mailsChecked} Mails geprüft
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
                                  Lauf vorzeitig beendet: Datenmenge-Limit erreicht. Bitte einen
                                  Folgelauf für den älteren Teil starten.
                                </Trans>
                              ) : (
                                <Trans>
                                  Lauf vorzeitig beendet: Mail-Anzahl-Limit erreicht. Bitte einen
                                  Folgelauf mit kürzerem Zeitraum starten.
                                </Trans>
                              )}
                            </div>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </details>
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
                      Bitte erst die offenen Zeilen entscheiden — sonst geht uns ein Beleg verloren.
                    </Trans>{' '}
                    <button
                      onClick={() => setFilter('undecided')}
                      className="font-medium text-amber-700 underline-offset-2 hover:underline"
                    >
                      <Trans>Offene Zeilen anzeigen →</Trans>
                    </button>
                  </>
                ) : unreviewedRiskyArchiveCount > 0 ? (
                  <>
                    <Trans>
                      {unreviewedRiskyArchiveCount} unsichere Archiv-Vorschläge bitte kurz prüfen.
                    </Trans>{' '}
                    <button
                      onClick={() => setFilter('needs-check')}
                      className="font-medium text-amber-700 underline-offset-2 hover:underline"
                    >
                      <Trans>Zu prüfende Treffer anzeigen →</Trans>
                    </button>
                  </>
                ) : (
                  <>
                    <Trans>
                      Beim Bestätigen landen die {counts.archive} Belege im Archiv (noch
                      korrigierbar). Endgültig archivieren ist Stufe 2 im Archiv-Tab.
                    </Trans>{' '}
                    {manualChangeCount > 0 && (
                      <span>
                        <Trans>{manualChangeCount} Entscheidungen haben Sie aktiv geändert.</Trans>
                      </span>
                    )}
                    {manualChangeCount === 0 && ruleAppliedCount > 0 && (
                      <span>
                        <Trans>
                          {ruleAppliedCount} Entscheidungen basieren auf ähnlichen Fällen.
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
                          Wir übernehmen jetzt <strong>{counts.archive} Belege</strong> in den
                          korrigierbaren Archiv-Stapel und markieren{' '}
                          <strong>{counts.ignore} Mails</strong> als kein Beleg.
                        </Trans>
                      </span>
                      <span className="block">
                        <Trans>
                          Das ist noch nicht die endgültige Archivierung. Übernommene Belege können
                          Sie im Archiv weiter prüfen und korrigieren.
                        </Trans>
                      </span>
                      {counts.ignore > 0 && (
                        <span className="block rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 text-neutral-700">
                          <Trans>
                            Ignorierte Mails verschwinden aus dieser Arbeitsliste. Falls Sie
                            unsicher sind, brechen Sie ab und setzen die Zeile auf „Noch nicht
                            entscheiden".
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
                            {ruleAppliedCount} Vorschläge basieren auf ähnlichen Fällen.
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
          <Trans>Neuen Lauf starten</Trans>
        </Link>
      </Button>
    </Card>
  );
};
