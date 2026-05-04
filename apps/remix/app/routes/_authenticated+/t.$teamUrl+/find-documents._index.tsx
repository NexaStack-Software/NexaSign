// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 NexaStack, NexaSign contributors
import { useEffect, useMemo, useRef, useState } from 'react';

import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react';
import { Trans } from '@lingui/react/macro';
import {
  AlertCircleIcon,
  ArchiveIcon,
  BarChart3Icon,
  CalendarIcon,
  CheckCircleIcon,
  ClockIcon,
  DownloadIcon,
  FileTextIcon,
  InboxIcon,
  Loader2Icon,
  MoreHorizontalIcon,
  PaperclipIcon,
  PlayIcon,
  PlugIcon,
  SearchIcon,
  Settings2Icon,
  XCircleIcon,
} from 'lucide-react';
import { Link, useParams } from 'react-router';

import { trpc } from '@nexasign/trpc/react';
import type {
  TDiscoveryDocumentAction,
  TFindDiscoveryDocumentsResponse,
} from '@nexasign/trpc/server/discovery-router/schema';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@nexasign/ui/primitives/select';
import { Skeleton } from '@nexasign/ui/primitives/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@nexasign/ui/primitives/tabs';
import { useToast } from '@nexasign/ui/primitives/use-toast';

import { AcceptDiscoveryDocumentButton } from '~/components/dialogs/accept-discovery-document-button';
import { TaxPackageConfirmButton } from '~/components/dialogs/tax-package-confirm-button';
import { SyncOverviewCard } from '~/components/discovery/sync-overview-card';

// Vollständiger Status-Enum (matcht das tRPC-Schema). Tabs zeigen aber nur
// die 4 Hauptzustände — IGNORED ist via Filter erreichbar, PROCESSED ist eine
// Sammel-Kategorie.
type DiscoveryStatus =
  | 'inbox'
  | 'pending-manual'
  | 'accepted'
  | 'archived'
  | 'ignored'
  | 'processed';
// "all" ist die Default-Übersicht — alle Belege auf einen Blick, sortiert nach
// Datum. Die anderen Tabs sind Workflow-Filter.
type DiscoveryTab = 'all' | 'inbox' | 'pending-manual' | 'accepted' | 'archived';
type FocusFilter =
  | 'all'
  | 'needs-review'
  | 'downloadable'
  | 'missing-amount'
  | 'missing-invoice-number';
type Document = TFindDiscoveryDocumentsResponse['documents'][number];
type Source = TFindDiscoveryDocumentsResponse['sources'][number];

const STATUS_TABS: ReadonlyArray<{ value: DiscoveryTab; label: ReturnType<typeof msg> }> = [
  { value: 'all', label: msg`Alle` },
  { value: 'inbox', label: msg`Eingang` },
  { value: 'pending-manual', label: msg`Manuell zu ziehen` },
  { value: 'accepted', label: msg`Akzeptiert` },
  { value: 'archived', label: msg`Archiv` },
];

const TAX_SEARCH_TERM = 'Rechnung';
const FOCUS_FILTERS: ReadonlyArray<{ value: FocusFilter; label: ReturnType<typeof msg> }> = [
  { value: 'all', label: msg`Alle Treffer` },
  { value: 'needs-review', label: msg`Offen` },
  { value: 'downloadable', label: msg`Mit Anhang` },
  { value: 'missing-amount', label: msg`Ohne Betrag` },
  { value: 'missing-invoice-number', label: msg`Ohne Nr.` },
];

const formatRelativeTime = (date: Date, locale: string): string => {
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  const diffSeconds = Math.round((date.getTime() - Date.now()) / 1000);
  const diffMinutes = Math.round(diffSeconds / 60);
  const diffHours = Math.round(diffMinutes / 60);
  const diffDays = Math.round(diffHours / 24);
  if (Math.abs(diffSeconds) < 60) return rtf.format(diffSeconds, 'second');
  if (Math.abs(diffMinutes) < 60) return rtf.format(diffMinutes, 'minute');
  if (Math.abs(diffHours) < 24) return rtf.format(diffHours, 'hour');
  return rtf.format(diffDays, 'day');
};

const formatDate = (date: Date | null, locale: string): string => {
  if (!date) return '–';
  return new Intl.DateTimeFormat(locale, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date);
};

const toDateInputValue = (date: Date): string => date.toISOString().slice(0, 10);

const addDays = (value: string, days: number): Date => {
  const date = new Date(`${value}T00:00:00`);
  date.setDate(date.getDate() + days);
  return date;
};

const parseDateInput = (value: string): Date | null => {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
};

const startOfYear = (year: number): string => `${year}-01-01`;
const endOfYear = (year: number): string => `${year}-12-31`;

const getDocumentWorkDate = (doc: Document): Date => doc.documentDate ?? doc.capturedAt;

const getYearMonthKey = (date: Date): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

const monthKeyToRange = (key: string): { from: string; to: string } | null => {
  const [yearValue, monthValue] = key.split('-').map(Number);
  if (!yearValue || !monthValue || monthValue < 1 || monthValue > 12) return null;
  const from = new Date(yearValue, monthValue - 1, 1);
  const to = new Date(yearValue, monthValue, 0);
  return { from: toDateInputValue(from), to: toDateInputValue(to) };
};

const hasDownloadableArchive = (doc: Document): boolean =>
  doc.hasArchive && doc.attachmentCount > 0;

const DocumentQualityBadges = ({ doc }: { doc: Document }) => {
  const missingAmount = !doc.detectedAmount;
  const missingInvoiceNumber = !doc.detectedInvoiceNumber;
  const missingAttachment = !hasDownloadableArchive(doc);

  if (!missingAmount && !missingInvoiceNumber && !missingAttachment) {
    // Kein Icon — die Badge-Farbe (grün/default) trägt das positive Signal.
    // Icon hier wäre Lärm in Tabellenzeilen mit ohnehin hoher Badge-Dichte.
    return (
      <Badge variant="default" size="small">
        <Trans>Vollständig</Trans>
      </Badge>
    );
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {missingAmount && (
        <Badge variant="warning" size="small">
          <AlertCircleIcon className="mr-1 h-3 w-3" aria-hidden />
          <Trans>Betrag fehlt</Trans>
        </Badge>
      )}
      {missingInvoiceNumber && (
        <Badge variant="warning" size="small">
          <AlertCircleIcon className="mr-1 h-3 w-3" aria-hidden />
          <Trans>Nr. fehlt</Trans>
        </Badge>
      )}
      {missingAttachment && (
        <Badge variant="neutral" size="small">
          <PaperclipIcon className="mr-1 h-3 w-3" aria-hidden />
          <Trans>Kein Anhang</Trans>
        </Badge>
      )}
    </div>
  );
};

const StatusIcon = ({ status }: { status: DiscoveryStatus }) => {
  if (status === 'pending-manual') return <ClockIcon className="h-4 w-4" aria-hidden />;
  if (status === 'accepted' || status === 'processed')
    return <CheckCircleIcon className="h-4 w-4" aria-hidden />;
  if (status === 'archived') return <ArchiveIcon className="h-4 w-4" aria-hidden />;
  return <InboxIcon className="h-4 w-4" aria-hidden />;
};

const statusLabel = (status: DiscoveryStatus): React.ReactNode => {
  switch (status) {
    case 'inbox':
      return <Trans>Neu</Trans>;
    case 'pending-manual':
      return <Trans>Manuell</Trans>;
    case 'accepted':
      return <Trans>Akzeptiert</Trans>;
    case 'archived':
      return <Trans>Archiv</Trans>;
    case 'ignored':
      return <Trans>Ignoriert</Trans>;
    case 'processed':
      return <Trans>Verarbeitet</Trans>;
  }
};

