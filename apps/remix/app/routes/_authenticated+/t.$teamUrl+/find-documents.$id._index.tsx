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
  XCircleIcon,
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
 * Inline-Edit für ein erkanntes Feld. Read-Only solange Beleg `isAccepted`
 * (WORM-Lock — Server würde die Mutation eh ablehnen). Speichern auf Enter
 * oder Blur, Abbrechen mit Escape. Persona-Nutzen: Heuristik-Fehler (Netto
 * statt Brutto, abgekürzte Korrespondenten) lassen sich vor dem Akzeptieren
 * direkt korrigieren — die spätere CSV ist dann belastbar.
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
  const isPending = updateStatusMutation.isPending;

  return (
    <div className="mx-auto w-full max-w-screen-lg px-4 py-8 md:px-8">
      <header className="mb-6 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <Button asChild variant="ghost" size="sm" className="-ml-3 mb-2">
            <Link to="..">
              <ArrowLeftIcon className="mr-2 h-4 w-4" aria-hidden />
              <Trans>Alle Belege</Trans>
            </Link>
          </Button>
          <h1 className="break-words text-2xl font-bold tracking-tight md:text-3xl">{doc.title}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
            {doc.correspondent && <span>{doc.correspondent}</span>}
            <span>{formatDate(doc.documentDate ?? doc.capturedAt, i18n.locale)}</span>
            {doc.sourceLabel && (
              <span className="inline-flex items-center gap-1">
                <MailIcon className="h-3.5 w-3.5" aria-hidden />
                {doc.sourceLabel}
              </span>
            )}
            {isAccepted && (
              <Badge variant="secondary" className="gap-1.5">
                <LockIcon className="h-3 w-3" aria-hidden />
                <Trans>Akzeptiert · GoBD-gesperrt</Trans>
              </Badge>
            )}
          </div>
        </div>
      </header>

      {/* Aktions-Buttons — Hierarchie:
          1) Workflow-Entscheidungen (akzeptieren / manuell / ignorieren)
          2) Trenn-Pipe
          3) Hilfsfunktionen (Gmail öffnen, Signatur-Doc) als ghost
          „Ignorieren" wird ghost statt outline, weil es destruktiv ist und
          nicht versehentlich neben „Akzeptieren" geklickt werden soll. */}
      <div className="mb-6 flex flex-wrap items-center gap-2">
        {!isAccepted && doc.status === 'inbox' && (
          <>
            <AcceptDiscoveryDocumentButton
              onConfirm={() => handleAction('accept')}
              disabled={isPending}
              isPending={isPending}
              label={<Trans>Als Beleg akzeptieren</Trans>}
            />
            <Button
              variant="outline"
              onClick={() => handleAction('mark-pending-manual')}
              disabled={isPending}
            >
              <ClockIcon className="mr-2 h-4 w-4" aria-hidden />
              <Trans>Manuell zu ziehen</Trans>
            </Button>
            <Button
              variant="ghost"
              className="text-muted-foreground hover:text-destructive"
              onClick={() => handleAction('ignore')}
              disabled={isPending}
            >
              <XCircleIcon className="mr-2 h-4 w-4" aria-hidden />
              <Trans>Ignorieren</Trans>
            </Button>
          </>
        )}
        {!isAccepted && doc.status === 'pending-manual' && (
          <Button onClick={() => handleAction('archive')} disabled={isPending}>
            <ArchiveIcon className="mr-2 h-4 w-4" aria-hidden />
            <Trans>Archivieren</Trans>
          </Button>
        )}
        {isAccepted && doc.status !== 'processed' && (
          <Button variant="outline" onClick={() => handleAction('archive')} disabled={isPending}>
            <ArchiveIcon className="mr-2 h-4 w-4" aria-hidden />
            <Trans>Archivieren</Trans>
          </Button>
        )}
        {(gmailDeepLink || doc.signingEnvelopeId !== null) && (
          <span className="mx-1 hidden h-5 w-px bg-border md:inline-block" aria-hidden />
        )}
        {gmailDeepLink && (
          <Button asChild variant="ghost" size="sm">
            <a href={gmailDeepLink} target="_blank" rel="noreferrer noopener">
              <ExternalLinkIcon className="mr-2 h-4 w-4" aria-hidden />
              <Trans>In Gmail öffnen</Trans>
            </a>
          </Button>
        )}
        {doc.signingEnvelopeId ? (
          <Button asChild variant="ghost" size="sm">
            <Link to={`/t/${teamUrl}/documents/${doc.signingEnvelopeId}/edit`}>
              <PenLineIcon className="mr-2 h-4 w-4" aria-hidden />
              <Trans>Signatur-Dokument öffnen</Trans>
            </Link>
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => createSigningDocumentMutation.mutate({ id })}
            disabled={!doc.canCreateSigningDocument || createSigningDocumentMutation.isPending}
            title={
              doc.canCreateSigningDocument ? undefined : 'Dieses Dokument hat noch keine PDF-Datei.'
            }
          >
            {createSigningDocumentMutation.isPending ? (
              <Loader2Icon className="mr-2 h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <PenLineIcon className="mr-2 h-4 w-4" aria-hidden />
            )}
            <Trans>Zum Signieren vorbereiten</Trans>
          </Button>
        )}
      </div>

      {/* Erkannte Felder — vor Akzeptieren editierbar (Heuristik korrigieren),
          nach Akzeptieren read-only (WORM-Lock, GoBD). */}
      <Card className="mb-6 grid grid-cols-1 gap-4 p-4 md:grid-cols-3">
        <div>
          <p className="flex items-baseline justify-between gap-2 text-xs uppercase tracking-wide text-muted-foreground">
            <span>
              <Trans>Möglicher Rechnungsbetrag</Trans>
            </span>
            <span className="text-[10px] normal-case tracking-normal">
              <Trans>automatisch — bitte prüfen</Trans>
            </span>
          </p>
          <div className="mt-1">
            <EditableDetectedField
              value={doc.detectedAmount}
              disabled={isAccepted || updateDetectedFieldsMutation.isPending}
              placeholder="z. B. 23,79 EUR"
              ariaLabel="Rechnungsbetrag bearbeiten"
              onSave={async (next) => {
                await updateDetectedFieldsMutation.mutateAsync({ id, detectedAmount: next });
              }}
            />
          </div>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            <Trans>Rechnungs-Nr.</Trans>
          </p>
          <div className="mt-1">
            <EditableDetectedField
              value={doc.detectedInvoiceNumber}
              disabled={isAccepted || updateDetectedFieldsMutation.isPending}
              placeholder="z. B. R-2024-1234"
              monospace
              ariaLabel="Rechnungs-Nummer bearbeiten"
              onSave={async (next) => {
                await updateDetectedFieldsMutation.mutateAsync({
                  id,
                  detectedInvoiceNumber: next,
                });
              }}
            />
          </div>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            <Trans>Korrespondent</Trans>
          </p>
          <div className="mt-1">
            <EditableDetectedField
              value={doc.correspondent}
              disabled={isAccepted || updateDetectedFieldsMutation.isPending}
              placeholder="z. B. Hetzner Online GmbH"
              ariaLabel="Korrespondent bearbeiten"
              onSave={async (next) => {
                await updateDetectedFieldsMutation.mutateAsync({ id, correspondent: next });
              }}
            />
          </div>
        </div>
        {doc.portalHint && (
          <div className="md:col-span-3 md:border-t md:pt-3">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              <Trans>Beleg liegt im Kunden-Portal</Trans>
            </p>
            <p className="mt-1 text-sm">
              <span className="italic text-muted-foreground">„{doc.portalHint}"</span>
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
        {isAccepted && (
          <p className="text-xs text-muted-foreground md:col-span-3">
            <Trans>
              Beleg ist akzeptiert (GoBD-gesperrt). Felder können nicht mehr geändert werden.
            </Trans>
          </p>
        )}
      </Card>

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
    </div>
  );
}
