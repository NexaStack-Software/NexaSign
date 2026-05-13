// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 NexaStack, NexaSign contributors
//
// /archiv — Wireframe-konforme Archiv-Sicht.
// Zwei Sub-Tabs:
//   1) "Zur Ablage bereit": Belege mit acceptedAt aber ohne archivedAt.
//      Editierbar, kein WORM. Aktion pro Zeile: "Rechtssicher archivieren".
//   2) "Rechtssicher archiviert": Belege mit archivedAt. Read-only, WORM aktiv,
//      GoBD-10-Jahres-Frist läuft. Aktionen: lesen, herunterladen, exportieren.
//
// Bulk-Aktionen oben:
//   - "Alle N rechtssicher archivieren" (auf Zur-Ablage-bereit-Liste)
//   - "Als ZIP herunterladen" → /find-documents/zip-attachments
//   - "Steuerpaket exportieren (DATEV-CSV)" → /find-documents/tax-package
import { type ReactNode, useMemo, useState } from 'react';

import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react';
import { Trans } from '@lingui/react/macro';
import {
  AlertCircleIcon,
  AlertTriangleIcon,
  ArchiveIcon,
  BookOpenIcon,
  CheckCircleIcon,
  DownloadIcon,
  FileTextIcon,
  Loader2Icon,
  LockIcon,
  MoreHorizontalIcon,
  PaperclipIcon,
  ReceiptTextIcon,
  SearchIcon,
  SendIcon,
  Trash2Icon,
} from 'lucide-react';
import { Link, useParams } from 'react-router';

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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@nexasign/ui/primitives/dropdown-menu';
import { Input } from '@nexasign/ui/primitives/input';
import { Tabs, TabsList, TabsTrigger } from '@nexasign/ui/primitives/tabs';
import { useToast } from '@nexasign/ui/primitives/use-toast';

import { AcceptDiscoveryDocumentButton } from '~/components/dialogs/accept-discovery-document-button';
import { Illustration } from '~/components/general/illustration';
import { appMetaTags } from '~/utils/meta';

export function meta() {
  return appMetaTags(msg`Archiv`);
}

type Document = TFindDiscoveryDocumentsResponse['documents'][number];
type ArchivTab = 'pending' | 'sealed';

const formatDate = (date: Date | null, locale: string): string => {
  if (!date) return '–';
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(date);
};