const DocumentRow = ({
  doc,
  locale,
  onAction,
  isPending,
  isSelected,
  onToggleSelect,
}: {
  doc: Document;
  locale: string;
  onAction: (id: string, action: TDiscoveryDocumentAction) => void;
  isPending: boolean;
  isSelected: boolean;
  onToggleSelect: (id: string) => void;
}) => (
  <Card
    // Override des Card-Defaults (bg-background = cremefarben):
    //   bg-white          — absolut weiss, hebt sich vom warmen Page-BG ab
    //   border-neutral-300 — sichtbarer mittel-grauer Rand statt blass-cremefarben
    //   shadow-sm         — leichtes Hochkant-Gefuehl, klar als „Karte" lesbar
    // bei Auswahl zusaetzlich primary-Ring; hover etwas anheben statt nur Tint.
    className={`flex flex-col gap-2 border-neutral-300 bg-white p-4 shadow-sm transition-all hover:border-neutral-400 hover:shadow-md ${
      isSelected ? 'ring-2 ring-primary ring-offset-1' : ''
    }`}
  >
    <div className="flex items-start gap-3">
      {/* Multi-Select-Checkbox: outside des Detail-Links, damit Klick aufs
          Häkchen den User NICHT zur Detail-Seite navigiert. */}
      <div className="pt-1">
        <Checkbox
          checked={isSelected}
          onCheckedChange={() => onToggleSelect(doc.id)}
          aria-label={`Beleg „${doc.title}" auswählen`}
        />
      </div>

      {/* Klickbarer Bereich → Detail-Seite. Akzeptieren-/Archivieren-Buttons
          liegen ausserhalb dieses Links, damit deren Klicks nicht zur Detail-
          Seite navigieren. */}
      <Link
        to={doc.id}
        className="flex min-w-0 flex-1 items-start gap-3 rounded-md ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        <FileTextIcon className="mt-1 h-5 w-5 flex-shrink-0 text-muted-foreground" aria-hidden />
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-base font-semibold text-foreground">{doc.title}</h3>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
            {doc.correspondent && <span>{doc.correspondent}</span>}
            {doc.detectedInvoiceNumber && (
              <span className="font-mono text-xs">{doc.detectedInvoiceNumber}</span>
            )}
            <span>{formatDate(doc.documentDate ?? doc.capturedAt, locale)}</span>
            {doc.sourceLabel && (
              <span className="inline-flex items-center gap-1 text-xs">
                <InboxIcon className="h-3 w-3" aria-hidden />
                {doc.sourceLabel}
              </span>
            )}
            {/* Anhang-Indikator: nur wenn herunterladbares Archiv vorhanden.
                Wenn Mail in der DB ist aber keine Files → kein Icon, nichts
                Klickbares — User weiss visuell „hier gibt's nichts zum Laden". */}
            {doc.hasArchive && doc.attachmentCount > 0 && (
              <span
                className="inline-flex items-center gap-1 text-xs font-medium text-foreground"
                title={`${doc.attachmentCount} Anhang${
                  doc.attachmentCount > 1 ? '"e' : ''
                } verfügbar`}
              >
                <PaperclipIcon className="h-3 w-3" aria-hidden />
                {doc.attachmentCount}
              </span>
            )}
          </div>
          <div className="mt-2">
            <DocumentQualityBadges doc={doc} />
          </div>
        </div>
      </Link>

      <div className="flex flex-shrink-0 items-center gap-2">
        <Badge variant="secondary">
          <StatusIcon status={doc.status} />
          <span className="ml-1.5">{statusLabel(doc.status)}</span>
        </Badge>
        {doc.status === 'inbox' && (
          <>
            <AcceptDiscoveryDocumentButton
              variant="outline"
              size="sm"
              disabled={isPending}
              onConfirm={() => onAction(doc.id, 'accept')}
            />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="h-8 w-8 p-0" disabled={isPending}>
                  <MoreHorizontalIcon className="h-4 w-4" aria-hidden />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => onAction(doc.id, 'mark-pending-manual')}>
                  <ClockIcon className="mr-2 h-4 w-4" aria-hidden />
                  <Trans>Als manuell zu ziehen markieren</Trans>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onAction(doc.id, 'archive')}>
                  <ArchiveIcon className="mr-2 h-4 w-4" aria-hidden />
                  <Trans>Archivieren</Trans>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onAction(doc.id, 'ignore')}>
                  <XCircleIcon className="mr-2 h-4 w-4" aria-hidden />
                  <Trans>Ignorieren</Trans>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        )}
        {doc.status === 'pending-manual' && (
          <Button
            variant="outline"
            size="sm"
            disabled={isPending}
            onClick={() => onAction(doc.id, 'archive')}
          >
            <ArchiveIcon className="mr-1.5 h-3.5 w-3.5" aria-hidden />
            <Trans>Archivieren</Trans>
          </Button>
        )}
      </div>
    </div>
    {doc.tags.length > 0 && (
      <div className="flex flex-wrap gap-1.5 pl-9">
        {doc.tags.map((tag) => (
          <Badge key={tag} variant="neutral" className="text-xs font-normal">
            {tag}
          </Badge>
        ))}
      </div>
    )}
  </Card>
);

/**
 * Sticky Action-Bar am oberen Listen-Rand, sichtbar sobald >=1 Beleg
 * ausgewaehlt ist. Zeigt ehrlich, wie viele der ausgewaehlten Belege
 * tatsaechlich Files haben — wenn 0, ist der ZIP-Button disabled.
 */
const BulkActionBar = ({
  selectedCount,
  downloadableCount,
  onClear,
  zipHref,
}: {
  selectedCount: number;
  downloadableCount: number;
  onClear: () => void;
  zipHref: string;
}) => {
  const noneDownloadable = downloadableCount === 0;
  return (
    <div className="sticky top-16 z-40 flex flex-wrap items-center justify-between gap-3 rounded-md border border-primary/50 bg-primary/10 px-4 py-2 shadow-sm backdrop-blur md:top-[88px]">
      <div className="flex flex-col gap-0.5">
        <p className="text-sm font-medium text-foreground">
          <Trans>{selectedCount} ausgewählt</Trans>
        </p>
        {downloadableCount < selectedCount && (
          <p className="text-xs text-muted-foreground">
            <Trans>
              {downloadableCount} davon mit Anhang — ZIP enthält MANIFEST.txt mit Liste der
              übersprungenen Mails.
            </Trans>
          </p>
        )}
      </div>
      <div className="flex items-center gap-2">
        {noneDownloadable ? (
          <Button size="sm" disabled title="Keiner der ausgewählten Belege hat Anhänge">
            <DownloadIcon className="mr-2 h-3.5 w-3.5" aria-hidden />
            <Trans>Kein Anhang</Trans>
          </Button>
        ) : (
          <Button asChild size="sm">
            <a href={zipHref} download>
              <DownloadIcon className="mr-2 h-3.5 w-3.5" aria-hidden />
              <Trans>Anhänge + Mail als ZIP</Trans>
            </a>
          </Button>
        )}
        <Button variant="ghost" size="sm" onClick={onClear}>
          <Trans>Auswahl aufheben</Trans>
        </Button>
      </div>
    </div>
  );
};

const LoadingList = () => (
  <div className="flex flex-col gap-3">
    {Array.from({ length: 4 }).map((_, i) => (
      <Skeleton key={i} className="h-24 w-full" />
    ))}
  </div>
);

