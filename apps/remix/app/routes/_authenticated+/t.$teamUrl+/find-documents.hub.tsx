// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 NexaStack, NexaSign contributors
//
// /find-documents/hub — Wireframe-konformer Lifecycle-Hub (uebersicht.html).
// Hero mit Hauptkennzahl + 4-Stufen-Funnel, vier Eintrittspunkt-Tiles,
// gefilterte Liste mit Status-Tabs und Lifecycle-Dots pro Zeile. Power-User-
// Sicht mit dem Trichter, der den ganzen Lifecycle auf einen Blick zeigt.
import { useMemo, useState } from 'react';

import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react';
import { Trans } from '@lingui/react/macro';
import {
  ArchiveIcon,
  FilePlus2Icon,
  FileTextIcon,
  InboxIcon,
  Loader2Icon,
  LockIcon,
  MailSearchIcon,
  PenLineIcon,
  ReceiptTextIcon,
  UploadIcon,
} from 'lucide-react';
import { Link, useParams } from 'react-router';

import { trpc } from '@nexasign/trpc/react';
import { Badge } from '@nexasign/ui/primitives/badge';
import { Button } from '@nexasign/ui/primitives/button';
import { Card } from '@nexasign/ui/primitives/card';
import { Input } from '@nexasign/ui/primitives/input';

import { AcceptDiscoveryDocumentButton } from '~/components/dialogs/accept-discovery-document-button';
import { TaxPackageConfirmButton } from '~/components/dialogs/tax-package-confirm-button';
import { CorrespondentSummaryCard } from '~/components/discovery/correspondent-summary-card';
import { appMetaTags } from '~/utils/meta';

export function meta() {
  return appMetaTags(msg`Lifecycle-Hub`);
}

type TabKey = 'all' | 'inbox' | 'waiting-signatures' | 'accepted' | 'archived';

const formatDate = (date: Date | null, locale: string): string => {
  if (!date) return '–';
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(date);
};

/**
 * Lifecycle-Dots: vier Punkte (Eingang / Wartet / Bereit / Archiviert), der
 * aktive Stand ist gefüllt schwarz, die anderen grau.
 */
const LifecycleDots = ({ status }: { status: string }) => {
  const stage =
    status === 'inbox' || status === 'pending-manual'
      ? 0
      : status === 'waiting-signatures'
        ? 1
        : status === 'accepted' || status === 'signed'
          ? 2
          : status === 'archived' || status === 'processed'
            ? 3
            : 0;
  const labels = [
    'Eingang',
    'Wartet auf Unterschrift',
    'Im Archiv (korrigierbar)',
    'Endgültig archiviert',
  ];
  return (
    <div className="mt-2 flex items-center gap-1 text-xs text-neutral-500">
      {[0, 1, 2, 3].map((i) => (
        <span
          key={i}
          className={`h-1.5 w-1.5 rounded-full ${
            i === stage ? 'bg-neutral-900' : 'bg-neutral-300'
          }`}
        />
      ))}
      <span className="ml-1">{labels[stage]}</span>
    </div>
  );
};