export default function ArchivPage() {
  const { _, i18n } = useLingui();
  const { toast } = useToast();
  const params = useParams();
  const teamUrl = params.teamUrl ?? '';
  const utils = trpc.useUtils();

  const [tab, setTab] = useState<ArchivTab>('pending');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const [bulkArchiveDialogOpen, setBulkArchiveDialogOpen] = useState(false);

  const pendingQuery = trpc.discovery.findDocuments.useInfiniteQuery(
    {
      status: 'accepted',
      query: query.trim() || undefined,
    },
    {
      getNextPageParam: (lastPage) => lastPage.nextCursor,
    },
  );
  const sealedQuery = trpc.discovery.findDocuments.useInfiniteQuery(
    {
      status: 'archived',
      query: query.trim() || undefined,
    },
    {
      getNextPageParam: (lastPage) => lastPage.nextCursor,
    },
  );

  const pendingDocs = useMemo(
    () => (pendingQuery.data?.pages ?? []).flatMap((page) => page.documents),
    [pendingQuery.data?.pages],
  );
  const sealedDocs = useMemo(
    () => (sealedQuery.data?.pages ?? []).flatMap((page) => page.documents),
    [sealedQuery.data?.pages],
  );

  const pendingCount = pendingQuery.data?.pages[0]?.total ?? 0;
  const sealedCount = sealedQuery.data?.pages[0]?.total ?? 0;

  const docs = tab === 'pending' ? pendingDocs : sealedDocs;
  const activeQuery = tab === 'pending' ? pendingQuery : sealedQuery;
  const totalCount = tab === 'pending' ? pendingCount : sealedCount;
  const isLoading = activeQuery.isLoading;

  const updateStatus = trpc.discovery.updateStatus.useMutation({
    onSuccess: () => {
      void utils.discovery.findDocuments.invalidate();
      void utils.discovery.getOverview.invalidate();
    },
    onError: (err) => {
      toast({
        title: _(msg`Aktion fehlgeschlagen`),
        description: err.message,
        variant: 'destructive',
      });
    },
  });

  const bulkArchive = trpc.discovery.bulkArchive.useMutation({
    onSuccess: (res) => {
      toast({
        title: _(msg`${res.archivedCount} Belege endgültig archiviert`),
        description:
          res.skippedIds.length > 0
            ? _(msg`${res.skippedIds.length} Belege konnten nicht archiviert werden.`)
            : undefined,
      });
      setSelectedIds(new Set());
      void utils.discovery.findDocuments.invalidate();
      void utils.discovery.getOverview.invalidate();
    },
    onError: (err) => {
      toast({
        title: _(msg`Archivierung fehlgeschlagen`),
        description: err.message,
        variant: 'destructive',
      });
    },
  });

  const bulkArchiveByFilter = trpc.discovery.bulkArchiveByFilter.useMutation({
    onSuccess: (res) => {
      toast({
        title: _(msg`${res.archivedCount} Belege endgültig archiviert`),
      });
      setSelectedIds(new Set());
      void utils.discovery.findDocuments.invalidate();
      void utils.discovery.getOverview.invalidate();
    },
    onError: (err) => {
      toast({
        title: _(msg`Archivierung fehlgeschlagen`),
        description: err.message,
        variant: 'destructive',
      });
    },
  });

  const bulkUnaccept = trpc.discovery.bulkUnaccept.useMutation({
    onSuccess: (res) => {
      toast({
        title: _(msg`${res.unacceptedCount} Belege aus dem Archiv entfernt`),
        description:
          res.skippedIds.length > 0
            ? _(
                msg`${res.skippedIds.length} endgültig archivierte Belege konnten nicht entfernt werden (10-Jahres-Aufbewahrung).`,
              )
            : undefined,
      });
      setSelectedIds(new Set());
      void utils.discovery.findDocuments.invalidate();
      void utils.discovery.getOverview.invalidate();
    },
    onError: (err) => {
      toast({
        title: _(msg`Entfernen fehlgeschlagen`),
        description: err.message,
        variant: 'destructive',
      });
    },
  });

  const handleToggleTab = (next: ArchivTab) => {
    setTab(next);
    setSelectedIds(new Set());
  };

  const handleQueryChange = (value: string) => {
    setQuery(value);
    setSelectedIds(new Set());
  };

  const handleToggleSelect = (id: string) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const allSelected = docs.length > 0 && docs.every((d) => selectedIds.has(d.id));
  const handleToggleAll = () => {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(docs.map((d) => d.id)));
    }
  };

  const selectedDocumentIds = useMemo(
    () => docs.filter((d) => selectedIds.has(d.id)).map((d) => d.id),
    [docs, selectedIds],
  );

  const selectedCount = useMemo(() => selectedDocumentIds.length, [selectedDocumentIds]);

  const mutationBusy =
    updateStatus.isPending ||
    bulkArchive.isPending ||
    bulkArchiveByFilter.isPending ||
    bulkUnaccept.isPending;

  const archiveActionCount = selectedCount > 0 ? selectedCount : pendingCount;
  const hasArchiveSearchFilter = query.trim().length > 0;
  const handleArchiveAction = () => {
    setBulkArchiveDialogOpen(false);
    if (selectedCount > 0) {
      bulkArchive.mutate({ ids: selectedDocumentIds });
      return;
    }

    bulkArchiveByFilter.mutate({
      query: query.trim() || undefined,
    });
  };

  const downloadHref = useMemo(() => {
    const ids = selectedDocumentIds;
    if (ids.length === 0) {
      const params = new URLSearchParams({
        status: tab === 'pending' ? 'accepted' : 'archived',
      });
      const term = query.trim();
      if (term) params.set('query', term);

      return `/t/${teamUrl}/find-documents/zip-attachments?${params.toString()}`;
    }
    return `/t/${teamUrl}/find-documents/zip-attachments?ids=${ids.join(',')}`;
  }, [query, selectedDocumentIds, teamUrl, tab]);

  const taxPackageHref = useMemo(() => {
    const ids = selectedDocumentIds;
    if (ids.length === 0) {
      const params = new URLSearchParams({
        status: tab === 'pending' ? 'accepted' : 'archived',
      });
      const term = query.trim();
      if (term) params.set('query', term);

      return `/t/${teamUrl}/find-documents/tax-package?${params.toString()}`;
    }
    return `/t/${teamUrl}/find-documents/tax-package?ids=${ids.join(',')}`;
  }, [query, selectedDocumentIds, teamUrl, tab]);

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 px-4 py-6 md:px-6">
      <section className="overflow-hidden rounded-3xl border border-slate-200 bg-slate-950 shadow-sm">
        <div className="relative grid gap-6 px-5 py-6 text-white md:px-7 md:py-8 lg:grid-cols-[1fr_18rem] lg:items-center">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(16,185,129,0.35),transparent_34%),radial-gradient(circle_at_bottom_right,rgba(245,158,11,0.3),transparent_30%)]" />
          <div className="relative">
            <div className="inline-flex items-center rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs font-medium text-emerald-100">
              <ArchiveIcon className="mr-1.5 h-3.5 w-3.5" aria-hidden />
              <Trans>Ihr Beleg-Archiv</Trans>
            </div>
            <h1 className="mt-4 text-3xl font-semibold tracking-tight md:text-4xl">
              <Trans>Archiv</Trans>
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-200 md:text-base">
              <Trans>
                Belege wiederfinden, prüfen und sauber abschließen. Offene Belege bleiben
                korrigierbar, archivierte Belege sind schreibgeschützt und direkt exportierbar.
              </Trans>
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              <Button asChild variant="secondary" size="sm">
                <Link to="/vorlagen/gobd">
                  <BookOpenIcon className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                  <Trans>GoBD einfach erklärt</Trans>
                </Link>
              </Button>
              <Button
                asChild
                variant="outline"
                size="sm"
                className="border-white/25 bg-white/5 text-white hover:bg-white/15 hover:text-white"
              >
                <Link to={`/t/${teamUrl}/find-documents`}>
                  <SearchIcon className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                  <Trans>Neue Belege finden</Trans>
                </Link>
              </Button>
            </div>
          </div>
          <div className="relative hidden rounded-2xl border border-white/10 bg-white/10 p-4 backdrop-blur lg:block">
            <Illustration
              name="archive-shelf"
              alt="Archiv"
              tone="emerald"
              className="mx-auto h-32 w-full"
              hideOnError
            />
            <p className="mt-3 text-center text-xs leading-5 text-slate-200">
              <Trans>Erst prüfen. Dann archivieren. Danach nur noch lesen und exportieren.</Trans>
            </p>
          </div>
        </div>
      </section>

      <section className="grid gap-3 md:grid-cols-3">
        <ArchiveMetricCard
          tone="amber"
          icon={<AlertCircleIcon className="h-4 w-4" aria-hidden />}
          label={<Trans>Noch korrigierbar</Trans>}
          value={pendingCount}
          description={<Trans>prüfen, ergänzen, dann archivieren</Trans>}
        />
        <ArchiveMetricCard
          tone="emerald"
          icon={<LockIcon className="h-4 w-4" aria-hidden />}
          label={<Trans>Endgültig archiviert</Trans>}
          value={sealedCount}
          description={<Trans>schreibgeschützt und exportierbar</Trans>}
        />
        <ArchiveMetricCard
          tone="sky"
          icon={<CheckCircleIcon className="h-4 w-4" aria-hidden />}
          label={<Trans>Aktuelle Auswahl</Trans>}
          value={selectedCount}
          description={<Trans>für Sammelaktionen markiert</Trans>}
        />
      </section>

      <Tabs value={tab} onValueChange={(v) => handleToggleTab(v as ArchivTab)} className="w-full">
        <TabsList className="grid h-auto w-full grid-cols-1 gap-2 rounded-2xl border border-neutral-200 bg-white p-2 shadow-sm sm:grid-cols-2">
          <TabsTrigger
            value="pending"
            className="justify-start rounded-xl border border-transparent px-4 py-3 text-left text-neutral-700 data-[state=active]:border-amber-200 data-[state=active]:bg-amber-50 data-[state=active]:text-amber-950 data-[state=active]:shadow-none"
          >
            <span className="flex w-full items-center justify-between gap-3">
              <span>
                <span className="block text-sm font-semibold">
                  <Trans>Noch korrigierbar</Trans>
                </span>
                <span className="block text-xs font-normal opacity-80">
                  <Trans>Prüfen und archivieren</Trans>
                </span>
              </span>
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900">
                {pendingCount}
              </span>
            </span>
          </TabsTrigger>
          <TabsTrigger
            value="sealed"
            className="justify-start rounded-xl border border-transparent px-4 py-3 text-left text-neutral-700 data-[state=active]:border-emerald-200 data-[state=active]:bg-emerald-50 data-[state=active]:text-emerald-950 data-[state=active]:shadow-none"
          >
            <span className="flex w-full items-center justify-between gap-3">
              <span>
                <span className="block text-sm font-semibold">
                  <Trans>Endgültig archiviert</Trans>
                </span>
                <span className="block text-xs font-normal opacity-80">
                  <Trans>Suchen, lesen, exportieren</Trans>
                </span>
              </span>
              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-900">
                {sealedCount}
              </span>
            </span>
          </TabsTrigger>
        </TabsList>
      </Tabs>

      <section
        className={`rounded-2xl border p-4 shadow-sm ${
          tab === 'pending'
            ? 'border-amber-200 bg-gradient-to-r from-amber-50 via-white to-white'
            : 'border-emerald-200 bg-gradient-to-r from-emerald-50 via-white to-white'
        }`}
      >
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-start gap-3">
            <div
              className={`mt-0.5 rounded-2xl p-2 ${
                tab === 'pending'
                  ? 'bg-amber-100 text-amber-900'
                  : 'bg-emerald-100 text-emerald-900'
              }`}
            >
              {tab === 'pending' ? (
                <AlertCircleIcon className="h-5 w-5" aria-hidden />
              ) : (
                <LockIcon className="h-5 w-5" aria-hidden />
              )}
            </div>
            <div>
              <h2 className="text-base font-semibold text-neutral-950">
                {tab === 'pending' ? (
                  <Trans>Zur Prüfung: noch bearbeitbar</Trans>
                ) : (
                  <Trans>Archiviert: nicht mehr änderbar</Trans>
                )}
              </h2>
              <p className="mt-1 max-w-2xl text-sm leading-6 text-neutral-700">
                {tab === 'pending' ? (
                  <Trans>
                    Diese Belege sind noch nicht endgültig archiviert. Prüfen, korrigieren oder
                    entfernen Sie sie, bevor sie schreibgeschützt werden.
                  </Trans>
                ) : (
                  <Trans>
                    Diese Belege sind abgeschlossen. Sie bleiben auffindbar, lesbar und
                    exportierbar, können aber nicht mehr verändert werden.
                  </Trans>
                )}
              </p>
            </div>
          </div>
          <div className="grid gap-2 sm:grid-cols-3 md:min-w-[24rem]">
            {(tab === 'pending'
              ? [
                  <Trans key="check">1. Prüfen</Trans>,
                  <Trans key="fix">2. Korrigieren</Trans>,
                  <Trans key="archive">3. Archivieren</Trans>,
                ]
              : [
                  <Trans key="locked">Schreibgeschützt</Trans>,
                  <Trans key="retention">10 Jahre</Trans>,
                  <Trans key="export">Export bereit</Trans>,
                ]
            ).map((item) => (
              <div
                key={String(item.key)}
                className={`rounded-xl border px-3 py-2 text-center text-xs font-semibold ${
                  tab === 'pending'
                    ? 'border-amber-200 bg-amber-100/70 text-amber-950'
                    : 'border-emerald-200 bg-emerald-100/70 text-emerald-950'
                }`}
              >
                {item}
              </div>
            ))}
          </div>
        </div>
      </section>

      <Card className="overflow-hidden rounded-2xl border-neutral-200 bg-white shadow-sm">
        <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
          <div>
            <label className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
              <Trans>Archiv durchsuchen</Trans>
            </label>
            <div className="relative mt-2 max-w-xl">
              <SearchIcon
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400"
                aria-hidden
              />
              <Input
                type="search"
                placeholder={_(msg`Titel, Absender oder Rechnungs-Nr.`)}
                value={query}
                onChange={(e) => handleQueryChange(e.target.value)}
                className="h-11 rounded-xl border-neutral-300 bg-neutral-50 pl-10 focus-visible:bg-white"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 lg:justify-end">
            {tab === 'pending' && pendingCount > 0 && (
              <>
                <Button
                  variant={selectedCount > 0 ? 'default' : 'outline'}
                  size="sm"
                  disabled={mutationBusy}
                  onClick={() => setBulkArchiveDialogOpen(true)}
                  className={selectedCount === 0 ? 'border-amber-300 text-amber-950' : undefined}
                >
                  {mutationBusy ? (
                    <Loader2Icon className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden />
                  ) : (
                    <CheckCircleIcon className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                  )}
                  {selectedCount > 0 ? (
                    <Trans>{selectedCount} archivieren</Trans>
                  ) : (
                    <Trans>Alle {pendingCount} archivieren</Trans>
                  )}
                </Button>

                <Button
                  variant="outline"
                  size="sm"
                  disabled={mutationBusy || selectedCount === 0}
                  onClick={() => {
                    if (selectedDocumentIds.length === 0) return;
                    bulkUnaccept.mutate({ ids: selectedDocumentIds });
                  }}
                  className="border-red-200 text-red-700 hover:bg-red-50"
                >
                  {bulkUnaccept.isPending ? (
                    <Loader2Icon className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden />
                  ) : (
                    <Trash2Icon className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                  )}
                  {selectedCount > 0 ? (
                    <Trans>{selectedCount} entfernen</Trans>
                  ) : (
                    <Trans>Entfernen</Trans>
                  )}
                </Button>
              </>
            )}
            <Button asChild variant="outline" size="sm">
              <a href={downloadHref}>
                <DownloadIcon className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                <Trans>ZIP</Trans>
              </a>
            </Button>
            <Button asChild variant="outline" size="sm">
              <a href={taxPackageHref}>
                <ReceiptTextIcon className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                <Trans>Steuerpaket</Trans>
              </a>
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled
              title="Connectoren zu Accountable/sevDesk/Lexware Office — Phase 4"
            >
              <SendIcon className="mr-1.5 h-3.5 w-3.5" aria-hidden />
              <Trans>Buchhaltung</Trans>
              <span className="ml-1.5 rounded bg-neutral-100 px-1 py-0.5 text-[10px] text-neutral-600">
                <Trans>bald</Trans>
              </span>
            </Button>
          </div>
        </div>

        <div className="border-t border-neutral-100 bg-slate-50 px-4 py-3">
          <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <span
                className={`mt-0.5 rounded-full p-1.5 ${
                  selectedCount > 0
                    ? 'bg-sky-100 text-sky-900'
                    : tab === 'pending'
                      ? 'bg-amber-100 text-amber-900'
                      : 'bg-emerald-100 text-emerald-900'
                }`}
              >
                {selectedCount > 0 ? (
                  <CheckCircleIcon className="h-4 w-4" aria-hidden />
                ) : tab === 'pending' ? (
                  <AlertCircleIcon className="h-4 w-4" aria-hidden />
                ) : (
                  <LockIcon className="h-4 w-4" aria-hidden />
                )}
              </span>
              <div>
                <p className="font-semibold text-neutral-950">
                  {selectedCount > 0 ? (
                    <Trans>Aktionen gelten für Ihre Auswahl</Trans>
                  ) : tab === 'pending' ? (
                    <Trans>Archivieren und Export gelten für alle passenden offenen Belege</Trans>
                  ) : (
                    <Trans>Export gilt für alle passenden archivierten Belege</Trans>
                  )}
                </p>
                <p className="mt-0.5 text-neutral-600">
                  {selectedCount > 0 ? (
                    <Trans>
                      Markierte Belege können gemeinsam archiviert oder exportiert werden.
                    </Trans>
                  ) : tab === 'pending' ? (
                    <Trans>
                      Nutzen Sie die Suche oder markieren Sie einzelne Belege, wenn es enger sein
                      soll.
                    </Trans>
                  ) : (
                    <Trans>
                      Nutzen Sie die Suche oder markieren Sie einzelne Belege, wenn es enger sein
                      soll.
                    </Trans>
                  )}
                </p>
              </div>
            </div>
            <span className="shrink-0 rounded-full bg-neutral-100 px-3 py-1 text-xs font-semibold text-neutral-700">
              {selectedCount > 0 ? (
                <Trans>{selectedCount} markiert</Trans>
              ) : (
                <Trans>Keine Auswahl</Trans>
              )}
            </span>
          </div>
        </div>

        {docs.length > 0 && (
          <div className="flex flex-col gap-3 border-t border-neutral-100 bg-neutral-50/70 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-neutral-800">
              <Checkbox
                checked={allSelected}
                onCheckedChange={handleToggleAll}
                aria-label="Alle auswählen"
                className="h-5 w-5"
              />
              {allSelected ? (
                <Trans>Auswahl aufheben</Trans>
              ) : (
                <Trans>Alle geladenen {docs.length} Belege markieren</Trans>
              )}
            </label>
            <span className="text-xs text-neutral-500">
              {selectedCount > 0 ? (
                <Trans>{selectedCount} Belege ausgewählt</Trans>
              ) : (
                <Trans>Keine Auswahl</Trans>
              )}
            </span>
          </div>
        )}
      </Card>

      {isLoading ? (
        <Card className="flex items-center justify-center rounded-2xl border-neutral-200 py-12 text-neutral-500 shadow-sm">
          <Loader2Icon className="mr-2 h-4 w-4 animate-spin" aria-hidden />
          <Trans>Lädt…</Trans>
        </Card>
      ) : docs.length === 0 ? (
        <Card className="flex flex-col items-center gap-4 rounded-2xl border-dashed border-neutral-300 bg-neutral-50/70 px-6 py-12 text-center shadow-sm">
          <Illustration
            name={tab === 'pending' ? 'empty-shelf' : 'archive-empty'}
            alt={
              tab === 'pending'
                ? 'Keine Belege zur Ablage bereit'
                : 'Noch keine endgültig archivierten Belege'
            }
            tone={tab === 'pending' ? 'amber' : 'emerald'}
            className="h-28 w-full max-w-[200px]"
          />
          <p className="text-sm text-neutral-500">
            {tab === 'pending' ? (
              <Trans>Keine Belege liegen aktuell zur Ablage bereit.</Trans>
            ) : (
              <Trans>Noch keine Belege endgültig archiviert.</Trans>
            )}
          </p>
        </Card>
      ) : (
        <>
          <ul className="space-y-3">
            {docs.map((doc) => (
              <ArchivRow
                key={doc.id}
                doc={doc}
                tab={tab}
                locale={i18n.locale}
                teamUrl={teamUrl}
                isSelected={selectedIds.has(doc.id)}
                isPending={mutationBusy}
                onToggleSelect={handleToggleSelect}
                onArchive={(id) => updateStatus.mutate({ id, action: 'archive' })}
                onUnaccept={(id) => bulkUnaccept.mutate({ ids: [id] })}
              />
            ))}
          </ul>
          {(activeQuery.hasNextPage || docs.length < totalCount) && (
            <div className="flex flex-col items-center gap-3 pt-2">
              <div className="text-xs text-neutral-500">
                <Trans>
                  {docs.length} von {totalCount} geladen
                </Trans>
              </div>
              {activeQuery.hasNextPage && (
                <Button
                  variant="outline"
                  onClick={() => void activeQuery.fetchNextPage()}
                  disabled={activeQuery.isFetchingNextPage}
                >
                  {activeQuery.isFetchingNextPage ? (
                    <Loader2Icon className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                  ) : null}
                  <Trans>Weitere laden</Trans>
                </Button>
              )}
            </div>
          )}
        </>
      )}

      <AlertDialog open={bulkArchiveDialogOpen} onOpenChange={setBulkArchiveDialogOpen}>
        <AlertDialogContent className="max-w-xl overflow-hidden rounded-2xl border-amber-200 p-0">
          <div className="border-b border-amber-100 bg-amber-50 px-6 py-5">
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center gap-2 text-amber-950">
                <AlertTriangleIcon className="h-5 w-5 text-amber-600" aria-hidden />
                <Trans>Belege jetzt archivieren?</Trans>
              </AlertDialogTitle>
              <AlertDialogDescription className="text-amber-900">
                {selectedCount > 0 ? (
                  <Trans>
                    Sie archivieren {archiveActionCount} markierte Belege. Danach sind sie
                    schreibgeschützt.
                  </Trans>
                ) : hasArchiveSearchFilter ? (
                  <Trans>
                    Sie archivieren alle {archiveActionCount} passenden Belege aus Ihrer aktuellen
                    Suche. Danach sind sie schreibgeschützt.
                  </Trans>
                ) : (
                  <Trans>
                    Sie archivieren alle {archiveActionCount} offenen Belege. Danach sind sie
                    schreibgeschützt.
                  </Trans>
                )}
              </AlertDialogDescription>
            </AlertDialogHeader>
          </div>

          <div className="space-y-3 px-6 py-5 text-sm text-neutral-700">
            <p>
              <Trans>
                Archivierte Belege können Sie weiterhin suchen, lesen, herunterladen und
                exportieren.
              </Trans>
            </p>
            <p>
              <Trans>
                Sie können sie danach aber nicht mehr bearbeiten oder aus dem Archiv entfernen. Die
                Aufbewahrung läuft für 10 Jahre.
              </Trans>
            </p>
          </div>

          <AlertDialogFooter className="border-t border-neutral-100 bg-neutral-50 px-6 py-4">
            <AlertDialogCancel>
              <Trans>Noch prüfen</Trans>
            </AlertDialogCancel>
            <AlertDialogAction onClick={handleArchiveAction} disabled={mutationBusy}>
              {mutationBusy ? (
                <Loader2Icon className="mr-2 h-4 w-4 animate-spin" aria-hidden />
              ) : null}
              <Trans>Ja, archivieren</Trans>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