const NoSourceEmptyState = () => (
  <Card className="flex flex-col items-center gap-5 p-12 text-center">
    <PlugIcon className="h-12 w-12 text-muted-foreground" aria-hidden />
    <div className="max-w-md">
      <h2 className="text-lg font-semibold">
        <Trans>Verbinden Sie Ihre erste Dokumentenquelle</Trans>
      </h2>
      <p className="mt-2 text-sm text-muted-foreground">
        <Trans>
          Belege erscheinen hier, sobald Sie eine Quelle verbunden und einen Sync-Lauf gestartet
          haben.
        </Trans>
      </p>
    </div>
    <Button asChild>
      <Link to="/settings/sources">
        <Trans>Quelle verbinden</Trans>
      </Link>
    </Button>
  </Card>
);

const SourcesStatusBar = ({
  sources,
  activeRuns,
  locale,
}: {
  sources: Source[];
  activeRuns: ReadonlyArray<{
    id: string;
    sourceLabel: string;
    mailsChecked: number;
    documentsAuto: number;
    documentsManual: number;
    status: 'PENDING' | 'RUNNING';
  }>;
  locale: string;
}) => {
  const latestSync =
    sources
      .map((s) => s.lastSyncAt)
      .filter((d): d is Date => d !== null)
      .sort((a, b) => b.getTime() - a.getTime())[0] ?? null;

  // Aktiver Run schlägt „letzter Sync"-Zeitstempel — Persona soll sehen,
  // dass das Tool gerade arbeitet, nicht nur historische Stände.
  if (activeRuns.length > 0) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-primary/40 bg-primary/5 px-3 py-2 text-sm">
        <div className="flex flex-wrap items-center gap-3">
          <Loader2Icon className="h-4 w-4 flex-shrink-0 animate-spin text-primary" aria-hidden />
          <div className="flex flex-col">
            {activeRuns.map((run) => {
              const found = run.documentsAuto + run.documentsManual;
              return (
                <span key={run.id} className="text-foreground">
                  <Trans>
                    {run.sourceLabel}: {run.mailsChecked} Mails geprüft, {found} Belege gefunden
                  </Trans>
                </span>
              );
            })}
          </div>
        </div>
        <Button asChild variant="ghost" size="sm" className="h-7 gap-1.5 px-2">
          <Link to="/settings/sources">
            <Settings2Icon className="h-3.5 w-3.5" aria-hidden />
            <Trans>Quellen verwalten</Trans>
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm text-muted-foreground">
      <div className="flex items-center gap-2">
        {latestSync ? (
          <>
            <CheckCircleIcon className="h-4 w-4 text-green-600" aria-hidden />
            <span>
              <Trans>Letzter Sync: {formatRelativeTime(latestSync, locale)}</Trans>
            </span>
          </>
        ) : (
          <>
            <AlertCircleIcon className="h-4 w-4 text-amber-500" aria-hidden />
            <span>
              <Trans>Noch kein Sync gestartet</Trans>
            </span>
          </>
        )}
      </div>
      <Button asChild variant="ghost" size="sm" className="h-7 gap-1.5 px-2">
        <Link to="/settings/sources">
          <Settings2Icon className="h-3.5 w-3.5" aria-hidden />
          <Trans>Quellen verwalten</Trans>
        </Link>
      </Button>
    </div>
  );
};

