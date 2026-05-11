// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 NexaStack, NexaSign contributors
import { useEffect, useState } from 'react';

import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react';
import { Trans } from '@lingui/react/macro';
import {
  AlertCircleIcon,
  ArchiveIcon,
  ArrowLeftIcon,
  ClockIcon,
  DownloadIcon,
  ExternalLinkIcon,
  FileTextIcon,
  HashIcon,
  Loader2Icon,
  LockIcon,
  MailIcon,
  PaperclipIcon,
  PenLineIcon,
  RefreshCwIcon,
} from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router';

import { trpc } from '@nexasign/trpc/react';
import type {
  TDiscoveryArtifact,
  TDiscoveryDocumentAction,
} from '@nexasign/trpc/server/discovery-router/schema';
import { Badge } from '@nexasign/ui/primitives/badge';
import { Button } from '@nexasign/ui/primitives/button';
import { Card } from '@nexasign/ui/primitives/card';
import { Input } from '@nexasign/ui/primitives/input';
import { Skeleton } from '@nexasign/ui/primitives/skeleton';
import { useToast } from '@nexasign/ui/primitives/use-toast';

import { AcceptDiscoveryDocumentButton } from '~/components/dialogs/accept-discovery-document-button';
import { Illustration } from '~/components/general/illustration';
import { appMetaTags } from '~/utils/meta';

export function meta() {
  return appMetaTags(msg`Beleg-Detail`);
}

const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const formatDate = (date: Date | null, locale: string): string => {
  if (!date) return '–';
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'long',
    timeStyle: 'short',
  }).format(date);
};

/**
 * Inline-Edit für ein erkanntes Feld. Read-Only solange Beleg `isArchived`
 * (WORM-Lock ab archivedAt — Server würde die Mutation eh ablehnen). Vor der
 * rechtssicheren Archivierung sind Felder voll editierbar, auch nach dem
 * "Ins Archiv"-Klick. Speichern auf Enter oder Blur, Abbrechen mit Escape.
 * Persona-Nutzen: Heuristik-Fehler (Netto statt Brutto, abgekürzte Korresponden-
 * ten) lassen sich noch korrigieren — die spätere CSV ist dann belastbar.
 */
const EditableDetectedField = ({
  value,
  onSave,
  disabled,
  placeholder,
  monospace,
  ariaLabel,
}: {
  value: string | null;
  onSave: (next: string | null) => Promise<void> | void;
  disabled: boolean;
  placeholder: string;
  monospace?: boolean;
  ariaLabel: string;
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? '');

  useEffect(() => {
    if (!isEditing) setDraft(value ?? '');
  }, [value, isEditing]);

  const commit = async () => {
    const trimmed = draft.trim();
    const next = trimmed === '' ? null : trimmed;
    if (next === value) {
      setIsEditing(false);
      return;
    }
    await onSave(next);
    setIsEditing(false);
  };

  if (disabled || !isEditing) {
    const display = value ?? '–';
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={() => setIsEditing(true)}
        className={`group flex w-full items-baseline gap-2 rounded text-left ${
          disabled ? 'cursor-default' : 'hover:text-foreground'
        }`}
        aria-label={ariaLabel}
      >
        <span
          className={`font-medium ${monospace ? 'font-mono text-sm' : ''} ${
            value ? '' : 'text-muted-foreground'
          }`}
        >
          {display}
        </span>
        {!disabled && (
          <PenLineIcon
            className="h-3 w-3 flex-shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
            aria-hidden
          />
        )}
      </button>
    );
  }

  return (
    <Input
      autoFocus
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => void commit()}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          void commit();
        }
        if (e.key === 'Escape') {
          setDraft(value ?? '');
          setIsEditing(false);
        }
      }}
      placeholder={placeholder}
      className={`h-8 ${monospace ? 'font-mono text-sm' : ''}`}
      aria-label={ariaLabel}
    />
  );
};