const ArchivRow = ({
  doc,
  tab,
  locale,
  teamUrl,
  isSelected,
  isPending,
  onToggleSelect,
  onArchive,
  onUnaccept,
}: {
  doc: Document;
  tab: ArchivTab;
  locale: string;
  teamUrl: string;
  isSelected: boolean;
  isPending: boolean;
  onToggleSelect: (id: string) => void;
  onArchive: (id: string) => void;
  onUnaccept: (id: string) => void;
}) => {
  // "Bitte ergänzen"-Zustand: Pending-Tab und mindestens ein Pflichtfeld leer.
  const needsCompletion = tab === 'pending' && (!doc.correspondent || !doc.documentType);

  return (
    <li
      className={`group flex items-stretch overflow-hidden rounded-2xl border shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-lg ${
        isSelected
          ? 'border-sky-300 bg-sky-50/70 ring-2 ring-sky-200'
          : needsCompletion
            ? 'border-amber-200 bg-gradient-to-r from-amber-50 via-white to-white'
            : tab === 'sealed'
              ? 'border-emerald-200 bg-gradient-to-r from-emerald-50/70 via-white to-white'
              : 'border-neutral-200 bg-white'
      }`}
    >
      <span
        className={`w-1.5 shrink-0 ${
          isSelected
            ? 'bg-sky-500'
            : tab === 'sealed'
              ? 'bg-emerald-600'
              : needsCompletion
                ? 'bg-amber-500'
                : 'bg-slate-300'
        }`}
        aria-hidden
      />
      <div className="flex flex-1 flex-wrap items-start gap-3 px-4 py-4">
        <label className="flex cursor-pointer items-center rounded-xl bg-white/80 p-1 shadow-sm ring-1 ring-neutral-200">
          <Checkbox
            checked={isSelected}
            onCheckedChange={() => onToggleSelect(doc.id)}
            aria-label={`Beleg „${doc.title}" auswählen`}
            className="h-5 w-5"
          />
        </label>
        <Link
          to={`/t/${teamUrl}/find-documents/${doc.id}`}
          className="flex min-w-0 flex-1 items-start gap-3 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span
            className={`mt-0.5 rounded-2xl p-2 ${
              tab === 'sealed'
                ? 'bg-emerald-100 text-emerald-900'
                : needsCompletion
                  ? 'bg-amber-100 text-amber-900'
                  : 'bg-slate-100 text-slate-700'
            }`}
          >
            <FileTextIcon className="h-4 w-4 shrink-0" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              {needsCompletion ? (
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-900">
                  <Trans>Bitte ergänzen</Trans>
                </span>
              ) : null}
              <span className="font-semibold text-neutral-950">
                {doc.correspondent ?? doc.title}
              </span>
              {doc.detectedAmount && (
                <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-semibold tabular-nums text-neutral-800">
                  {doc.detectedAmount}
                </span>
              )}
              <span className="rounded-full bg-white px-2 py-0.5 text-xs tabular-nums text-neutral-500 ring-1 ring-neutral-200">
                {formatDate(doc.documentDate ?? doc.capturedAt, locale)}
              </span>
              {doc.hasArchive && doc.attachmentCount > 0 && (
                <span
                  className="inline-flex items-center gap-0.5 text-xs text-neutral-500"
                  title="Anhang"
                >
                  <PaperclipIcon className="h-3 w-3" aria-hidden />
                  {doc.attachmentCount}
                </span>
              )}
              {tab === 'sealed' && doc.archivedAt && (
                <Badge variant="secondary" className="gap-1.5 text-xs">
                  <LockIcon className="h-3 w-3" aria-hidden />
                  <Trans>Seit {formatDate(doc.archivedAt, locale)}</Trans>
                </Badge>
              )}
            </div>
            <div className="mt-0.5 truncate text-sm text-neutral-700 hover:underline">
              {doc.title}
            </div>
            {needsCompletion && (
              <div className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-amber-800">
                {!doc.documentType && (
                  <span className="inline-flex items-center gap-1">
                    <AlertCircleIcon className="h-3 w-3" aria-hidden />
                    <Trans>Beleg-Typ fehlt</Trans>
                  </span>
                )}
                {!doc.correspondent && (
                  <span className="inline-flex items-center gap-1">
                    <AlertCircleIcon className="h-3 w-3" aria-hidden />
                    <Trans>Korrespondent fehlt</Trans>
                  </span>
                )}
              </div>
            )}
          </div>
        </Link>

        <div className="flex w-full shrink-0 flex-wrap items-center gap-2 border-t border-neutral-100 pt-3 sm:w-auto sm:border-t-0 sm:pt-0">
          {tab === 'pending' && needsCompletion && (
            <Button
              asChild
              size="sm"
              variant="outline"
              className="border-amber-300 bg-white text-amber-900 hover:bg-amber-50"
            >
              <Link to={`/t/${teamUrl}/find-documents/${doc.id}`}>
                <Trans>Felder ergänzen</Trans>
              </Link>
            </Button>
          )}
          {tab === 'pending' && !needsCompletion && (
            <AcceptDiscoveryDocumentButton
              size="sm"
              variant="default"
              disabled={isPending}
              onConfirm={() => onArchive(doc.id)}
              label={<Trans>Archivieren</Trans>}
            />
          )}
          {doc.hasArchive && (
            <Button asChild size="sm" variant="ghost" className="h-8 w-8 p-0" title="Herunterladen">
              <a
                href={`/t/${teamUrl}/find-documents/${doc.id}/artifacts`}
                aria-label="Beleg herunterladen"
              >
                <DownloadIcon className="h-3.5 w-3.5" aria-hidden />
              </a>
            </Button>
          )}
          <Button asChild size="sm" variant="ghost" className="h-8 px-2">
            <Link to={`/t/${teamUrl}/find-documents/${doc.id}`}>
              <Trans>Details</Trans>
            </Link>
          </Button>

          {/* ⋯-Menü pro Zeile: Senden / Weitergeben (Phase 4) und im pending-Tab
              die einzige aktuell mögliche Mutation: aus dem Archiv entfernen.
              Im sealed-Tab nur Lese-/Export-Optionen — WORM verbietet Mutationen. */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="sm"
                variant="ghost"
                className="h-8 w-8 p-0"
                aria-label="Mehr-Menü"
                disabled={isPending}
              >
                <MoreHorizontalIcon className="h-3.5 w-3.5" aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-[14rem]">
              {doc.hasArchive && (
                <DropdownMenuItem asChild>
                  <a
                    href={`/t/${teamUrl}/find-documents/${doc.id}/artifacts`}
                    download
                    className="flex items-center"
                  >
                    <DownloadIcon className="mr-2 h-4 w-4" aria-hidden />
                    <Trans>Herunterladen</Trans>
                  </a>
                </DropdownMenuItem>
              )}
              <DropdownMenuItem disabled title="An Buchhaltung senden — Phase 4">
                <SendIcon className="mr-2 h-4 w-4" aria-hidden />
                <Trans>An Buchhaltung senden</Trans>
                <span className="ml-auto rounded bg-neutral-100 px-1 py-0.5 text-[10px] text-neutral-600">
                  bald
                </span>
              </DropdownMenuItem>
              <DropdownMenuItem disabled title="Per E-Mail weitergeben — Phase 4">
                <SendIcon className="mr-2 h-4 w-4" aria-hidden />
                <Trans>Per E-Mail weitergeben</Trans>
                <span className="ml-auto rounded bg-neutral-100 px-1 py-0.5 text-[10px] text-neutral-600">
                  bald
                </span>
              </DropdownMenuItem>
              {tab === 'pending' && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() => onUnaccept(doc.id)}
                    className="text-red-700 focus:bg-red-50 focus:text-red-800"
                  >
                    <Trash2Icon className="mr-2 h-4 w-4" aria-hidden />
                    <Trans>Aus dem Archiv entfernen</Trans>
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </li>
  );
};

const ArchiveMetricCard = ({
  tone,
  icon,
  label,
  value,
  description,
}: {
  tone: 'amber' | 'emerald' | 'sky';
  icon: ReactNode;
  label: ReactNode;
  value: number;
  description: ReactNode;
}) => {
  const toneClass =
    tone === 'amber'
      ? 'border-amber-200 bg-amber-50 text-amber-950'
      : tone === 'emerald'
        ? 'border-emerald-200 bg-emerald-50 text-emerald-950'
        : 'border-sky-200 bg-sky-50 text-sky-950';
  const iconClass =
    tone === 'amber'
      ? 'bg-amber-100 text-amber-900'
      : tone === 'emerald'
        ? 'bg-emerald-100 text-emerald-900'
        : 'bg-sky-100 text-sky-900';

  return (
    <Card className={`rounded-2xl border p-4 shadow-sm ${toneClass}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide opacity-75">{label}</p>
          <p className="mt-2 text-3xl font-semibold tabular-nums">{value}</p>
          <p className="mt-1 text-sm opacity-80">{description}</p>
        </div>
        <span className={`rounded-2xl p-2 ${iconClass}`}>{icon}</span>
      </div>
    </Card>
  );
};