const MailboxSearchPanel = ({
  sources,
  sourceId,
  setSourceId,
  fromDate,
  setFromDate,
  toDate,
  setToDate,
  searchTerm,
  setSearchTerm,
  onStart,
  isPending,
  lastSuccessfulSyncRangeTo,
  defaultOpen,
  locale,
}: {
  sources: Source[];
  sourceId: string;
  setSourceId: (value: string) => void;
  fromDate: string;
  setFromDate: (value: string) => void;
  toDate: string;
  setToDate: (value: string) => void;
  searchTerm: string;
  setSearchTerm: (value: string) => void;
  onStart: () => void;
  isPending: boolean;
  lastSuccessfulSyncRangeTo: Date | null;
  defaultOpen: boolean;
  locale: string;
}) => {
  // „Seit letztem Lauf"-Hinweis: macht den inkrementellen Default explizit
  // sichtbar, damit der User nicht rätselt, warum „Von" auf einem konkreten
  // Datum vorbelegt ist.
  const incrementalHint = (() => {
    if (!lastSuccessfulSyncRangeTo) return null;
    const fmt = new Intl.DateTimeFormat(locale, {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
    return fmt.format(lastSuccessfulSyncRangeTo);
  })();

  return (
    <details
      className="mb-4 rounded-md border border-neutral-300 bg-white shadow-sm"
      open={defaultOpen}
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3">
        <span className="text-sm font-semibold">
          <Trans>Neuen Import starten</Trans>
        </span>
        <Button asChild variant="ghost" size="sm" className="h-7 px-2">
          <Link to="/settings/sources">
            <Settings2Icon className="mr-2 h-4 w-4" aria-hidden />
            <Trans>Quellen</Trans>
          </Link>
        </Button>
      </summary>

      {incrementalHint && (
        <p className="border-t bg-muted/30 px-4 py-2 text-xs text-muted-foreground">
          <Trans>
            Letzter erfolgreicher Lauf bis {incrementalHint}. „Von" ist auf dieses Datum vorbelegt —
            der Import zieht nur das Delta.
          </Trans>
        </p>
      )}

      <div className="grid gap-3 border-t p-4 md:grid-cols-[1.4fr_1fr_1fr_1.2fr_auto] md:items-end">
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">
            <Trans>Quelle</Trans>
          </span>
          {/* Shadcn-Select statt nativem <select> — vermeidet OS-spezifische
              Chrome-Drop-Down-Geometrie und matcht den Stil im IMAP-Dialog. */}
          <Select value={sourceId} onValueChange={setSourceId}>
            <SelectTrigger>
              <SelectValue placeholder="Quelle wählen" />
            </SelectTrigger>
            <SelectContent>
              {sources.map((source) => (
                <SelectItem key={source.id} value={source.id}>
                  {source.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>

        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">
            <Trans>Von</Trans>
          </span>
          <div className="relative">
            <CalendarIcon
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              className="pl-9"
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
            />
          </div>
        </label>

        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">
            <Trans>Bis</Trans>
          </span>
          <div className="relative">
            <CalendarIcon
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              className="pl-9"
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
            />
          </div>
        </label>

        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">
            <Trans>Suchbegriff</Trans>
          </span>
          <Input
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            placeholder="Rechnung, invoice, Beleg"
          />
        </label>

        <Button onClick={onStart} disabled={isPending || !sourceId || !fromDate || !toDate}>
          <PlayIcon className="mr-2 h-4 w-4" aria-hidden />
          <Trans>Durchsuchen</Trans>
        </Button>
      </div>
    </details>
  );
};

/**
 * Onboarding-Block für Erststart (mind. eine Quelle verbunden, aber noch kein
 * erfolgreicher SyncRun und keine Belege in der DB). Statt eines stillen
 * Datums-Defaults zwingt dieser Block zu einer bewussten Entscheidung über die
 * Reichweite des Erst-Imports — Persona „Mehrere Steuerjahre nachholen" wählt
 * 3J/5J, Persona „Aktuelle Buchhaltung" wählt 1M/3M.
 */
const OnboardingRangePicker = ({
  onStart,
  isPending,
  canStart,
}: {
  onStart: (from: string, to: string) => void;
  isPending: boolean;
  canStart: boolean;
}) => {
  const today = toDateInputValue(new Date());
  const fromYearsAgo = (years: number): string => {
    const d = new Date();
    d.setFullYear(d.getFullYear() - years);
    return toDateInputValue(d);
  };
  const fromMonthsAgo = (months: number): string => {
    const d = new Date();
    d.setMonth(d.getMonth() - months);
    return toDateInputValue(d);
  };

  const ranges: Array<{ label: string; from: string; hint: string }> = [
    { label: 'Letzter Monat', from: fromMonthsAgo(1), hint: 'schnell, ca. 1–2 Min' },
    { label: 'Letztes Quartal', from: fromMonthsAgo(3), hint: 'ca. 3–5 Min' },
    { label: '1 Jahr', from: fromYearsAgo(1), hint: 'ca. 10–15 Min' },
    { label: '2 Jahre', from: fromYearsAgo(2), hint: 'ca. 20–30 Min' },
    { label: '3 Jahre', from: fromYearsAgo(3), hint: 'ca. 30–45 Min' },
    { label: '5 Jahre', from: fromYearsAgo(5), hint: 'ca. 1–2 Std., Steuer-Nachhol' },
  ];

  return (
    <Card className="mb-6 border-neutral-300 bg-white p-6 shadow-sm">
      <h2 className="text-base font-semibold">
        <Trans>Wie weit möchten Sie zurück?</Trans>
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        <Trans>
          Der erste Import zieht alle Belege im gewählten Zeitraum. Folge-Läufe ziehen automatisch
          nur das Delta seit dem letzten erfolgreichen Lauf.
        </Trans>
      </p>
      <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-3">
        {ranges.map((r) => (
          <Button
            key={r.label}
            type="button"
            variant="outline"
            className="h-auto flex-col items-start gap-0.5 px-3 py-2.5 text-left"
            disabled={isPending || !canStart}
            onClick={() => onStart(r.from, today)}
          >
            <span className="text-sm font-semibold">{r.label}</span>
            <span className="text-xs font-normal text-muted-foreground">{r.hint}</span>
          </Button>
        ))}
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        <Trans>
          Eigenes Datum? Im Panel „Neuen Import starten" oben können Sie „Von" und „Bis" frei
          wählen.
        </Trans>
      </p>
    </Card>
  );
};

type CatchUpSummary = {
  total: number;
  accepted: number;
  needsReview: number;
  downloadable: number;
  missingAmount: number;
  missingInvoiceNumber: number;
  months: Array<{ key: string; count: number }>;
};

const TaxCatchUpPanel = ({
  summary,
  focusSummary,
  setFromDate,
  setToDate,
  setMailSearchTerm,
  setStatus,
  focusFilter,
  setFocusFilter,
  applyDateFilter,
  setApplyDateFilter,
  onMonthSelect,
  onStart,
  isPending,
  canStart,
  locale,
  taxPackageHref,
  dateRangeFrom,
  dateRangeTo,
}: {
  summary: CatchUpSummary;
  focusSummary: CatchUpSummary;
  setFromDate: (value: string) => void;
  setToDate: (value: string) => void;
  setMailSearchTerm: (value: string) => void;
  setStatus: (value: DiscoveryTab) => void;
  focusFilter: FocusFilter;
  setFocusFilter: (value: FocusFilter) => void;
  applyDateFilter: boolean;
  setApplyDateFilter: (value: boolean) => void;
  onMonthSelect: (key: string) => void;
  onStart: () => void;
  isPending: boolean;
  canStart: boolean;
  locale: string;
  taxPackageHref: string;
  // Reicht den aktiven Datumsfilter durch — Tax-Package-Confirm zeigt den
  // Range im Vorschau-Dialog. null wenn kein Filter aktiv.
  dateRangeFrom: Date | null;
  dateRangeTo: Date | null;
}) => {
  const { _ } = useLingui();
  const currentYear = new Date().getFullYear();
  const presets = [
    { label: String(currentYear), from: startOfYear(currentYear), to: endOfYear(currentYear) },
    {
      label: String(currentYear - 1),
      from: startOfYear(currentYear - 1),
      to: endOfYear(currentYear - 1),
    },
    {
      label: `${currentYear - 2}-${currentYear}`,
      from: startOfYear(currentYear - 2),
      to: endOfYear(currentYear),
    },
  ];

  const setPreset = (from: string, to: string) => {
    setFromDate(from);
    setToDate(to);
    setMailSearchTerm(TAX_SEARCH_TERM);
    setApplyDateFilter(true);
  };

  const visibleMonthLabel = (key: string) => {
    const [year, month] = key.split('-').map(Number);
    return new Intl.DateTimeFormat(locale, { month: 'short', year: 'numeric' }).format(
      new Date(year, month - 1, 1),
    );
  };

  const getFocusCount = (value: FocusFilter): number => {
    if (value === 'all') return focusSummary.total;
    if (value === 'needs-review') return focusSummary.needsReview;
    if (value === 'downloadable') return focusSummary.downloadable;
    if (value === 'missing-amount') return focusSummary.missingAmount;
    return focusSummary.missingInvoiceNumber;
  };
  const completionPercent =
    summary.total > 0 ? Math.round((summary.accepted / summary.total) * 100) : 0;

  const showReviewStep = summary.needsReview > 0;
  const showMissingDataStep =
    !showReviewStep && (summary.missingAmount > 0 || summary.missingInvoiceNumber > 0);
  // showExportStep wurde entfernt — der Steuerpaket-CTA ist jetzt permanent
  // unter dem „Nächster Schritt"-Block verankert (eigener Akzent-Container),
  // nicht mehr conditional verschachtelt mit den Review-Workflow-Buttons.

  const focusList = (value: FocusFilter) => {
    setStatus('all');
    setFocusFilter(value);
  };

  return (
    // Werkzeug-Panel visuell zurueckgestellt (bg-muted/30, kein Schatten):
    // die Dokument-Tabelle ist die primaere Oberflaeche, das Panel ist das
    // Werkzeug. Gleiches bg-white wie die Tabelle wuerde beide auf Augenhoehe
    // stellen — ungewollt fuer die Persona, die scannen will.
    <Card className="mb-6 border-neutral-200 bg-muted/30 p-4 shadow-none">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <BarChart3Icon className="h-4 w-4" aria-hidden />
            <Trans>Steuerunterlagen nachholen</Trans>
          </h2>
          <div className="mt-2 flex flex-wrap gap-2">
            <Badge variant="secondary" size="small">
              <Trans>{summary.total} Treffer</Trans>
            </Badge>
            <Badge variant="default" size="small">
              <Trans>{summary.accepted} geprüft</Trans>
            </Badge>
            <Badge variant={summary.needsReview > 0 ? 'warning' : 'neutral'} size="small">
              <Trans>{summary.needsReview} offen</Trans>
            </Badge>
            {(summary.missingAmount > 0 || summary.missingInvoiceNumber > 0) && (
              <Badge variant="warning" size="small">
                <Trans>{summary.missingAmount + summary.missingInvoiceNumber} Datenlücken</Trans>
              </Badge>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {presets.map((preset) => (
            <Button
              key={preset.label}
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setPreset(preset.from, preset.to)}
            >
              {preset.label}
            </Button>
          ))}
        </div>
      </div>

      <div className="mt-4 rounded-md border bg-muted/20 p-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className="text-sm font-medium">
                <Trans>Nächster Schritt</Trans>
              </p>
              <Badge variant="secondary" size="small">
                {completionPercent}%
              </Badge>
            </div>
            <div className="mt-2 h-2 max-w-md overflow-hidden rounded-full bg-muted">
              <div className="h-full bg-primary" style={{ width: `${completionPercent}%` }} />
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {showReviewStep && (
              <Button size="sm" onClick={() => focusList('needs-review')}>
                <CheckCircleIcon className="mr-2 h-4 w-4" aria-hidden />
                <Trans>Offene prüfen</Trans>
              </Button>
            )}
            {showMissingDataStep && summary.missingAmount > 0 && (
              <Button size="sm" variant="outline" onClick={() => focusList('missing-amount')}>
                <Trans>Ohne Betrag</Trans>
              </Button>
            )}
            {showMissingDataStep && summary.missingInvoiceNumber > 0 && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => focusList('missing-invoice-number')}
              >
                <Trans>Ohne Nr.</Trans>
              </Button>
            )}
            {!showReviewStep && !showMissingDataStep && summary.downloadable === 0 && (
              <Button size="sm" onClick={onStart} disabled={isPending || !canStart}>
                <PlayIcon className="mr-2 h-4 w-4" aria-hidden />
                <Trans>Suche starten</Trans>
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Steuerpaket-CTA permanent verankert — sichtbar sobald ueberhaupt
          Belege mit Anhang da sind, unabhaengig davon ob noch Luecken offen
          sind. Persona kann auch eine Teilmenge exportieren, ohne dass das
          Tool sie zur Vollstaendigkeit zwingt. */}
      {summary.downloadable > 0 && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-md border border-primary/30 bg-primary/10 px-4 py-3">
          <p className="text-sm font-medium">
            <Trans>{summary.downloadable} Belege mit Anhang bereit für Steuerpaket</Trans>
          </p>
          <TaxPackageConfirmButton
            href={taxPackageHref}
            totalCount={summary.total}
            downloadableCount={summary.downloadable}
            rangeFrom={dateRangeFrom}
            rangeTo={dateRangeTo}
            locale={locale}
          />
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-2 border-t pt-4">
        {FOCUS_FILTERS.map((filter) => (
          <Button
            key={filter.value}
            type="button"
            size="sm"
            variant={focusFilter === filter.value ? 'default' : 'outline'}
            onClick={() => setFocusFilter(filter.value)}
          >
            {_(filter.label)}
            <span className="ml-2 rounded-sm bg-background/70 px-1.5 py-0.5 text-xs text-foreground">
              {getFocusCount(filter.value)}
            </span>
          </Button>
        ))}
      </div>

      {/* Inneres `<details>` „Suche und Zeitraum" wurde entfernt — die
          Funktion war doppelt mit dem `MailboxSearchPanel` oben (gleicher
          Sync-Trigger) und mit der „In importierten Belegen suchen"-Eingabe
          (Quick-Terms-Chips). Der ehemals dort lebende `applyDateFilter`-
          Toggle wandert eine Zeile drüber in die Focus-Filter-Reihe. */}
      <label className="mt-3 inline-flex items-center gap-2 text-sm">
        <Checkbox
          checked={applyDateFilter}
          onCheckedChange={(checked) => setApplyDateFilter(checked === true)}
          aria-label="Zeitraum auf Trefferliste anwenden"
        />
        <span className="text-muted-foreground">
          <Trans>Trefferliste auf den oben gewählten Zeitraum eingrenzen</Trans>
        </span>
      </label>

      {summary.months.length > 0 && (
        <details className="mt-3 rounded-md border bg-muted/10">
          <summary className="cursor-pointer px-3 py-2 text-sm font-medium">
            <Trans>Monate</Trans>
          </summary>
          {/* Keine slice-Begrenzung: bei mehrjährigem Steuer-Nachhol-Use-Case
              müssen 24+ Monate sichtbar sein. flex-wrap kümmert sich ums Layout. */}
          <div className="flex flex-wrap gap-2 border-t p-3">
            {summary.months.map((bucket) => (
              <Button
                key={bucket.key}
                type="button"
                size="sm"
                variant="outline"
                onClick={() => onMonthSelect(bucket.key)}
              >
                {visibleMonthLabel(bucket.key)} · {bucket.count}
              </Button>
            ))}
          </div>
        </details>
      )}
    </Card>
  );
};

const NoResultsCard = ({
  sources,
  activeRuns,
  locale,
}: {
  sources: Source[];
  activeRuns: ReadonlyArray<{
    id: string;
    sourceLabel: string;
    mailsChecked: number;
    documentsAuto: number;
    documentsManual: number;
    status: 'PENDING' | 'RUNNING';
  }>;
  locale: string;
}) => (
  <div className="flex flex-col gap-4">
    <SourcesStatusBar sources={sources} activeRuns={activeRuns} locale={locale} />
    <Card className="flex flex-col items-center gap-3 p-12 text-center">
      <InboxIcon className="h-12 w-12 text-muted-foreground" aria-hidden />
      <div>
        <h2 className="text-lg font-semibold">
          <Trans>Keine Belege im aktuellen Bereich</Trans>
        </h2>
        <p className="mt-1 max-w-md text-sm text-muted-foreground">
          <Trans>
            Starten Sie in den Quellen-Einstellungen einen Sync-Lauf für einen bestimmten Zeitraum,
            um Belege aus Ihrem Postfach einzulesen.
          </Trans>
        </p>
      </div>
      <Button asChild variant="outline" size="sm">
        <Link to="/settings/sources">
          <Settings2Icon className="mr-2 h-4 w-4" aria-hidden />
          <Trans>Sync-Lauf starten</Trans>
        </Link>
      </Button>
    </Card>
  </div>
);

// Tabellen-Ansicht für „Akzeptiert" und „Archiv". Im Gegensatz zur Card-Liste
// (die für Eingang+Manuell wegen der Aktions-Buttons sinnvoller ist) brauchen
// wir hier Lese-Übersicht über viele Belege + Export. CSV-Export läuft über
// einen Server-Endpoint (find-documents.csv-export), damit alle gefilterten
// Belege exportiert werden — nicht nur die aktuelle Page-Slice.
const DocumentTable = ({
  documents,
  locale,
  onAction,
  isPending,
  showAcceptedColumn,
  showSourceColumn,
  isSelected,
  onToggleSelect,
  onToggleSelectAll,
  allSelected,
  totalCount,
  csvExportHref,
}: {
  documents: Document[];
  locale: string;
  onAction: (id: string, action: TDiscoveryDocumentAction) => void;
  isPending: boolean;
  showAcceptedColumn: boolean;
  // Quelle-Spalte nur einblenden, wenn der User mehrere Quellen hat —
  // bei einer einzigen IMAP-Box waere die Spalte konstant befuellt und
  // damit nutzlos.
  showSourceColumn: boolean;
  isSelected: (id: string) => boolean;
  onToggleSelect: (id: string) => void;
  onToggleSelectAll: () => void;
  allSelected: boolean;
  // Gesamt-Anzahl gefilterter Belege (vom Server). Wenn > documents.length
  // kommt der CSV-Export NICHT clientseitig aus dem aktuellen Page-Slice
  // (das war die alte Falle), sondern aus dem Server-Endpoint, der alle
  // gefilterten Belege liefert.
  totalCount: number;
  csvExportHref: string;
}) => {
  const intlDate = new Intl.DateTimeFormat(locale, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });

  return (
    <div className="flex flex-col gap-3">
      <div className="flex justify-end">
        <Button asChild variant="outline" size="sm" disabled={documents.length === 0}>
          <a href={csvExportHref} download>
            <DownloadIcon className="mr-2 h-4 w-4" aria-hidden />
            <Trans>CSV exportieren ({totalCount})</Trans>
          </a>
        </Button>
      </div>
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="w-10 px-3 py-2">
                <Checkbox
                  checked={documents.length > 0 && allSelected}
                  onCheckedChange={onToggleSelectAll}
                  aria-label="Alle auswählen"
                />
              </th>
              <th className="px-3 py-2 font-medium">
                <Trans>Datum</Trans>
              </th>
              <th className="px-3 py-2 font-medium">
                <Trans>Korrespondent</Trans>
              </th>
              <th className="px-3 py-2 font-medium">
                <Trans>Betreff</Trans>
              </th>
              <th className="px-3 py-2 font-medium">
                <Trans>Betrag</Trans>
              </th>
              <th className="px-3 py-2 font-medium">
                <Trans>Rechnungs-Nr.</Trans>
              </th>
              <th className="px-3 py-2 font-medium">
                <Trans>Prüfung</Trans>
              </th>
              <th className="px-3 py-2 text-center font-medium" title="Anhang">
                <PaperclipIcon className="mx-auto h-4 w-4" aria-hidden />
              </th>
              <th className="px-3 py-2 font-medium">
                <Trans>Status</Trans>
              </th>
              {showSourceColumn && (
                <th className="px-3 py-2 font-medium">
                  <Trans>Quelle</Trans>
                </th>
              )}
              {showAcceptedColumn && (
                <th className="px-3 py-2 font-medium">
                  <Trans>Akzeptiert</Trans>
                </th>
              )}
              <th className="px-3 py-2 text-right font-medium">
                <Trans>Aktion</Trans>
              </th>
            </tr>
          </thead>
          <tbody>
            {documents.map((doc) => (
              <tr
                key={doc.id}
                className={`border-t hover:bg-muted/30 ${isSelected(doc.id) ? 'bg-primary/5' : ''}`}
              >
                <td className="px-3 py-2 align-middle">
                  <Checkbox
                    checked={isSelected(doc.id)}
                    onCheckedChange={() => onToggleSelect(doc.id)}
                    aria-label={`Beleg „${doc.title}" auswählen`}
                  />
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                  {intlDate.format(doc.documentDate ?? doc.capturedAt)}
                </td>
                <td className="px-3 py-2">{doc.correspondent ?? '–'}</td>
                <td className="min-w-0 max-w-[240px] truncate px-3 py-2">
                  <Link to={doc.id} className="hover:underline">
                    {doc.title}
                  </Link>
                </td>
                <td className="whitespace-nowrap px-3 py-2 font-medium">
                  {doc.detectedAmount ?? '–'}
                </td>
                <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">
                  {doc.detectedInvoiceNumber ?? '–'}
                </td>
                <td className="px-3 py-2">
                  <div className="flex max-w-[160px] flex-wrap gap-1">
                    <DocumentQualityBadges doc={doc} />
                  </div>
                </td>
                <td className="px-3 py-2 text-center">
                  {hasDownloadableArchive(doc) ? (
                    <span
                      className="inline-flex items-center gap-1 text-xs font-medium text-foreground"
                      title={`${doc.attachmentCount} Anhang${
                        doc.attachmentCount > 1 ? '"e' : ''
                      } verfügbar`}
                    >
                      <PaperclipIcon className="h-3 w-3" aria-hidden />
                      {doc.attachmentCount}
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground">–</span>
                  )}
                </td>
                <td className="whitespace-nowrap px-3 py-2">
                  <Badge variant="secondary" className="text-xs font-normal">
                    <StatusIcon status={doc.status} />
                    <span className="ml-1.5">{statusLabel(doc.status)}</span>
                  </Badge>
                </td>
                {showSourceColumn && (
                  <td className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">
                    {doc.sourceLabel ?? '–'}
                  </td>
                )}
                {showAcceptedColumn && (
                  <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                    {doc.acceptedAt ? (
                      <>
                        {intlDate.format(doc.acceptedAt)}
                        {doc.acceptedByName && (
                          <span className="ml-1 text-xs">· {doc.acceptedByName}</span>
                        )}
                      </>
                    ) : (
                      '–'
                    )}
                  </td>
                )}
                <td className="whitespace-nowrap px-3 py-2 text-right">
                  {doc.status === 'accepted' && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2"
                      disabled={isPending}
                      onClick={() => onAction(doc.id, 'archive')}
                    >
                      <ArchiveIcon className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                      <Trans>Archivieren</Trans>
                    </Button>
                  )}
                  <Button asChild size="sm" variant="ghost" className="h-7 px-2">
                    <Link to={doc.id}>
                      <Trans>Details</Trans>
                    </Link>
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default function FindDocumentsPage() {
  const { _, i18n } = useLingui();
  const { toast } = useToast();
  const params = useParams();
  const teamUrl = params.teamUrl ?? '';
  // Default ist die Übersicht: alle Belege auf einen Blick, sortiert nach Datum.
  // Workflow-Tabs (Eingang, Manuell, …) sind weiterhin erreichbar.
  const [status, setStatus] = useState<DiscoveryTab>('all');
  const [query, setQuery] = useState('');
  const today = toDateInputValue(new Date());
  const [sourceId, setSourceId] = useState('');
  // Inkrementeller Sync ist Standard: `fromDate` wird in einem useEffect aus
  // `lastSuccessfulSyncRangeTo` der gewählten Quelle gefüllt. Bei einer Quelle
  // ohne erfolgreichen Lauf bleibt das Feld leer und der Onboarding-Block
  // fragt explizit „Wie weit zurück?" — kein stummer Default, der jahrelange
  // Re-Scans triggern oder den ersten Sync auf 30 Tage begrenzen würde.
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState(today);
  const [mailSearchTerm, setMailSearchTerm] = useState('Rechnung');
  const [applyDateFilter, setApplyDateFilter] = useState(false);
  const [focusFilter, setFocusFilterState] = useState<FocusFilter>('all');
  // Multi-Select-State pro Tab — beim Tab-Wechsel zurueckgesetzt.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const utils = trpc.useUtils();

  const dateFilterRange = useMemo(() => {
    if (!applyDateFilter) return null;
    const from = parseDateInput(fromDate);
    const to = toDate ? addDays(toDate, 1) : null;
    if (!from || !to || from >= to) return null;
    return { from, to };
  }, [applyDateFilter, fromDate, toDate]);

  const { data, isLoading } = trpc.discovery.findDocuments.useQuery({
    status,
    query: query.trim() || undefined,
    qualityFilter: focusFilter === 'all' ? undefined : focusFilter,
    documentDateFrom: dateFilterRange?.from,
    documentDateTo: dateFilterRange?.to,
  });

  // Globaler Overview für die Wow-Card. Einmaliger Aggregat-Read, wird beim
  // Abschluss eines Sync-Laufs invalidiert, damit die Card frische Zahlen
  // zeigt. Skaliert linear mit der Anzahl Belege — siehe Router-Kommentar.
  const { data: overview } = trpc.discovery.getOverview.useQuery();

  // Smart-Default-Filter: wenn die Persona Belege im Status „needs-review"
  // hat (offen, noch nicht akzeptiert/ignoriert), beim ersten Page-Load
  // automatisch auf diese Sub-Liste fokussieren — sie ist schließlich der
  // Punkt, warum die Persona die Seite überhaupt aufmacht. Sobald der User
  // den Filter manuell ändert, greift der Default nicht mehr (Ref-Lock).
  const smartDefaultAppliedRef = useRef(false);
  useEffect(() => {
    if (smartDefaultAppliedRef.current) return;
    if (!overview) return;
    smartDefaultAppliedRef.current = true;
    if (overview.needsReview > 0) {
      setFocusFilterState('needs-review');
    }
  }, [overview]);

  // Aktive Sync-Runs pollen — schmaler Endpoint, kein Discovery-Reader.
  // Solange aktive Runs zurückkommen, alle 3 s neu fragen; sobald Liste leer,
  // Discovery + Sources einmalig invalidieren, damit die fertigen Belege in
  // der Liste auftauchen und der „letzter Sync"-Zeitstempel kippt.
  const { data: activeRuns } = trpc.discovery.getActiveSyncRuns.useQuery(undefined, {
    refetchInterval: (query) => ((query.state.data?.length ?? 0) > 0 ? 3000 : false),
  });
  const activeRunsCount = activeRuns?.length ?? 0;
  const lastActiveRunsCountRef = useRef(activeRunsCount);
  useEffect(() => {
    if (lastActiveRunsCountRef.current > 0 && activeRunsCount === 0) {
      void utils.discovery.findDocuments.invalidate();
      void utils.discovery.getOverview.invalidate();
    }
    lastActiveRunsCountRef.current = activeRunsCount;
  }, [activeRunsCount, utils.discovery.findDocuments, utils.discovery.getOverview]);

  useEffect(() => {
    if (!sourceId && data?.sources[0]?.id) {
      setSourceId(data.sources[0].id);
    }
  }, [data?.sources, sourceId]);

  // Inkrementelles Default für Sync-Lauf: sobald `sourceId` feststeht und die
  // Quelle einen erfolgreichen Lauf hat, schlagen wir „seit dem letzten Lauf
  // bis heute" vor. User kann das jederzeit überschreiben (Presets, Eigenes
  // Datum). Wenn die Quelle noch nie erfolgreich gelaufen ist, bleibt
  // `fromDate` leer — der Onboarding-Block übernimmt dann die Erstauswahl.
  const selectedSource = data?.sources.find((s) => s.id === sourceId) ?? null;
  const lastSuccessfulRangeTo = selectedSource?.lastSuccessfulSyncRangeTo ?? null;
  useEffect(() => {
    if (!lastSuccessfulRangeTo) return;
    setFromDate((current) => current || toDateInputValue(lastSuccessfulRangeTo));
  }, [lastSuccessfulRangeTo]);

  const updateStatusMutation = trpc.discovery.updateStatus.useMutation({
    onSuccess: () => {
      void utils.discovery.findDocuments.invalidate();
    },
    onError: (err) => {
      toast({
        title: _(msg`Aktion fehlgeschlagen`),
        description: err.message,
        variant: 'destructive',
      });
    },
  });

  const startSyncRunMutation = trpc.sources.startSyncRun.useMutation({
    onSuccess: (run) => {
      toast({
        title: _(msg`Import gestartet`),
        description: _(
          msg`Der Lauf läuft im Hintergrund — diese Seite aktualisiert sich automatisch.`,
        ),
      });
      void utils.discovery.findDocuments.invalidate();
      void utils.discovery.getActiveSyncRuns.invalidate();
      void utils.sources.listSyncRuns.invalidate({ sourceId: run.sourceId, limit: 10 });
    },
    onError: (err) => {
      toast({
        title: _(msg`Durchsuchung konnte nicht gestartet werden`),
        description: err.message,
        variant: 'destructive',
      });
    },
  });

  const handleAction = (id: string, action: TDiscoveryDocumentAction) => {
    updateStatusMutation.mutate({ id, action });
  };

  const handleStartMailboxSearch = () => {
    const from = new Date(`${fromDate}T00:00:00`);
    const to = addDays(toDate, 1);

    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from >= to) {
      toast({
        title: _(msg`Zeitraum prüfen`),
        description: _(msg`Das Von-Datum muss vor dem Bis-Datum liegen.`),
        variant: 'destructive',
      });
      return;
    }

    startSyncRunMutation.mutate({
      sourceId,
      from,
      to,
      searchTerm: mailSearchTerm.trim() || undefined,
    });
  };

  const handleToggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleClearSelection = () => setSelectedIds(new Set());

  const handleStatusChange = (next: DiscoveryTab) => {
    setStatus(next);
    setSelectedIds(new Set());
  };

  const handleFocusFilterChange = (next: FocusFilter) => {
    setFocusFilterState(next);
    setSelectedIds(new Set());
  };

  const handleMonthSelect = (key: string) => {
    const range = monthKeyToRange(key);
    if (!range) return;
    setFromDate(range.from);
    setToDate(range.to);
    setApplyDateFilter(true);
    setSelectedIds(new Set());
  };

  const hasAnySource = data?.hasAnySource ?? false;
  const sources = data?.sources ?? [];
  const visibleDocuments = data?.documents ?? [];
  const catchUpSummary = useMemo<CatchUpSummary>(() => {
    if (data?.summary) {
      return data.summary;
    }

    const months = new Map<string, number>();

    visibleDocuments.forEach((doc) => {
      const key = getYearMonthKey(getDocumentWorkDate(doc));
      months.set(key, (months.get(key) ?? 0) + 1);
    });

    return {
      total: data?.total ?? visibleDocuments.length,
      accepted: visibleDocuments.filter(
        (doc) => doc.status === 'accepted' || doc.status === 'archived',
      ).length,
      needsReview: visibleDocuments.filter(
        (doc) => doc.status === 'inbox' || doc.status === 'pending-manual',
      ).length,
      downloadable: visibleDocuments.filter(hasDownloadableArchive).length,
      missingAmount: visibleDocuments.filter((doc) => !doc.detectedAmount).length,
      missingInvoiceNumber: visibleDocuments.filter((doc) => !doc.detectedInvoiceNumber).length,
      months: Array.from(months.entries())
        .sort(([a], [b]) => b.localeCompare(a))
        .map(([key, count]) => ({ key, count })),
    };
  }, [data?.summary, data?.total, visibleDocuments]);
  const focusSummary = useMemo<CatchUpSummary>(() => {
    if (data?.focusSummary) {
      return data.focusSummary;
    }
    return catchUpSummary;
  }, [catchUpSummary, data?.focusSummary]);

  const isSelected = (id: string) => selectedIds.has(id);
  const allVisibleSelected =
    visibleDocuments.length > 0 && visibleDocuments.every((d) => selectedIds.has(d.id));
  const handleToggleSelectAll = () => {
    setSelectedIds((prev) => {
      if (visibleDocuments.every((d) => prev.has(d.id))) {
        // Alle abwählen die zur aktuellen Sicht gehören.
        const next = new Set(prev);
        visibleDocuments.forEach((d) => next.delete(d.id));
        return next;
      }
      const next = new Set(prev);
      visibleDocuments.forEach((d) => next.add(d.id));
      return next;
    });
  };

  // Absoluter Pfad — relative URLs resolven hier ungewollt nach
  // /t/{team}/zip-attachments (statt /t/{team}/find-documents/zip-attachments),
  // weil die List-URL keinen Trailing-Slash hat.
  const zipHref = `/t/${teamUrl}/find-documents/zip-attachments?ids=${Array.from(selectedIds).join(',')}`;
  // Beide Server-Exports (Steuerpaket-ZIP, CSV) nutzen denselben Filter-
  // Set wie die Liste — gleicher Query-String, anderer Endpoint.
  const buildExportQs = () => {
    const params = new URLSearchParams();
    params.set('status', status);
    if (query.trim()) {
      params.set('query', query.trim());
    }
    if (focusFilter !== 'all') {
      params.set('qualityFilter', focusFilter);
    }
    if (dateFilterRange) {
      params.set('documentDateFrom', dateFilterRange.from.toISOString());
      params.set('documentDateTo', dateFilterRange.to.toISOString());
    }
    return params.toString();
  };
  const exportQs = buildExportQs();
  const taxPackageHref = `/t/${teamUrl}/find-documents/tax-package${
    exportQs ? `?${exportQs}` : ''
  }`;
  const csvExportHref = `/t/${teamUrl}/find-documents/csv-export${exportQs ? `?${exportQs}` : ''}`;

  return (
    <div className="mx-auto w-full max-w-screen-xl px-4 py-8 md:px-8">
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight md:text-3xl">
          <Trans>Dokumente finden</Trans>
        </h1>
        <p className="mt-1 text-base text-muted-foreground">
          <Trans>
            Belege aus allen verbundenen Quellen an einem Ort — durchsuchbar und nach Status
            gefiltert.
          </Trans>
        </p>
      </header>

      {overview && overview.total > 0 && (
        <SyncOverviewCard
          overview={overview}
          reviewHref={`/t/${teamUrl}/find-documents/review`}
          locale={i18n.locale}
        />
      )}

      {hasAnySource && (
        <>
          <MailboxSearchPanel
            sources={sources}
            sourceId={sourceId}
            setSourceId={setSourceId}
            fromDate={fromDate}
            setFromDate={setFromDate}
            toDate={toDate}
            setToDate={setToDate}
            searchTerm={mailSearchTerm}
            setSearchTerm={setMailSearchTerm}
            onStart={handleStartMailboxSearch}
            isPending={startSyncRunMutation.isPending}
            lastSuccessfulSyncRangeTo={lastSuccessfulRangeTo}
            // Beim Erststart der Quelle das Panel offen rendern: Erstnutzer
            // soll sofort sehen, wo er den Sync konfiguriert. Im laufenden
            // Betrieb bleibt es eingeklappt, weil das Tax-Panel die Übersicht
            // gibt.
            defaultOpen={!lastSuccessfulRangeTo}
            locale={i18n.locale}
          />
          {/* Erststart der Quelle: Onboarding-Range-Picker statt
              TaxCatchUpPanel. Sobald ein erfolgreicher Lauf existiert, kippt
              die Seite automatisch in den „laufender Betrieb"-Modus und
              das TaxCatchUpPanel übernimmt. */}
          {!lastSuccessfulRangeTo ? (
            <OnboardingRangePicker
              isPending={startSyncRunMutation.isPending}
              canStart={Boolean(sourceId)}
              onStart={(from, to) => {
                setFromDate(from);
                setToDate(to);
                setMailSearchTerm(TAX_SEARCH_TERM);
                // Sync direkt anstoßen — Persona soll nicht zweimal klicken.
                if (!sourceId) return;
                const fromD = new Date(`${from}T00:00:00`);
                const toD = addDays(to, 1);
                startSyncRunMutation.mutate({
                  sourceId,
                  from: fromD,
                  to: toD,
                  searchTerm: TAX_SEARCH_TERM,
                });
              }}
            />
          ) : (
            <TaxCatchUpPanel
              summary={catchUpSummary}
              focusSummary={focusSummary}
              setFromDate={setFromDate}
              setToDate={setToDate}
              setMailSearchTerm={setMailSearchTerm}
              setStatus={handleStatusChange}
              focusFilter={focusFilter}
              setFocusFilter={handleFocusFilterChange}
              applyDateFilter={applyDateFilter}
              setApplyDateFilter={setApplyDateFilter}
              onMonthSelect={handleMonthSelect}
              onStart={handleStartMailboxSearch}
              isPending={startSyncRunMutation.isPending}
              canStart={Boolean(sourceId && fromDate && toDate)}
              locale={i18n.locale}
              taxPackageHref={taxPackageHref}
              dateRangeFrom={dateFilterRange?.from ?? null}
              dateRangeTo={dateFilterRange?.to ?? null}
            />
          )}
        </>
      )}

      <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        {/* Tab-Bar in einen horizontal-scrollenden Wrapper packen, damit auf
            schmalen Viewports (<400px) die letzten Tabs nicht abgeschnitten
            werden. min-w-max verhindert, dass die TabsList gestaucht wird.
            mask-image gibt einen weichen Fade-out am rechten Rand, der
            signalisiert „rechts geht's weiter". */}
        <div className="-mx-4 overflow-x-auto px-4 [mask-image:linear-gradient(to_right,black_92%,transparent)] md:mx-0 md:px-0 md:[mask-image:none]">
          <Tabs
            value={status}
            onValueChange={(v) => {
              const tab = STATUS_TABS.find((t) => t.value === v);
              if (tab) handleStatusChange(tab.value);
            }}
          >
            <TabsList className="min-w-max">
              {STATUS_TABS.map((tab) => (
                <TabsTrigger key={tab.value} value={tab.value}>
                  {_(tab.label)}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>

        <div className="relative max-w-sm flex-1 md:max-w-xs">
          <SearchIcon
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            className="pl-9"
            placeholder={_(msg`In importierten Belegen suchen`)}
            aria-label={_(msg`Volltextsuche in importierten Belegen`)}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>

      <section aria-live="polite">
        {isLoading && <LoadingList />}

        {!isLoading && data && !hasAnySource && <NoSourceEmptyState />}

        {!isLoading && data && hasAnySource && data.documents.length === 0 && (
          <NoResultsCard sources={sources} activeRuns={activeRuns ?? []} locale={i18n.locale} />
        )}

        {!isLoading && data && data.documents.length > 0 && (
          <div className="flex flex-col gap-4">
            <SourcesStatusBar
              sources={sources}
              activeRuns={activeRuns ?? []}
              locale={i18n.locale}
            />
            {selectedIds.size > 0 && (
              <BulkActionBar
                selectedCount={selectedIds.size}
                downloadableCount={
                  visibleDocuments.filter(
                    (d) => selectedIds.has(d.id) && d.hasArchive && d.attachmentCount > 0,
                  ).length
                }
                onClear={handleClearSelection}
                zipHref={zipHref}
              />
            )}
            {/* "Alle" + akzeptiert + archiv ergibt typisch viele Belege —
                Tabellenansicht ist da kompakter und scannbar. Eingang+Manuell
                bleiben Card-Ansicht, weil dort die Action-Buttons (Akzeptieren
                / Archivieren etc.) im Zentrum stehen. Auf Mobile (<md) immer
                Cards: 9-Spalten-Tabelle mit horizontal-scroll ist auf 375px
                nicht bedienbar. */}
            {status === 'all' || status === 'accepted' || status === 'archived' ? (
              <>
                <div className="hidden md:block">
                  <DocumentTable
                    documents={data.documents}
                    locale={i18n.locale}
                    onAction={handleAction}
                    isPending={updateStatusMutation.isPending}
                    showAcceptedColumn={status !== 'all'}
                    showSourceColumn={sources.length > 1}
                    isSelected={isSelected}
                    onToggleSelect={handleToggleSelect}
                    onToggleSelectAll={handleToggleSelectAll}
                    allSelected={allVisibleSelected}
                    totalCount={data.total}
                    csvExportHref={csvExportHref}
                  />
                </div>
                <div className="flex flex-col gap-3 md:hidden">
                  {data.documents.map((doc) => (
                    <DocumentRow
                      key={doc.id}
                      doc={doc}
                      locale={i18n.locale}
                      onAction={handleAction}
                      isPending={updateStatusMutation.isPending}
                      isSelected={isSelected(doc.id)}
                      onToggleSelect={handleToggleSelect}
                    />
                  ))}
                </div>
              </>
            ) : (
              <div className="flex flex-col gap-3">
                {data.documents.map((doc) => (
                  <DocumentRow
                    key={doc.id}
                    doc={doc}
                    locale={i18n.locale}
                    onAction={handleAction}
                    isPending={updateStatusMutation.isPending}
                    isSelected={isSelected(doc.id)}
                    onToggleSelect={handleToggleSelect}
                  />
                ))}
              </div>
            )}
            {data.total > data.documents.length && (
              <p className="mt-2 text-center text-sm text-muted-foreground">
                <Trans>
                  {data.documents.length} von {data.total} angezeigt
                </Trans>
              </p>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