const ArtifactRow = ({ artifact }: { artifact: TDiscoveryArtifact }) => {
  const Icon = artifact.kind === 'ATTACHMENT' ? PaperclipIcon : FileTextIcon;
  return (
    <div className="flex items-start gap-3 rounded-md border bg-muted/30 p-3 text-sm">
      <Icon className="mt-0.5 h-4 w-4 flex-shrink-0 text-muted-foreground" aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <p className="font-medium">{artifact.fileName}</p>
          <p className="text-xs text-muted-foreground">
            {formatBytes(artifact.fileSize)} · {artifact.contentType}
          </p>
        </div>
        <p className="mt-1 flex items-center gap-1.5 break-all font-mono text-xs leading-relaxed text-muted-foreground">
          <HashIcon className="h-3 w-3 flex-shrink-0" aria-hidden />
          {artifact.sha256}
        </p>
      </div>
      <Button asChild variant="ghost" size="sm" className="h-8 flex-shrink-0 px-2">
        <a href={`artifacts/${artifact.id}`} download>
          <DownloadIcon className="mr-1.5 h-3.5 w-3.5" aria-hidden />
          <Trans>Laden</Trans>
        </a>
      </Button>
    </div>
  );
};

export default function FindDocumentsDetail() {
  const params = useParams();
  const id = params.id ?? '';
  const teamUrl = params.teamUrl ?? '';
  const navigate = useNavigate();
  const { _, i18n } = useLingui();
  const { toast } = useToast();

  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.discovery.getDocumentDetail.useQuery({ id });

  const updateStatusMutation = trpc.discovery.updateStatus.useMutation({
    onSuccess: () => {
      void utils.discovery.findDocuments.invalidate();
      void utils.discovery.getDocumentDetail.invalidate({ id });
      toast({ title: _(msg`Aktion ausgeführt`) });
    },
    onError: (err) => {
      toast({
        title: _(msg`Aktion fehlgeschlagen`),
        description: err.message,
        variant: 'destructive',
      });
    },
  });

  const handleAction = (action: TDiscoveryDocumentAction) => {
    updateStatusMutation.mutate({ id, action });
  };

  // Re-Sync einer einzelnen Mail aus IMAP — laedt das Archive nach, falls es
  // beim Erst-Sync noch keine Archive-Funktion gab oder Files verloren gingen.
  const resyncMutation = trpc.discovery.resyncSingle.useMutation({
    onSuccess: (result) => {
      if (result.ok) {
        toast({
          title: _(msg`Mail erneut aus IMAP geladen`),
          description: _(msg`${result.attachmentsAdded} Anhang/Anhänge wieder verfügbar.`),
        });
        void utils.discovery.getDocumentDetail.invalidate({ id });
        void utils.discovery.findDocuments.invalidate();
      } else {
        toast({
          title: _(msg`Re-Sync fehlgeschlagen`),
          description: result.reason,
          variant: 'destructive',
        });
      }
    },
    onError: (err) => {
      toast({
        title: _(msg`Re-Sync fehlgeschlagen`),
        description: err.message,
        variant: 'destructive',
      });
    },
  });

  const updateDetectedFieldsMutation = trpc.discovery.updateDetectedFields.useMutation({
    onSuccess: () => {
      void utils.discovery.getDocumentDetail.invalidate({ id });
      void utils.discovery.findDocuments.invalidate();
    },
    onError: (err) => {
      toast({
        title: _(msg`Korrektur fehlgeschlagen`),
        description: err.message,
        variant: 'destructive',
      });
    },
  });

  const createSigningDocumentMutation = trpc.discovery.createSigningDocument.useMutation({
    onSuccess: (result) => {
      void utils.discovery.getDocumentDetail.invalidate({ id });
      void utils.discovery.findDocuments.invalidate();
      toast({
        title: result.alreadyExisted
          ? _(msg`Signatur-Dokument geöffnet`)
          : _(msg`Signatur-Dokument vorbereitet`),
      });
      void navigate(`/t/${teamUrl}/documents/${result.envelopeId}/edit`);
    },
    onError: (err) => {
      toast({
        title: _(msg`Signatur-Dokument konnte nicht vorbereitet werden`),
        description: err.message,
        variant: 'destructive',
      });
    },
  });

  // Queue-Bilanz: alle Belege im Eingang holen, aktuellen Index bestimmen,
  // Vorgänger/Nachfolger ableiten. MUSS vor early-returns stehen (Rules of Hooks).
  const { data: queueData } = trpc.discovery.findDocuments.useQuery({
    status: 'all',
    qualityFilter: 'needs-review',
  });

  const currentDoc = data?.document ?? null;
  const queueDocs = queueData?.documents ?? [];
  const queueIndex = queueDocs.findIndex((d) => d.id === id);
  const queueTotal = queueDocs.length;
  const prevDoc = queueIndex > 0 ? queueDocs[queueIndex - 1] : null;
  const nextDoc = queueIndex >= 0 && queueIndex < queueTotal - 1 ? queueDocs[queueIndex + 1] : null;
  const isInQueue = queueIndex >= 0;

  useEffect(() => {
    if (!currentDoc) return;

    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target instanceof HTMLElement ? event.target : null;
      const inEditable =
        target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable;
      if (inEditable) {
        if (event.key === 'Escape') target?.blur();
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      const canDecide =
        !currentDoc.archivedAt &&
        !currentDoc.acceptedAt &&
        (currentDoc.status === 'inbox' || currentDoc.status === 'pending-manual');

      if ((event.key === 'a' || event.key === 'A') && canDecide) {
        event.preventDefault();
        updateStatusMutation.mutate({ id, action: 'accept' });
        return;
      }
      if (event.key === 'i' || event.key === 'I') {
        if (canDecide && currentDoc.status === 'inbox') {
          event.preventDefault();
          updateStatusMutation.mutate({ id, action: 'ignore' });
        }
        return;
      }
      if (event.key === 'u' || event.key === 'U') {
        if (canDecide && currentDoc.status === 'inbox') {
          event.preventDefault();
          updateStatusMutation.mutate({ id, action: 'mark-pending-manual' });
        }
        return;
      }
      if (event.key === 'ArrowRight' && nextDoc) {
        event.preventDefault();
        void navigate(`../${nextDoc.id}`);
        return;
      }
      if (event.key === 'ArrowLeft' && prevDoc) {
        event.preventDefault();
        void navigate(`../${prevDoc.id}`);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [currentDoc, id, navigate, nextDoc, prevDoc, updateStatusMutation]);

  if (isLoading) {
    return (
      <div className="mx-auto w-full max-w-screen-lg px-4 py-8 md:px-8">
        <Skeleton className="mb-4 h-8 w-40" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="mx-auto w-full max-w-screen-lg px-4 py-8 md:px-8">
        <Card className="flex flex-col items-center gap-3 p-12 text-center">
          <AlertCircleIcon className="h-10 w-10 text-muted-foreground" aria-hidden />
          <h2 className="text-lg font-semibold">
            <Trans>Beleg nicht gefunden</Trans>
          </h2>
          <Button asChild variant="outline" onClick={async () => navigate(-1)}>
            <span>
              <ArrowLeftIcon className="mr-2 h-4 w-4" aria-hidden />
              <Trans>Zurück</Trans>
            </span>
          </Button>
        </Card>
      </div>
    );
  }

  const { document: doc, artifacts, absoluteArchivePath, gmailDeepLink } = data;
  const isAccepted = Boolean(doc.acceptedAt);
  const isArchived = Boolean(doc.archivedAt);
  const isPending = updateStatusMutation.isPending;

  // PDF-Preview-Quelle für die Vorschau-Spalte. Erstes PDF-Anhang-Artifact wird
  // genommen — die Mehrzahl der Belege hat genau eines, mehrere PDFs sind die
  // Ausnahme (auch dann reicht eines als Preview).
  const pdfArtifact = artifacts.find(
    (a) =>
      a.kind === 'ATTACHMENT' &&
      (a.contentType === 'application/pdf' || a.fileName.toLowerCase().endsWith('.pdf')),
  );
  const pdfPreviewSrc = pdfArtifact ? `artifacts/${pdfArtifact.id}` : null;

  return (
    <>
      {/* KONTEXT-BREADCRUMB — sticky oben, klarer Rückweg zur Liste. */}
      <div className="sticky top-0 z-10 border-b border-neutral-200 bg-white">
        <div className="mx-auto flex max-w-screen-xl items-center justify-between gap-3 px-4 py-2 text-sm md:px-6">
          <Link
            to=".."
            className="flex items-center gap-1.5 font-medium text-neutral-700 hover:text-neutral-900"
          >
            <ArrowLeftIcon className="h-4 w-4" aria-hidden />
            <Trans>Zurück zur Treffer-Liste</Trans>
          </Link>
          <span className="hidden text-xs text-neutral-500 sm:inline">
            <Trans>Beleg-Detail · Tipp: A Archiv · I Ignorieren · → Nächster</Trans>
          </span>
        </div>
      </div>

      <div className="mx-auto w-full max-w-screen-xl space-y-5 px-4 py-6 md:px-6">
        {/* QUEUE-BILANZ — wenn der Beleg noch im Eingang ist: zeigt Position +
            Fortschritt im Durchgang. */}
        {isInQueue && queueTotal > 0 && (
          <section className="rounded-md border border-neutral-200 bg-white p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-sm font-medium">
                  <Trans>{queueTotal} Belege im Eingang</Trans>
                </div>
                <div className="mt-0.5 text-xs text-neutral-500">
                  <Trans>
                    Sie gehen sie einen nach dem anderen durch. Pro Beleg ein Klick: ins Archiv oder
                    ignorieren.
                  </Trans>
                </div>
              </div>
              <div className="flex items-center gap-3 text-sm tabular-nums text-neutral-700">
                <strong>
                  <Trans>
                    {queueIndex + 1} von {queueTotal}
                  </Trans>
                </strong>
              </div>
            </div>
            <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-neutral-100">
              <div
                className="h-full bg-neutral-900 transition-all"
                style={{ width: `${Math.round(((queueIndex + 1) / queueTotal) * 100)}%` }}
              />
            </div>
          </section>
        )}

        {/* HAUPT-BEREICH: links PDF-Vorschau, rechts Felder + Aktionen. */}
        <section className="grid grid-cols-1 gap-6 lg:grid-cols-[1.4fr_1fr]">
          {/* PDF-Vorschau */}
          <div className="rounded-lg border border-neutral-200 bg-white p-2 shadow-sm">
            {pdfPreviewSrc ? (
              <iframe
                title={`PDF-Vorschau: ${doc.title}`}
                src={pdfPreviewSrc}
                className="aspect-[1/1.3] w-full rounded-md border border-neutral-100"
              />
            ) : (
              <div className="flex aspect-[1/1.3] flex-col items-center justify-center gap-3 rounded-md bg-neutral-50 px-6 text-center text-sm text-neutral-500">
                <Illustration
                  name="no-pdf-preview"
                  alt="Keine PDF-Vorschau verfügbar"
                  tone="neutral"
                  className="h-24 w-32"
                />
                <Trans>Keine PDF-Vorschau verfügbar</Trans>
                {doc.bodyText && (
                  <pre className="mt-3 max-h-48 w-full overflow-auto whitespace-pre-wrap break-words rounded bg-white p-3 text-left text-xs leading-relaxed text-neutral-600">
                    {doc.bodyText.slice(0, 600)}
                    {doc.bodyText.length > 600 && '…'}
                  </pre>
                )}
              </div>
            )}
          </div>

          {/* Rechte Spalte: Header + Felder + Aktionen. */}
          <div className="space-y-5">
            <div>
              <div className="text-xs uppercase tracking-wide text-neutral-500">
                {doc.providerSource === 'imap' ? (
                  <Trans>Aus dem Postfach</Trans>
                ) : (
                  <Trans>Hochgeladener Beleg</Trans>
                )}
              </div>
              <h1 className="mt-1 break-words text-xl font-semibold leading-tight md:text-2xl">
                {doc.title}
              </h1>
              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm text-neutral-500">
                <span>
                  <Trans>
                    Empfangen am {formatDate(doc.documentDate ?? doc.capturedAt, i18n.locale)}
                  </Trans>
                </span>
                {doc.sourceLabel && (
                  <span className="inline-flex items-center gap-1">
                    · <MailIcon className="h-3.5 w-3.5" aria-hidden />
                    {doc.sourceLabel}
                  </span>
                )}
                {pdfArtifact && (
                  <span className="inline-flex items-center gap-1">
                    · <PaperclipIcon className="h-3.5 w-3.5" aria-hidden />
                    {pdfArtifact.fileName}
                  </span>
                )}
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {isArchived && (
                  <Badge variant="secondary" className="gap-1.5">
                    <LockIcon className="h-3 w-3" aria-hidden />
                    <Trans>Endgültig archiviert · 10 Jahre Aufbewahrung</Trans>
                  </Badge>
                )}
                {isAccepted && !isArchived && (
                  <Badge variant="neutral" className="gap-1.5">
                    <ArchiveIcon className="h-3 w-3" aria-hidden />
                    <Trans>Im Archiv (noch korrigierbar)</Trans>
                  </Badge>
                )}
              </div>
            </div>

            {/* "Was haben wir erkannt?"-Form — direkt sichtbar, nicht versteckt. */}
            <Card className="space-y-3 p-4">
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
                  <Trans>Was haben wir erkannt?</Trans>
                </div>
                <div className="text-xs text-neutral-500">
                  {isArchived ? (
                    <Trans>
                      Beleg ist endgültig archiviert. Felder können nicht mehr geändert werden.
                    </Trans>
                  ) : (
                    <Trans>
                      Automatisch aus der Mail ausgelesen — bei Bedarf hier korrigieren.
                    </Trans>
                  )}
                </div>
              </div>

              <label className="block">
                <span className="text-xs text-neutral-500">
                  <Trans>Korrespondent</Trans>
                </span>
                <div className="mt-0.5">
                  <EditableDetectedField
                    value={doc.correspondent}
                    disabled={isArchived || updateDetectedFieldsMutation.isPending}
                    placeholder="z. B. Hetzner Online GmbH"
                    ariaLabel="Korrespondent bearbeiten"
                    onSave={async (next) => {
                      await updateDetectedFieldsMutation.mutateAsync({
                        id,
                        correspondent: next,
                      });
                    }}
                  />
                </div>
              </label>

              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-xs text-neutral-500">
                    <Trans>Datum</Trans>
                  </span>
                  <div className="mt-0.5 rounded-md border border-neutral-200 bg-neutral-50 px-3 py-1.5 text-sm">
                    {formatDate(doc.documentDate ?? doc.capturedAt, i18n.locale)}
                  </div>
                </label>
                <label className="block">
                  <span className="text-xs text-neutral-500">
                    <Trans>Betrag</Trans>
                  </span>
                  <div className="mt-0.5">
                    <EditableDetectedField
                      value={doc.detectedAmount}
                      disabled={isArchived || updateDetectedFieldsMutation.isPending}
                      placeholder="z. B. 89,90 €"
                      ariaLabel="Rechnungsbetrag bearbeiten"
                      onSave={async (next) => {
                        await updateDetectedFieldsMutation.mutateAsync({
                          id,
                          detectedAmount: next,
                        });
                      }}
                    />
                  </div>
                </label>
              </div>

              <label className="block">
                <span className="text-xs text-neutral-500">
                  <Trans>Rechnungsnummer</Trans>
                </span>
                <div className="mt-0.5">
                  <EditableDetectedField
                    value={doc.detectedInvoiceNumber}
                    disabled={isArchived || updateDetectedFieldsMutation.isPending}
                    placeholder="z. B. RE-2024-0817"
                    monospace
                    ariaLabel="Rechnungsnummer bearbeiten"
                    onSave={async (next) => {
                      await updateDetectedFieldsMutation.mutateAsync({
                        id,
                        detectedInvoiceNumber: next,
                      });
                    }}
                  />
                </div>
              </label>

              {doc.portalHint && (
                <div className="border-t pt-3">
                  <p className="text-xs uppercase tracking-wide text-neutral-500">
                    <Trans>Beleg liegt im Kunden-Portal</Trans>
                  </p>
                  <p className="mt-1 text-sm">
                    <span className="italic text-neutral-600">„{doc.portalHint}"</span>
                  </p>
                  {doc.portalUrl && doc.portalUrlLabel && (
                    <Button asChild variant="outline" size="sm" className="mt-2">
                      <a href={doc.portalUrl} target="_blank" rel="noreferrer noopener">
                        <ExternalLinkIcon className="mr-2 h-3.5 w-3.5" aria-hidden />
                        <Trans>{doc.portalUrlLabel} öffnen</Trans>
                      </a>
                    </Button>
                  )}
                </div>
              )}
            </Card>

            {/* DREI HAUPT-AKTIONEN — vertikal, full-width. */}
            {!isAccepted && (doc.status === 'inbox' || doc.status === 'pending-manual') && (
              <div className="space-y-2">
                <Button
                  className="w-full bg-emerald-600 text-white hover:bg-emerald-700"
                  onClick={() => handleAction('accept')}
                  disabled={isPending}
                >
                  <span className="mr-2 text-xl leading-none">✓</span>
                  <Trans>Ins Archiv — ist ein Beleg</Trans>
                </Button>
                {doc.status === 'inbox' && (
                  <>
                    <Button
                      variant="outline"
                      className="w-full"
                      onClick={() => handleAction('ignore')}
                      disabled={isPending}
                    >
                      <span className="mr-2 text-xl leading-none">✕</span>
                      <Trans>Ignorieren — keine echte Rechnung</Trans>
                    </Button>
                    <Button
                      variant="outline"
                      className="w-full border-amber-200 bg-amber-50 text-amber-900 hover:bg-amber-100"
                      onClick={() => handleAction('mark-pending-manual')}
                      disabled={isPending}
                    >
                      <ClockIcon className="mr-2 h-4 w-4" aria-hidden />
                      <Trans>Später entscheiden — überspringen</Trans>
                    </Button>
                  </>
                )}
              </div>
            )}

            {isAccepted && !isArchived && doc.status !== 'processed' && (
              <div className="space-y-2">
                <AcceptDiscoveryDocumentButton
                  onConfirm={() => handleAction('archive')}
                  disabled={isPending}
                  isPending={isPending}
                  label={<Trans>Endgültig archivieren</Trans>}
                  className="w-full bg-emerald-600 text-white hover:bg-emerald-700"
                />
                <p className="text-xs text-neutral-500">
                  <Trans>
                    Startet die GoBD-10-Jahres-Frist und sperrt das Dokument unwiderruflich. Vorher
                    können Sie noch Felder korrigieren.
                  </Trans>
                </p>
              </div>
            )}

            {/* Tastatur-Hint, dezent. */}
            {!isArchived && (doc.status === 'inbox' || doc.status === 'pending-manual') && (
              <div className="text-xs text-neutral-500">
                <Trans>Tipp:</Trans>{' '}
                <kbd className="rounded border border-neutral-300 bg-white px-1.5 py-0.5 font-mono text-[10px]">
                  A
                </kbd>{' '}
                <Trans>Archiv</Trans> ·{' '}
                <kbd className="rounded border border-neutral-300 bg-white px-1.5 py-0.5 font-mono text-[10px]">
                  I
                </kbd>{' '}
                <Trans>Ignorieren</Trans> ·{' '}
                <kbd className="rounded border border-neutral-300 bg-white px-1.5 py-0.5 font-mono text-[10px]">
                  U
                </kbd>{' '}
                <Trans>Später</Trans> ·{' '}
                <kbd className="rounded border border-neutral-300 bg-white px-1.5 py-0.5 font-mono text-[10px]">
                  →
                </kbd>{' '}
                <Trans>Nächster</Trans>
              </div>
            )}

            {/* Zusatz-Aktionen — Gmail / Signatur — kompakt unten. */}
            <div className="flex flex-wrap items-center gap-2 border-t border-neutral-200 pt-3">
              {gmailDeepLink && (
                <Button asChild variant="ghost" size="sm">
                  <a href={gmailDeepLink} target="_blank" rel="noreferrer noopener">
                    <ExternalLinkIcon className="mr-2 h-3.5 w-3.5" aria-hidden />
                    <Trans>In Gmail öffnen</Trans>
                  </a>
                </Button>
              )}
              {doc.signingEnvelopeId ? (
                <Button asChild variant="ghost" size="sm">
                  <Link to={`/t/${teamUrl}/documents/${doc.signingEnvelopeId}/edit`}>
                    <PenLineIcon className="mr-2 h-3.5 w-3.5" aria-hidden />
                    <Trans>Signatur-Dokument öffnen</Trans>
                  </Link>
                </Button>
              ) : !isArchived ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => createSigningDocumentMutation.mutate({ id })}
                  disabled={
                    !doc.canCreateSigningDocument || createSigningDocumentMutation.isPending
                  }
                  title={
                    doc.canCreateSigningDocument
                      ? undefined
                      : 'Dieses Dokument hat noch keine PDF-Datei.'
                  }
                >
                  {createSigningDocumentMutation.isPending ? (
                    <Loader2Icon className="mr-2 h-3.5 w-3.5 animate-spin" aria-hidden />
                  ) : (
                    <PenLineIcon className="mr-2 h-3.5 w-3.5" aria-hidden />
                  )}
                  <Trans>Zum Signieren vorbereiten</Trans>
                </Button>
              ) : null}
            </div>
          </div>
        </section>

        {/* Mail-Body — als Klartext, niemals dangerouslySetInnerHTML */}
        {doc.bodyText && (
          <Card className="mb-6 p-4">
            <div className="mb-2 flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold">
                <Trans>Mail-Inhalt</Trans>
              </h2>
              {doc.bodyHasHtml && (
                <p className="text-xs text-muted-foreground">
                  <Trans>
                    HTML-Variante als Datei verfügbar — wird aus Sicherheitsgründen nicht inline
                    angezeigt.
                  </Trans>
                </p>
              )}
            </div>
            <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded bg-muted/30 p-3 text-sm leading-relaxed">
              {doc.bodyText}
            </pre>
          </Card>
        )}

        {/* Artifact-Liste — nur wenn ueberhaupt Files da sind. Wenn nicht,
          zeigen wir einen ehrlichen Hinweis statt eines toten Buttons. */}
        {artifacts.length > 0 ? (
          <div className="mb-6">
            <div className="mb-2 flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold">
                <Trans>Dateien im Archiv</Trans>
              </h2>
              {/* Sammel-Download: Anhänge + .eml als ZIP, eigener Ordner-Prefix.
                Nutzt denselben Endpoint wie Multi-Select aus der Listen-Ansicht.
                Absoluter Pfad — relative URLs resolven hier ungewollt. */}
              <Button asChild variant="outline" size="sm">
                <a href={`/t/${teamUrl}/find-documents/zip-attachments?ids=${id}`} download>
                  <DownloadIcon className="mr-2 h-3.5 w-3.5" aria-hidden />
                  <Trans>Anhänge + Mail als ZIP</Trans>
                </a>
              </Button>
            </div>
            <div className="flex flex-col gap-2">
              {artifacts.map((art) => (
                <ArtifactRow key={art.id} artifact={art} />
              ))}
            </div>
          </div>
        ) : (
          <Card className="mb-6 border-dashed bg-muted/30 p-4 text-sm">
            <p className="text-muted-foreground">
              <Trans>
                Keine Dateien im Archiv. Diese E-Mail wurde entweder vor Aktivierung des
                Archive-Features importiert oder enthielt keinen herunterladbaren Anhang (z. B.
                Beleg-Hinweis ohne PDF, der zum Portal verweist).
              </Trans>
            </p>
            {/* Re-Sync nur fuer IMAP-Belege anbieten — andere Provider haben
              keinen Re-Fetch-Pfad. Knopf laedt eml + Anhaenge nach. */}
            {doc.providerSource === 'imap' && (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => resyncMutation.mutate({ id })}
                  disabled={resyncMutation.isPending}
                >
                  {resyncMutation.isPending ? (
                    <Loader2Icon className="mr-2 h-3.5 w-3.5 animate-spin" aria-hidden />
                  ) : (
                    <RefreshCwIcon className="mr-2 h-3.5 w-3.5" aria-hidden />
                  )}
                  <Trans>Erneut aus IMAP laden</Trans>
                </Button>
                <span className="text-xs text-muted-foreground">
                  <Trans>
                    Holt die Mail nochmal vom Mailserver und schreibt Anhänge + .eml ins Archiv.
                  </Trans>
                </span>
              </div>
            )}
          </Card>
        )}

        {/* Server-Pfad-Hinweis fürs FTP/SCP-Reingucken — als technisches Detail
          ausgeklappt, damit es nicht als Aktionskarte missverstanden wird. */}
        {absoluteArchivePath && (
          <details className="rounded-md border border-dashed border-neutral-200 bg-muted/20 text-sm">
            <summary className="cursor-pointer list-none px-4 py-2 text-xs font-medium text-muted-foreground">
              <Trans>Technische Details (für Admins)</Trans>
            </summary>
            <div className="border-t px-4 py-3">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                <Trans>Pfad auf dem Server</Trans>
              </p>
              <p className="mt-1 break-all font-mono text-xs">{absoluteArchivePath}</p>
              <p className="mt-2 text-xs text-muted-foreground">
                <Trans>
                  Per FTP/SCP erreichbar. Dateien sind read-only (0440); zum Verschieben einer Kopie
                  benutzen Sie `cp` statt `mv`.
                </Trans>
              </p>
            </div>
          </details>
        )}

        {/* PREV/NEXT-NAVIGATION — wenn Beleg in der Queue ist. */}
        {isInQueue && queueTotal > 1 && (
          <nav
            aria-label="Beleg-Navigation"
            className="flex items-center justify-between border-t border-neutral-200 pt-4 text-sm text-neutral-600"
          >
            {prevDoc ? (
              <Button asChild variant="ghost" size="sm">
                <Link to={`../${prevDoc.id}`}>
                  <ArrowLeftIcon className="mr-2 h-4 w-4" aria-hidden />
                  <Trans>Voriger Beleg</Trans>
                </Link>
              </Button>
            ) : (
              <span className="px-3 py-1.5 text-neutral-400">
                <Trans>Erster Beleg</Trans>
              </span>
            )}
            <span className="text-xs text-neutral-400">
              <Trans>ohne Entscheidung weiterblättern</Trans>
            </span>
            {nextDoc ? (
              <Button asChild variant="ghost" size="sm">
                <Link to={`../${nextDoc.id}`}>
                  <Trans>Nächster Beleg</Trans>
                  <span className="ml-2" aria-hidden>
                    →
                  </span>
                </Link>
              </Button>
            ) : (
              <span className="px-3 py-1.5 text-neutral-400">
                <Trans>Letzter Beleg</Trans>
              </span>
            )}
          </nav>
        )}
      </div>
    </>
  );
}