export default function LifecycleHubPage() {
  const { _, i18n } = useLingui();
  const params = useParams();
  const teamUrl = params.teamUrl ?? '';
  const utils = trpc.useUtils();

  const [tab, setTab] = useState<TabKey>('all');
  const [query, setQuery] = useState('');

  const { data: overview } = trpc.discovery.getOverview.useQuery();
  const { data: pendingSignatures } = trpc.document.getOutstandingSignatureCount.useQuery();
  const { data: outstandingEnvelopes } = trpc.document.findOutstandingForSigner.useQuery({
    limit: 20,
  });

  const inboxCount = overview?.needsReview ?? 0;
  const acceptedCount = overview?.accepted ?? 0;
  const archivedCount = overview?.archived ?? 0;
  const totalCount = overview?.total ?? 0;
  const downloadableCount = overview?.downloadable ?? 0;
  const waitingSigCount = pendingSignatures?.count ?? 0;
  const locale = i18n.locale;

  const status =
    tab === 'all'
      ? 'all'
      : tab === 'inbox'
        ? 'all'
        : tab === 'accepted'
          ? 'accepted'
          : tab === 'archived'
            ? 'archived'
            : 'all';

  const documentsQuery = trpc.discovery.findDocuments.useInfiniteQuery(
    {
      status: status as never,
      ...(tab === 'inbox' ? { qualityFilter: 'needs-review' as const } : {}),
      query: query.trim() || undefined,
    },
    {
      enabled: tab !== 'waiting-signatures',
      getNextPageParam: (lastPage) => lastPage.nextCursor,
    },
  );
  const isLoading = documentsQuery.isLoading;

  const updateStatus = trpc.discovery.updateStatus.useMutation({
    onSuccess: () => {
      void utils.discovery.findDocuments.invalidate();
      void utils.discovery.getOverview.invalidate();
    },
  });

  const documents = useMemo(
    () => (documentsQuery.data?.pages ?? []).flatMap((page) => page.documents),
    [documentsQuery.data?.pages],
  );
  const loadedTotal =
    tab === 'inbox'
      ? inboxCount
      : tab === 'accepted'
        ? acceptedCount
        : tab === 'archived'
          ? archivedCount
          : totalCount;

  // Mixed-Items für den "Alle"-Tab: Discovery-Belege + ausstehende Envelopes,
  // sortiert chronologisch absteigend. Andere Tabs zeigen nur ihren jeweiligen
  // Datentyp.
  type MixedItem =
    | {
        kind: 'discovery';
        id: string;
        title: string;
        date: Date;
        doc: (typeof documents)[number];
      }
    | {
        kind: 'envelope';
        id: string;
        title: string;
        date: Date;
        env: NonNullable<typeof outstandingEnvelopes>['envelopes'][number];
      };

  const mixedItems: MixedItem[] = useMemo(() => {
    if (tab !== 'all') return [];
    const discoveryItems: MixedItem[] = documents.map((doc) => ({
      kind: 'discovery' as const,
      id: doc.id,
      title: doc.title,
      date: doc.documentDate ?? doc.capturedAt,
      doc,
    }));
    const envelopeItems: MixedItem[] = (outstandingEnvelopes?.envelopes ?? []).map((env) => ({
      kind: 'envelope' as const,
      id: env.id,
      title: env.title,
      date: env.sentAt ?? env.createdAt,
      env,
    }));
    const queryLower = query.trim().toLowerCase();
    const all = [...discoveryItems, ...envelopeItems];
    const filtered = queryLower
      ? all.filter((it) => {
          if (it.kind === 'envelope') {
            return it.title.toLowerCase().includes(queryLower);
          }
          return [it.doc.title, it.doc.correspondent ?? '', it.doc.detectedInvoiceNumber ?? '']
            .join(' ')
            .toLowerCase()
            .includes(queryLower);
        })
      : all;
    return filtered.sort((a, b) => b.date.getTime() - a.date.getTime());
  }, [tab, documents, outstandingEnvelopes, query]);

  const nextStepCta = useMemo(() => {
    if (inboxCount > 0) {
      return {
        title: _(msg`${inboxCount} Belege im Eingang`),
        hint: _(msg`In ca. ${Math.max(1, Math.round(inboxCount / 8))} Min durchgegangen.`),
        cta: _(msg`Eingang durchgehen`),
        href: `/t/${teamUrl}/find-documents`,
      };
    }
    if (acceptedCount > 0) {
      return {
        title: _(msg`${acceptedCount} Belege zur Ablage bereit`),
        hint: _(msg`Ein Klick und sie sind 10 Jahre lang sicher abgelegt.`),
        cta: _(msg`Im Archiv ablegen`),
        href: `/t/${teamUrl}/archiv`,
      };
    }
    if (waitingSigCount > 0) {
      return {
        title: _(msg`${waitingSigCount} Verträge warten auf Signatur`),
        hint: _(msg`Empfänger erinnern oder Status prüfen.`),
        cta: _(msg`Signatur-Status öffnen`),
        href: `/t/${teamUrl}/documents`,
      };
    }
    return {
      title: _(msg`Alles erledigt`),
      hint: _(msg`Aktuell keine offenen Aufgaben.`),
      cta: _(msg`Neuen Lauf starten`),
      href: `/t/${teamUrl}/find-documents/connect`,
    };
  }, [inboxCount, acceptedCount, waitingSigCount, teamUrl, _]);

  return (
    <div className="mx-auto w-full max-w-screen-xl space-y-6 px-4 py-6 md:px-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight md:text-3xl">
          <Trans>Dokumenten-Übersicht</Trans>
        </h1>
        <p className="text-sm text-neutral-600">
          <Trans>
            Hier sehen Sie auf einen Blick, was noch geprüft, unterschrieben, abgelegt oder bereits
            endgültig archiviert ist.
          </Trans>
        </p>
      </header>

      {/* HERO + Funnel */}
      <Card className="p-6">
        <div className="flex flex-col gap-6 md:flex-row md:items-start md:justify-between">
          <div className="flex-1">
            <div className="text-sm font-medium uppercase tracking-wide text-neutral-500">
              <Trans>Endgültig archiviert</Trans>
            </div>
            <div className="mt-1 flex items-baseline gap-3">
              <span className="text-5xl font-bold tabular-nums">{archivedCount}</span>
              <span className="text-neutral-500">
                <Trans>von {totalCount} Dokumenten</Trans>
              </span>
            </div>
            <div className="mt-6">
              <ol className="grid grid-cols-2 gap-2 text-xs md:grid-cols-4">
                <FunnelStage
                  label={<Trans>Eingang</Trans>}
                  count={inboxCount}
                  destinationLabel={<Trans>Finden</Trans>}
                  href={`/t/${teamUrl}/find-documents`}
                />
                <FunnelStage
                  label={<Trans>Wartet auf Unterschrift</Trans>}
                  count={waitingSigCount}
                  destinationLabel={<Trans>Signieren</Trans>}
                  href={`/t/${teamUrl}/documents?status=pending`}
                />
                <FunnelStage
                  label={<Trans>Im Archiv (korrigierbar)</Trans>}
                  count={acceptedCount}
                  destinationLabel={<Trans>Archiv</Trans>}
                  href={`/t/${teamUrl}/archiv`}
                />
                <FunnelStage
                  label={<Trans>Endgültig archiviert</Trans>}
                  count={archivedCount}
                  destinationLabel={<Trans>Archiv · 10 Jahre Aufbewahrung</Trans>}
                  href={`/t/${teamUrl}/archiv?tab=sealed`}
                  highlight
                />
              </ol>
            </div>
          </div>

          <aside className="md:w-80 md:border-l md:border-neutral-200 md:pl-6">
            <div className="text-sm font-medium text-neutral-700">
              <Trans>Nächster Schritt</Trans>
            </div>
            <p className="mt-1 text-sm text-neutral-600">
              {nextStepCta.title} {nextStepCta.hint && <span> — {nextStepCta.hint}</span>}
            </p>
            <Button asChild className="mt-3 w-full">
              <Link to={nextStepCta.href}>{nextStepCta.cta}</Link>
            </Button>
            <Button asChild variant="outline" className="mt-2 w-full">
              <Link to={`/t/${teamUrl}/archiv`}>
                <ReceiptTextIcon className="mr-2 h-4 w-4" aria-hidden />
                <Trans>Steuerpaket vorbereiten</Trans>
              </Link>
            </Button>
          </aside>
        </div>
      </Card>

      {/* 4 EINTRITTSPUNKTE */}
      <section>
        <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-neutral-500">
          <Trans>Womit möchten Sie arbeiten?</Trans>
        </h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <EntryTile
            icon={<FilePlus2Icon className="h-5 w-5" aria-hidden />}
            title={<Trans>Erstellen</Trans>}
            description={<Trans>Aus Vorlage: Rechnung, Vertrag, X-Rechnung, GoBD-Formular.</Trans>}
            href="/vorlagen/"
            external
          />
          <EntryTile
            icon={<MailSearchIcon className="h-5 w-5" aria-hidden />}
            title={<Trans>Im Postfach finden</Trans>}
            description={
              <Trans>Belege automatisch aus IMAP / Cloud ziehen — ein Klick pro Mail.</Trans>
            }
            href={`/t/${teamUrl}/find-documents/connect`}
          />
          <EntryTile
            icon={<UploadIcon className="h-5 w-5" aria-hidden />}
            title={<Trans>Hochladen</Trans>}
            description={<Trans>PDF, DOCX, Bild — direkt aus dem Datei-Explorer.</Trans>}
            href="/vorlagen/"
            external
          />
          <EntryTile
            icon={<InboxIcon className="h-5 w-5" aria-hidden />}
            title={<Trans>Bereits gefunden</Trans>}
            description={
              <Trans>
                {inboxCount} Belege liegen im Eingang — prüfen, übernehmen oder ignorieren.
              </Trans>
            }
            href={`/t/${teamUrl}/find-documents`}
            badge={inboxCount > 0 ? inboxCount : undefined}
          />
        </div>
      </section>

      {/* FILTER + LISTE */}
      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">
            <Trans>Alle Dokumente</Trans>
          </h2>
          <Input
            type="search"
            placeholder={_(msg`Nach Titel, Korrespondent, Rechnungs-Nr. suchen`)}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="md:max-w-md"
          />
        </div>

        <div className="flex flex-wrap items-center gap-1 border-b border-neutral-200">
          <TabButton active={tab === 'all'} onClick={() => setTab('all')}>
            <Trans>Alle</Trans> <span className="ml-1 text-neutral-400">{totalCount}</span>
          </TabButton>
          <TabButton active={tab === 'inbox'} onClick={() => setTab('inbox')}>
            <Trans>Eingang</Trans> <span className="ml-1 text-neutral-400">{inboxCount}</span>
          </TabButton>
          <TabButton
            active={tab === 'waiting-signatures'}
            onClick={() => setTab('waiting-signatures')}
          >
            <Trans>Wartet auf Unterschrift</Trans>{' '}
            <span className="ml-1 text-neutral-400">{waitingSigCount}</span>
          </TabButton>
          <TabButton active={tab === 'accepted'} onClick={() => setTab('accepted')}>
            <Trans>Im Archiv (noch korrigierbar)</Trans>{' '}
            <span className="ml-1 text-neutral-400">{acceptedCount}</span>
          </TabButton>
          <TabButton active={tab === 'archived'} onClick={() => setTab('archived')}>
            <Trans>Endgültig archiviert</Trans>{' '}
            <span className="ml-1 text-neutral-400">{archivedCount}</span>
          </TabButton>
        </div>

        {tab === 'waiting-signatures' ? (
          (outstandingEnvelopes?.envelopes ?? []).length === 0 ? (
            <Card className="px-6 py-12 text-center text-sm text-neutral-500">
              <Trans>Keine Verträge warten gerade auf eine Unterschrift.</Trans>
            </Card>
          ) : (
            <ul className="space-y-2">
              {(outstandingEnvelopes?.envelopes ?? []).map((env) => (
                <li
                  key={env.id}
                  className="flex items-start gap-3 rounded-md border border-neutral-200 bg-white p-4 shadow-sm"
                >
                  <PenLineIcon
                    className="mt-1 h-4 w-4 shrink-0 text-muted-foreground"
                    aria-hidden
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-2">
                      <Badge variant="neutral" className="text-[10px] uppercase">
                        <Trans>Wartet auf Unterschrift</Trans>
                      </Badge>
                      <Link
                        to={`/t/${teamUrl}/documents/${env.id}`}
                        className="truncate font-medium hover:underline"
                      >
                        {env.title}
                      </Link>
                    </div>
                    <div className="mt-1 text-xs text-neutral-500">
                      <Trans>
                        Verschickt am {formatDate(env.sentAt ?? env.createdAt, i18n.locale)} ·{' '}
                        {env.signedRecipients} von {env.totalRecipients} Empfängern unterschrieben
                      </Trans>
                    </div>
                    <LifecycleDots status="waiting-signatures" />
                  </div>
                  <div className="flex items-center gap-2">
                    {env.hasReminderEligible ? (
                      <Button asChild size="sm">
                        <Link to={`/t/${teamUrl}/documents/${env.id}`}>
                          <Trans>Erinnerung senden</Trans>
                        </Link>
                      </Button>
                    ) : (
                      <Button asChild size="sm" variant="outline">
                        <Link to={`/t/${teamUrl}/documents/${env.id}`}>
                          <Trans>Status sehen</Trans>
                        </Link>
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )
        ) : isLoading ? (
          <Card className="flex items-center justify-center py-12 text-neutral-500">
            <Loader2Icon className="mr-2 h-4 w-4 animate-spin" aria-hidden />
            <Trans>Lädt…</Trans>
          </Card>
        ) : tab === 'all' ? (
          /* "Alle"-Tab: Discovery-Belege + Envelopes gemischt, sortiert nach Datum. */
          mixedItems.length === 0 ? (
            <Card className="px-6 py-12 text-center text-sm text-neutral-500">
              <Trans>Keine Dokumente in dieser Sicht.</Trans>
            </Card>
          ) : (
            <>
              <ul className="space-y-2">
                {mixedItems.map((item) => {
                  if (item.kind === 'envelope') {
                    const env = item.env;
                    return (
                      <li
                        key={`env-${env.id}`}
                        className="flex items-start gap-3 rounded-md border border-neutral-200 bg-white p-4 shadow-sm"
                      >
                        <PenLineIcon
                          className="mt-1 h-4 w-4 shrink-0 text-muted-foreground"
                          aria-hidden
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-baseline gap-2">
                            <Badge variant="neutral" className="text-[10px] uppercase">
                              <Trans>Wartet auf Unterschrift</Trans>
                            </Badge>
                            <Link
                              to={`/t/${teamUrl}/documents/${env.id}`}
                              className="truncate font-medium hover:underline"
                            >
                              {env.title}
                            </Link>
                          </div>
                          <div className="mt-1 text-xs text-neutral-500">
                            <Trans>
                              Verschickt am {formatDate(env.sentAt ?? env.createdAt, i18n.locale)} ·{' '}
                              {env.signedRecipients} von {env.totalRecipients} Empfängern
                              unterschrieben
                            </Trans>
                          </div>
                          <LifecycleDots status="waiting-signatures" />
                        </div>
                        <div className="flex items-center gap-2">
                          {env.hasReminderEligible ? (
                            <Button asChild size="sm">
                              <Link to={`/t/${teamUrl}/documents/${env.id}`}>
                                <Trans>Erinnerung senden</Trans>
                              </Link>
                            </Button>
                          ) : (
                            <Button asChild size="sm" variant="outline">
                              <Link to={`/t/${teamUrl}/documents/${env.id}`}>
                                <Trans>Status sehen</Trans>
                              </Link>
                            </Button>
                          )}
                        </div>
                      </li>
                    );
                  }
                  const doc = item.doc;
                  return (
                    <li
                      key={`doc-${doc.id}`}
                      className="flex items-start gap-3 rounded-md border border-neutral-200 bg-white p-4 shadow-sm"
                    >
                      <FileTextIcon
                        className="mt-1 h-4 w-4 shrink-0 text-muted-foreground"
                        aria-hidden
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-baseline gap-2">
                          <Badge variant="neutral" className="text-[10px] uppercase">
                            {statusLabel(doc.status)}
                          </Badge>
                          <Link
                            to={`/t/${teamUrl}/find-documents/${doc.id}`}
                            className="truncate font-medium hover:underline"
                          >
                            {doc.title}
                          </Link>
                        </div>
                        <div className="mt-1 text-xs text-neutral-500">
                          {doc.correspondent && <>{doc.correspondent} · </>}
                          {formatDate(doc.documentDate ?? doc.capturedAt, i18n.locale)}
                          {doc.detectedAmount && <> · {doc.detectedAmount}</>}
                        </div>
                        <LifecycleDots status={doc.status} />
                      </div>
                      <div className="flex items-center gap-2">
                        {(doc.status === 'inbox' || doc.status === 'pending-manual') && (
                          <Button
                            size="sm"
                            onClick={() => updateStatus.mutate({ id: doc.id, action: 'accept' })}
                            disabled={updateStatus.isPending}
                          >
                            <ArchiveIcon className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                            <Trans>Ins Archiv</Trans>
                          </Button>
                        )}
                        {doc.status === 'accepted' && (
                          <AcceptDiscoveryDocumentButton
                            size="sm"
                            disabled={updateStatus.isPending}
                            onConfirm={() => updateStatus.mutate({ id: doc.id, action: 'archive' })}
                            label={<Trans>Endgültig archivieren</Trans>}
                          />
                        )}
                        {doc.status === 'archived' && (
                          <Badge variant="secondary" className="gap-1.5 text-xs">
                            <LockIcon className="h-3 w-3" aria-hidden />
                            <Trans>10 Jahre Aufbewahrung</Trans>
                          </Badge>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
              {documentsQuery.hasNextPage && (
                <div className="flex flex-col items-center gap-3 pt-2">
                  <div className="text-xs text-neutral-500">
                    <Trans>
                      {documents.length} von {totalCount} Discovery-Belegen geladen
                    </Trans>
                  </div>
                  <Button
                    variant="outline"
                    onClick={() => void documentsQuery.fetchNextPage()}
                    disabled={documentsQuery.isFetchingNextPage}
                  >
                    {documentsQuery.isFetchingNextPage ? (
                      <Loader2Icon className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                    ) : null}
                    <Trans>Weitere laden</Trans>
                  </Button>
                </div>
              )}
            </>
          )
        ) : documents.length === 0 ? (
          <Card className="px-6 py-12 text-center text-sm text-neutral-500">
            <Trans>Keine Dokumente in dieser Sicht.</Trans>
          </Card>
        ) : (
          <>
            <ul className="space-y-2">
              {documents.map((doc) => (
                <li
                  key={doc.id}
                  className="flex items-start gap-3 rounded-md border border-neutral-200 bg-white p-4 shadow-sm"
                >
                  <FileTextIcon
                    className="mt-1 h-4 w-4 shrink-0 text-muted-foreground"
                    aria-hidden
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-2">
                      <Badge variant="neutral" className="text-[10px] uppercase">
                        {statusLabel(doc.status)}
                      </Badge>
                      <Link
                        to={`/t/${teamUrl}/find-documents/${doc.id}`}
                        className="truncate font-medium hover:underline"
                      >
                        {doc.title}
                      </Link>
                    </div>
                    <div className="mt-1 text-xs text-neutral-500">
                      {doc.correspondent && <>{doc.correspondent} · </>}
                      {formatDate(doc.documentDate ?? doc.capturedAt, i18n.locale)}
                      {doc.detectedAmount && <> · {doc.detectedAmount}</>}
                    </div>
                    <LifecycleDots status={doc.status} />
                  </div>
                  <div className="flex items-center gap-2">
                    {(doc.status === 'inbox' || doc.status === 'pending-manual') && (
                      <Button
                        size="sm"
                        onClick={() => updateStatus.mutate({ id: doc.id, action: 'accept' })}
                        disabled={updateStatus.isPending}
                      >
                        <ArchiveIcon className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                        <Trans>Ins Archiv</Trans>
                      </Button>
                    )}
                    {doc.status === 'accepted' && (
                      <AcceptDiscoveryDocumentButton
                        size="sm"
                        disabled={updateStatus.isPending}
                        onConfirm={() => updateStatus.mutate({ id: doc.id, action: 'archive' })}
                        label={<Trans>Endgültig archivieren</Trans>}
                      />
                    )}
                    {doc.status === 'archived' && (
                      <Badge variant="secondary" className="gap-1.5 text-xs">
                        <LockIcon className="h-3 w-3" aria-hidden />
                        <Trans>10 Jahre Aufbewahrung</Trans>
                      </Badge>
                    )}
                  </div>
                </li>
              ))}
            </ul>
            {(documentsQuery.hasNextPage || documents.length < loadedTotal) && (
              <div className="flex flex-col items-center gap-3 pt-2">
                <div className="text-xs text-neutral-500">
                  <Trans>
                    {documents.length} von {loadedTotal} geladen
                  </Trans>
                </div>
                {documentsQuery.hasNextPage && (
                  <Button
                    variant="outline"
                    onClick={() => void documentsQuery.fetchNextPage()}
                    disabled={documentsQuery.isFetchingNextPage}
                  >
                    {documentsQuery.isFetchingNextPage ? (
                      <Loader2Icon className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                    ) : null}
                    <Trans>Weitere laden</Trans>
                  </Button>
                )}
              </div>
            )}
          </>
        )}
      </section>

      {/* Korrespondenten-Uebersicht — „wer hat mir Belege geschickt" inkl.
          Aufschluesselung mit/ohne PDF. Wer auf eine Zeile klickt, landet
          in der Trefferliste mit gesetztem ?correspondent=…-Filter und
          arbeitet alle Belege dieses Senders am Stueck ab. Identische Card
          wird in der Trefferliste angezogen — die ist die primaere Anlauf-
          stelle, der Hub das Aggregat. */}
      <CorrespondentSummaryCard teamUrl={teamUrl} />

      {/* Steuerpaket-Export — sichtbar sobald Belege mit Anhang im Archiv
          oder endgültig archiviert wurden. Nutzt den fertigen tax-package-Endpoint, der
          gefilterte ZIPs streamt. Status=processed schließt INBOX/IGNORED aus. */}
      {downloadableCount > 0 && (
        <Card className="flex flex-wrap items-center justify-between gap-3 border-primary/30 bg-primary/5 p-4">
          <div className="min-w-0">
            <p className="text-sm font-semibold">
              <Trans>{downloadableCount} Belege mit Anhang bereit für Steuerpaket</Trans>
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              <Trans>
                ZIP für Ihren Steuerberater — alle Belege aus dem Archiv und der endgültigen Ablage
                mit Original-Anhängen, Filter-Übersicht und CSV.
              </Trans>
            </p>
          </div>
          <TaxPackageConfirmButton
            href={`/t/${teamUrl}/find-documents/tax-package?status=processed`}
            totalCount={acceptedCount + archivedCount}
            downloadableCount={downloadableCount}
            rangeFrom={null}
            rangeTo={null}
            locale={locale}
          />
        </Card>
      )}
    </div>
  );
}

const FunnelStage = ({
  label,
  count,
  destinationLabel,
  href,
  highlight,
}: {
  label: React.ReactNode;
  count: number;
  destinationLabel: React.ReactNode;
  href: string;
  highlight?: boolean;
}) => (
  <li>
    <Link
      to={href}
      className={`block rounded-md border p-3 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
        highlight
          ? 'border-neutral-900 bg-neutral-900 text-white hover:bg-neutral-800'
          : 'border-neutral-200 bg-neutral-50 hover:border-neutral-400'
      }`}
    >
      <div className={`font-medium ${highlight ? '' : 'text-neutral-700'}`}>{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{count}</div>
      <div className={`text-xs ${highlight ? 'text-neutral-300' : 'text-neutral-500'}`}>
        in <span className="underline underline-offset-2">{destinationLabel}</span>
      </div>
    </Link>
  </li>
);

const EntryTile = ({
  icon,
  title,
  description,
  href,
  external,
  badge,
}: {
  icon: React.ReactNode;
  title: React.ReactNode;
  description: React.ReactNode;
  href: string;
  external?: boolean;
  badge?: number;
}) => {
  const className =
    'group flex flex-col items-start gap-2 rounded-lg border border-neutral-200 bg-white p-5 text-left shadow-sm transition-all hover:border-neutral-400 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
  const inner = (
    <>
      <div className="flex w-full items-start justify-between">
        <div className="flex h-10 w-10 items-center justify-center rounded-md border border-neutral-300 bg-neutral-50 text-neutral-500">
          {icon}
        </div>
        {badge !== undefined && badge > 0 && (
          <span className="rounded-full bg-neutral-900 px-2 py-0.5 text-xs font-semibold tabular-nums text-white">
            {badge}
          </span>
        )}
      </div>
      <div className="font-semibold">{title}</div>
      <div className="text-sm text-neutral-600">{description}</div>
    </>
  );
  if (external) {
    return (
      <a href={href} className={className}>
        {inner}
      </a>
    );
  }
  return (
    <Link to={href} className={className}>
      {inner}
    </Link>
  );
};

const TabButton = ({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) => (
  <button
    onClick={onClick}
    className={`border-b-2 px-3 py-2 text-sm transition-colors ${
      active
        ? 'border-neutral-900 font-semibold text-neutral-900'
        : 'border-transparent text-neutral-600 hover:text-neutral-900'
    }`}
  >
    {children}
  </button>
);

const statusLabel = (status: string): React.ReactNode => {
  switch (status) {
    case 'inbox':
      return <Trans>Eingang</Trans>;
    case 'pending-manual':
      return <Trans>Mail ohne Anhang</Trans>;
    case 'accepted':
      return <Trans>Im Archiv (noch korrigierbar)</Trans>;
    case 'archived':
      return <Trans>Endgültig archiviert</Trans>;
    case 'ignored':
      return <Trans>Ignoriert</Trans>;
    case 'signed':
      return <Trans>Unterschrieben</Trans>;
    default:
      return status;
  }
};
