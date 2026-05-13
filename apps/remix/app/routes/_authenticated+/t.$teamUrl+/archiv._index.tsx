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
import { useMemo, useState } from 'react';

import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react';
import { Trans } from '@lingui/react/macro';
import {
  AlertCircleIcon,
  BookOpenIcon,
  CheckCircleIcon,
  DownloadIcon,
  FileTextIcon,
  Loader2Icon,
  LockIcon,
  MoreHorizontalIcon,
  PaperclipIcon,
  ReceiptTextIcon,
  SendIcon,
  Trash2Icon,
} from 'lucide-react';
import { Link, useParams } from 'react-router';

import { trpc } from '@nexasign/trpc/react';
import type { TFindDiscoveryDocumentsResponse } from '@nexasign/trpc/server/discovery-router/schema';
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

  const selectedCount = useMemo(
    () => docs.filter((d) => selectedIds.has(d.id)).length,
    [docs, selectedIds],
  );

  const mutationBusy =
    updateStatus.isPending ||
    bulkArchive.isPending ||
    bulkArchiveByFilter.isPending ||
    bulkUnaccept.isPending;

  const handleArchiveAction = () => {
    const count = selectedCount > 0 ? selectedCount : pendingCount;
    const confirmed =
      typeof window === 'undefined'
        ? true
        : window.confirm(
            selectedCount > 0
              ? `Möchten Sie ${count} ausgewählte Belege endgültig archivieren? Danach sind sie 10 Jahre lang schreibgeschützt.`
              : `Möchten Sie alle ${count} Belege in dieser Sicht endgültig archivieren? Danach sind sie 10 Jahre lang schreibgeschützt.`,
          );
    if (!confirmed) return;

    const ids = docs.filter((d) => selectedIds.has(d.id)).map((d) => d.id);
    if (selectedCount > 0) {
      bulkArchive.mutate({ ids });
      return;
    }

    bulkArchiveByFilter.mutate({
      query: query.trim() || undefined,
    });
  };

  const downloadHref = useMemo(() => {
    const ids = [...selectedIds];
    if (ids.length === 0) {
      // Wenn keine Auswahl: nimm den aktuellen Tab als Filter.
      return `/t/${teamUrl}/find-documents/zip-attachments?status=${
        tab === 'pending' ? 'accepted' : 'archived'
      }`;
    }
    return `/t/${teamUrl}/find-documents/zip-attachments?ids=${ids.join(',')}`;
  }, [selectedIds, teamUrl, tab]);

  const taxPackageHref = useMemo(() => {
    const ids = [...selectedIds];
    if (ids.length === 0) {
      return `/t/${teamUrl}/find-documents/tax-package?status=${
        tab === 'pending' ? 'accepted' : 'archived'
      }`;
    }
    return `/t/${teamUrl}/find-documents/tax-package?ids=${ids.join(',')}`;
  }, [selectedIds, teamUrl, tab]);

  return (
    <div className="mx-auto w-full max-w-5xl space-y-5 px-4 py-6 md:px-6">
      {/* HEADER */}
      <header className="flex flex-col items-start gap-6 md:flex-row md:items-center md:justify-between">
        <div className="flex-1">
          <h1 className="text-2xl font-bold tracking-tight md:text-3xl">
            <Trans>Archiv</Trans>
          </h1>
          <p className="mt-1 max-w-3xl text-sm text-neutral-600">
            <Trans>
              Hier liegen alle Belege, die Sie übernommen haben. Solange Sie sie noch nicht
              endgültig archiviert haben, können Sie Felder korrigieren. Mit einem Klick auf
              „Endgültig archivieren" sind sie 10 Jahre lang sicher abgelegt — wie es das Finanzamt
              verlangt.
            </Trans>
          </p>
        </div>
        <div className="flex w-full flex-col items-start gap-3 md:w-auto md:items-end">
          <Button asChild variant="outline" size="sm">
            <Link to="/vorlagen/gobd">
              <BookOpenIcon className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
              <Trans>Was bedeutet GoBD?</Trans>
            </Link>
          </Button>
          <Illustration
            name="archive-shelf"
            alt="Archiv"
            tone="emerald"
            className="hidden h-28 w-40 shrink-0 md:block"
            hideOnError
          />
        </div>
      </header>

      {/* SUB-TABS */}
      <Tabs value={tab} onValueChange={(v) => handleToggleTab(v as ArchivTab)} className="w-full">
        <TabsList className="flex h-auto w-full justify-start gap-1 border-b bg-transparent p-0">
          <TabsTrigger
            value="pending"
            className="rounded-none border-b-2 border-transparent px-3 py-2 data-[state=active]:border-neutral-900 data-[state=active]:bg-transparent"
          >
            <Trans>Noch korrigierbar</Trans>
            {pendingCount > 0 && (
              <span className="ml-1.5 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-900">
                {pendingCount}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger
            value="sealed"
            className="rounded-none border-b-2 border-transparent px-3 py-2 data-[state=active]:border-neutral-900 data-[state=active]:bg-transparent"
          >
            <Trans>Endgültig archiviert</Trans>
            {sealedCount > 0 && (
              <span className="ml-1.5 text-xs text-neutral-400">{sealedCount}</span>
            )}
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {/* INFO-STREIFEN je nach Tab */}
      {tab === 'pending' && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <p>
            <Trans>
              <strong>
                {pendingCount} Belege liegen im Archiv, sind aber noch nicht endgültig.
              </strong>{' '}
              Sie können Felder korrigieren oder einen Beleg wieder entfernen.
            </Trans>
          </p>
          <p className="mt-1">
            <Trans>
              Klick auf <strong>„Endgültig archivieren"</strong> legt den Beleg für 10 Jahre fest —
              dann können Sie ihn nur noch lesen oder herunterladen, nicht mehr ändern.
            </Trans>
          </p>
        </div>
      )}
      {tab === 'sealed' && (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          <Trans>
            {sealedCount} Belege sind endgültig archiviert. Sie können sie noch lesen, suchen und
            herunterladen — aber nicht mehr ändern. So verlangt es das Finanzamt (10 Jahre
            Aufbewahrung, § 147 AO).
          </Trans>
        </div>
      )}

      {/* SUCHE */}
      <Input
        type="search"
        placeholder={_(msg`Im Archiv suchen — Titel, Korrespondent, Rechnungs-Nr.`)}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="md:max-w-md"
      />

      {/* BULK-AKTIONEN — wirkt auf Auswahl, sonst auf den ganzen Tab. */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-1 text-xs text-neutral-500">
          {selectedCount > 0 ? (
            <Trans>{selectedCount} ausgewählt:</Trans>
          ) : (
            <Trans>Aktionen für alle in dieser Sicht:</Trans>
          )}
        </span>
        {tab === 'pending' && pendingCount > 0 && (
          <>
            <Button
              variant={selectedCount > 0 ? 'default' : 'outline'}
              size="sm"
              disabled={mutationBusy}
              onClick={handleArchiveAction}
            >
              {mutationBusy ? (
                <Loader2Icon className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden />
              ) : (
                <CheckCircleIcon className="mr-1.5 h-3.5 w-3.5" aria-hidden />
              )}
              {selectedCount > 0 ? (
                <Trans>{selectedCount} endgültig archivieren</Trans>
              ) : (
                <Trans>Alle {pendingCount} endgültig archivieren</Trans>
              )}
            </Button>

            <Button
              variant="outline"
              size="sm"
              disabled={mutationBusy || selectedCount === 0}
              onClick={() => {
                const ids = docs.filter((d) => selectedIds.has(d.id)).map((d) => d.id);
                if (ids.length === 0) return;
                bulkUnaccept.mutate({ ids });
              }}
              className="border-red-200 text-red-700 hover:bg-red-50"
            >
              {bulkUnaccept.isPending ? (
                <Loader2Icon className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden />
              ) : (
                <Trash2Icon className="mr-1.5 h-3.5 w-3.5" aria-hidden />
              )}
              {selectedCount > 0 ? (
                <Trans>{selectedCount} aus Archiv entfernen</Trans>
              ) : (
                <Trans>Aus Archiv entfernen</Trans>
              )}
            </Button>
          </>
        )}
        <Button asChild variant="outline" size="sm">
          <a href={downloadHref}>
            <DownloadIcon className="mr-1.5 h-3.5 w-3.5" aria-hidden />
            <Trans>Als ZIP herunterladen</Trans>
          </a>
        </Button>
        <Button asChild variant="outline" size="sm">
          <a href={taxPackageHref}>
            <ReceiptTextIcon className="mr-1.5 h-3.5 w-3.5" aria-hidden />
            <Trans>Steuerpaket exportieren (DATEV-CSV)</Trans>
          </a>
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled
          title="Connectoren zu Accountable/sevDesk/Lexware Office — Phase 4"
        >
          <SendIcon className="mr-1.5 h-3.5 w-3.5" aria-hidden />
          <Trans>An Buchhaltung senden</Trans>
          <span className="ml-1.5 rounded bg-neutral-100 px-1 py-0.5 text-[10px] text-neutral-600">
            <Trans>bald</Trans>
          </span>
        </Button>
      </div>

      {/* MASTER-CHECKBOX + LISTE */}
      {docs.length > 0 && (
        <label className="flex cursor-pointer items-center gap-2 px-1 text-sm text-neutral-700">
          <Checkbox
            checked={allSelected}
            onCheckedChange={handleToggleAll}
            aria-label="Alle auswählen"
            className="h-5 w-5"
          />
          {allSelected ? (
            <Trans>Auswahl aufheben</Trans>
          ) : (
            <Trans>Alle geladenen {docs.length} markieren</Trans>
          )}
        </label>
      )}

      {isLoading ? (
        <Card className="flex items-center justify-center py-12 text-neutral-500">
          <Loader2Icon className="mr-2 h-4 w-4 animate-spin" aria-hidden />
          <Trans>Lädt…</Trans>
        </Card>
      ) : docs.length === 0 ? (
        <Card className="flex flex-col items-center gap-4 px-6 py-12 text-center">
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
          <ul className="space-y-2">
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
      className={`flex items-stretch overflow-hidden rounded-md border shadow-sm transition-all hover:shadow-md ${
        isSelected
          ? 'border-primary bg-white ring-2 ring-primary/30'
          : needsCompletion
            ? 'border-amber-300 bg-amber-50/40'
            : 'border-neutral-200 bg-white'
      }`}
    >
      <span
        className={`w-1 shrink-0 ${
          tab === 'sealed' ? 'bg-emerald-600' : needsCompletion ? 'bg-amber-500' : 'bg-amber-400'
        }`}
        aria-hidden
      />
      <div className="flex flex-1 flex-wrap items-start gap-3 px-4 py-3">
        <label className="flex cursor-pointer items-center pt-0.5">
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
          <FileTextIcon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              {needsCompletion ? (
                <span className="rounded-sm bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-900">
                  <Trans>Bitte ergänzen</Trans>
                </span>
              ) : null}
              <span className="font-medium text-foreground">{doc.correspondent ?? doc.title}</span>
              {doc.detectedAmount && (
                <span className="text-sm tabular-nums text-foreground">{doc.detectedAmount}</span>
              )}
              <span className="text-xs tabular-nums text-neutral-500">
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

        <div className="flex shrink-0 items-center gap-2">
          {tab === 'pending' && needsCompletion && (
            <Button asChild size="sm" variant="outline" className="border-amber-300 text-amber-900">
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
              label={<Trans>Endgültig archivieren</Trans>}
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
