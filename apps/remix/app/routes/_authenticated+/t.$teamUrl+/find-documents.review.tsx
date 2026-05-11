// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 NexaStack, NexaSign contributors
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react';
import { Trans } from '@lingui/react/macro';
import {
  ArrowLeftIcon,
  CheckCircle2Icon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ExternalLinkIcon,
  EyeIcon,
  KeyboardIcon,
  PaperclipIcon,
  PenLineIcon,
  SkipForwardIcon,
  XCircleIcon,
} from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router';

import { trpc } from '@nexasign/trpc/react';
import type {
  TDiscoveryArtifact,
  TGetDocumentDetailResponse,
} from '@nexasign/trpc/server/discovery-router/schema';
import { Badge } from '@nexasign/ui/primitives/badge';
import { Button } from '@nexasign/ui/primitives/button';
import { Card } from '@nexasign/ui/primitives/card';
import { Input } from '@nexasign/ui/primitives/input';
import { Skeleton } from '@nexasign/ui/primitives/skeleton';
import { useToast } from '@nexasign/ui/primitives/use-toast';

import { useDeferredStatusAction } from '~/components/discovery/use-deferred-status-action';
import { appMetaTags } from '~/utils/meta';

export function meta() {
  return appMetaTags(msg`Schnell-Review`);
}

const PAGE_SIZE_HINT = 5;

/**
 * Schnell-Review-Modus für die Beleg-Liste. Optimiert für Persona, die in
 * einem Rutsch hunderte Belege durchgehen muss: Vollbild-Single-Doc-Ansicht,
 * Tastenkürzel J/K für Navigation, A/I für Ins Archiv/Ignorieren, E zum
 * Editieren. Lädt die Liste aller offenen Belege per Infinite Query und
 * fetched die Details des aktuellen Eintrags lazy nach.
 *
 * Beschleunigt das, was vorher pro Beleg ≈ 5 Sekunden Maus-Arbeit war,
 * auf ≈ 1–2 Sekunden Tastatur-Arbeit.
 */
export default function FindDocumentsReview() {
  const { _, i18n } = useLingui();
  const { toast } = useToast();
  const navigate = useNavigate();
  const params = useParams();
  const teamUrl = params.teamUrl ?? '';
  const backHref = `/t/${teamUrl}/find-documents`;

  const utils = trpc.useUtils();

  const queue = trpc.discovery.findDocuments.useInfiniteQuery(
    {
      status: 'all',
      qualityFilter: 'needs-review',
    },
    {
      getNextPageParam: (lastPage) => lastPage.nextCursor,
    },
  );

  const documents = useMemo(
    () => (queue.data?.pages ?? []).flatMap((p) => p.documents),
    [queue.data?.pages],
  );

  // skipped: lokal vom Nutzer übersprungene IDs — bleiben in der Queue, sind
  // aber visuell aus dem Cursor genommen, damit J/K nicht mehr darauf landet.
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  // committed: IDs die nach Accept/Ignore nicht mehr Teil der Queue sind.
  // Sobald die Liste invalidiert wird, fallen sie sowieso raus; bis dahin
  // springen wir lokal weiter, damit das Tippen flüssig bleibt.
  const [committed, setCommitted] = useState<Set<string>>(new Set());

  const visibleDocuments = useMemo(
    () => documents.filter((d) => !skipped.has(d.id) && !committed.has(d.id)),
    [documents, skipped, committed],
  );

  const [currentId, setCurrentId] = useState<string | null>(null);

  // Wenn die Queue lädt oder die aktuelle ID nicht mehr existiert, auf das
  // erste sichtbare Dokument springen. Wenn keins mehr da ist und wir auch
  // keine weiteren Seiten haben, sind wir fertig.
  useEffect(() => {
    if (visibleDocuments.length === 0) {
      if (currentId !== null) setCurrentId(null);
      return;
    }
    if (!currentId || !visibleDocuments.some((d) => d.id === currentId)) {
      setCurrentId(visibleDocuments[0]!.id);
    }
  }, [visibleDocuments, currentId]);

  const currentIndex = currentId ? visibleDocuments.findIndex((d) => d.id === currentId) : -1;

  // Pre-Fetch: sobald wir uns dem Ende der geladenen Seite nähern, nächste
  // Seite holen, damit J/K nicht spürbar stockt.
  useEffect(() => {
    if (currentIndex < 0) return;
    if (queue.hasNextPage && !queue.isFetchingNextPage) {
      if (visibleDocuments.length - currentIndex <= PAGE_SIZE_HINT) {
        void queue.fetchNextPage();
      }
    }
  }, [currentIndex, visibleDocuments.length, queue]);

  const goNext = useCallback(() => {
    if (currentIndex < 0) return;
    const next = visibleDocuments[currentIndex + 1];
    if (next) {
      setCurrentId(next.id);
    } else if (queue.hasNextPage) {
      void queue.fetchNextPage();
    }
  }, [currentIndex, visibleDocuments, queue]);

  const goPrev = useCallback(() => {
    if (currentIndex <= 0) return;
    const prev = visibleDocuments[currentIndex - 1];
    if (prev) setCurrentId(prev.id);
  }, [currentIndex, visibleDocuments]);

  const undoLocalCommit = useCallback((id: string) => {
    setCommitted((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    setCurrentId(id);
  }, []);

  const deferred = useDeferredStatusAction({
    onCommitted: () => {
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

  const accept = useCallback(
    (id: string, previewLabel?: string) => {
      setCommitted((prev) => new Set(prev).add(id));
      goNext();
      deferred.schedule({
        id,
        action: 'accept',
        previewLabel,
        onUndo: () => undoLocalCommit(id),
      });
    },
    [goNext, deferred, undoLocalCommit],
  );

  const ignore = useCallback(
    (id: string, previewLabel?: string) => {
      setCommitted((prev) => new Set(prev).add(id));
      goNext();
      deferred.schedule({
        id,
        action: 'ignore',
        previewLabel,
        onUndo: () => undoLocalCommit(id),
      });
    },
    [goNext, deferred, undoLocalCommit],
  );

  const skip = useCallback(
    (id: string) => {
      setSkipped((prev) => new Set(prev).add(id));
      goNext();
    },
    [goNext],
  );

  const editFieldRef = useRef<HTMLButtonElement | null>(null);
  const triggerEditFocus = useCallback(() => {
    editFieldRef.current?.click();
    editFieldRef.current?.focus();
  }, []);

  // Tastenkürzel — J/K + Pfeile für Navigation, A/I für Status, E für Edit,
  // Esc geht zurück zur Listen-Ansicht. Aktive Eingabe-Felder beachten,
  // sonst frisst das Listener-Set Buchstaben in Inputs.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target instanceof HTMLElement ? e.target : null;
      const inEditable =
        target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable;
      if (inEditable) {
        if (e.key === 'Escape' && target) target.blur();
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      if (e.key === 'j' || e.key === 'ArrowDown' || e.key === 'ArrowRight') {
        e.preventDefault();
        goNext();
        return;
      }
      if (e.key === 'k' || e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
        e.preventDefault();
        goPrev();
        return;
      }
      if (!currentId) return;
      if (e.key === 'a' || e.key === 'A') {
        e.preventDefault();
        accept(currentId);
        return;
      }
      if (e.key === 'i' || e.key === 'I') {
        e.preventDefault();
        ignore(currentId);
        return;
      }
      if (e.key === 's' || e.key === 'S') {
        e.preventDefault();
        skip(currentId);
        return;
      }
      if (e.key === 'e' || e.key === 'E') {
        e.preventDefault();
        triggerEditFocus();
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        void navigate(backHref);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [accept, ignore, skip, goNext, goPrev, navigate, backHref, currentId, triggerEditFocus]);

  const totalRemaining = visibleDocuments.length + (queue.hasNextPage ? 1 : 0);
  const totalEverLoaded = documents.length;
  const totalProcessedThisSession = committed.size;

  return (
    <div className="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-screen-xl flex-col gap-4 px-4 py-6 md:px-8">
      <ReviewHeader
        backHref={backHref}
        currentIndex={currentIndex}
        visibleCount={visibleDocuments.length}
        hasNextPage={queue.hasNextPage ?? false}
        totalEverLoaded={totalEverLoaded}
        processedCount={totalProcessedThisSession}
        onPrev={goPrev}
        onNext={goNext}
      />

      {queue.isLoading && <ReviewSkeleton />}

      {!queue.isLoading && totalRemaining === 0 && (
        <ReviewDone backHref={backHref} processed={totalProcessedThisSession} />
      )}

      {!queue.isLoading && currentId && (
        <ReviewBody
          documentId={currentId}
          teamUrl={teamUrl}
          locale={i18n.locale}
          editFieldRef={editFieldRef}
          onAccept={() => accept(currentId)}
          onIgnore={() => ignore(currentId)}
          onSkip={() => skip(currentId)}
        />
      )}

      <KeyboardLegend />
    </div>
  );
}

const ReviewHeader = ({
  backHref,
  currentIndex,
  visibleCount,
  hasNextPage,
  totalEverLoaded,
  processedCount,
  onPrev,
  onNext,
}: {
  backHref: string;
  currentIndex: number;
  visibleCount: number;
  hasNextPage: boolean;
  totalEverLoaded: number;
  processedCount: number;
  onPrev: () => void;
  onNext: () => void;
}) => {
  const positionDisplay = currentIndex >= 0 ? currentIndex + 1 : 0;
  const totalDisplay = visibleCount + (hasNextPage ? '+' : '');
  return (
    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="sm">
          <Link to={backHref}>
            <ArrowLeftIcon className="mr-1.5 h-4 w-4" aria-hidden />
            <Trans>Zurück zur Liste</Trans>
          </Link>
        </Button>
        <div>
          <p className="text-sm font-medium">
            <Trans>Schnell-Review</Trans>
          </p>
          <p className="text-xs text-muted-foreground">
            <Trans>
              {positionDisplay} von {totalDisplay} · {processedCount} in dieser Sitzung erledigt ·
              A/I wirkt sofort, mit 5 Sekunden Rückgängig
            </Trans>
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={onPrev}
          disabled={currentIndex <= 0}
          aria-label="Vorheriger Beleg"
        >
          <ChevronLeftIcon className="h-4 w-4" aria-hidden />
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={onNext}
          disabled={currentIndex < 0 || (currentIndex >= visibleCount - 1 && !hasNextPage)}
          aria-label="Nächster Beleg"
        >
          <ChevronRightIcon className="h-4 w-4" aria-hidden />
        </Button>
        <span className="hidden text-xs text-muted-foreground md:inline">
          <Trans>{totalEverLoaded} geladen</Trans>
        </span>
      </div>
    </div>
  );
};

const ReviewSkeleton = () => (
  <div className="grid gap-4 md:grid-cols-2">
    <Skeleton className="h-[60vh]" />
    <Skeleton className="h-[60vh]" />
  </div>
);

const ReviewDone = ({ backHref, processed }: { backHref: string; processed: number }) => (
  <Card className="flex flex-col items-center gap-4 p-12 text-center">
    <CheckCircle2Icon className="h-12 w-12 text-emerald-600" aria-hidden />
    <div>
      <h2 className="text-xl font-semibold">
        <Trans>Alles abgearbeitet</Trans>
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        <Trans>
          Sie haben {processed} Belege in dieser Sitzung erledigt. Wenn Sie weitere Belege finden
          möchten, starten Sie einfach einen neuen Sync.
        </Trans>
      </p>
    </div>
    <Button asChild>
      <Link to={backHref}>
        <Trans>Zur Liste zurück</Trans>
      </Link>
    </Button>
  </Card>
);

const ReviewBody = ({
  documentId,
  teamUrl,
  locale,
  editFieldRef,
  onAccept,
  onIgnore,
  onSkip,
}: {
  documentId: string;
  teamUrl: string;
  locale: string;
  editFieldRef: React.MutableRefObject<HTMLButtonElement | null>;
  onAccept: () => void;
  onIgnore: () => void;
  onSkip: () => void;
}) => {
  const { data, isLoading } = trpc.discovery.getDocumentDetail.useQuery({ id: documentId });

  if (isLoading) return <ReviewSkeleton />;
  if (!data) {
    return (
      <Card className="p-6 text-center text-sm text-muted-foreground">
        <Trans>Dieser Beleg konnte nicht geladen werden.</Trans>
      </Card>
    );
  }

  const detail = data.document;
  const dateFmt = new Intl.DateTimeFormat(locale, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
  const docDate = detail.documentDate ?? detail.capturedAt;
  const isAccepted = Boolean(detail.acceptedAt);
  const isArchived = Boolean(detail.archivedAt);

  return (
    <div className="grid flex-1 gap-4 lg:grid-cols-[3fr_2fr]">
      <Card className="flex min-h-[60vh] flex-col gap-3 p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b pb-3">
          <div className="min-w-0 flex-1">
            <h2 className="break-words text-lg font-semibold leading-tight" title={detail.title}>
              {detail.title}
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              {dateFmt.format(docDate)}
              {detail.correspondent && (
                <>
                  {' · '}
                  <span className="font-medium text-foreground">{detail.correspondent}</span>
                </>
              )}
              {detail.sourceLabel && (
                <>
                  {' · '}
                  {detail.sourceLabel}
                </>
              )}
            </p>
          </div>
          {isAccepted && (
            <Badge variant="secondary" className="gap-1">
              <CheckCircle2Icon className="h-3 w-3" aria-hidden />
              <Trans>Bereits im Archiv</Trans>
            </Badge>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto whitespace-pre-wrap text-sm leading-relaxed">
          {detail.bodyText ?? (
            <p className="text-muted-foreground">
              <Trans>Kein Klartext verfügbar — öffne die Detail-Seite für die HTML-Variante.</Trans>
            </p>
          )}
        </div>
      </Card>

      <div className="flex flex-col gap-3">
        <DetectedFieldsCard
          documentId={documentId}
          detail={detail}
          isArchived={isArchived}
          editFieldRef={editFieldRef}
        />

        <AttachmentSection teamUrl={teamUrl} documentId={documentId} artifacts={data.artifacts} />

        <Card className="flex flex-col gap-2 p-3">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            <Trans>Aktion (Tastenkürzel)</Trans>
          </p>
          <div className="grid grid-cols-2 gap-2">
            <Button size="sm" disabled={isAccepted} onClick={onAccept}>
              <CheckCircle2Icon className="mr-1.5 h-4 w-4 text-emerald-600" aria-hidden />
              <Trans>Ins Archiv</Trans>
              <Kbd className="ml-1.5">A</Kbd>
            </Button>
            <Button size="sm" variant="outline" onClick={onIgnore}>
              <XCircleIcon className="mr-1.5 h-4 w-4 text-destructive" aria-hidden />
              <Trans>Ignorieren</Trans>
              <Kbd className="ml-1.5">I</Kbd>
            </Button>
            <Button size="sm" variant="ghost" onClick={onSkip}>
              <SkipForwardIcon className="mr-1.5 h-4 w-4" aria-hidden />
              <Trans>Überspringen</Trans>
              <Kbd className="ml-1.5">S</Kbd>
            </Button>
            <Button asChild size="sm" variant="ghost">
              <Link to={`/t/${teamUrl}/find-documents/${documentId}`}>
                <ExternalLinkIcon className="mr-1.5 h-4 w-4" aria-hidden />
                <Trans>Detailseite</Trans>
              </Link>
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
};

const DetectedFieldsCard = ({
  documentId,
  detail,
  isArchived,
  editFieldRef,
}: {
  documentId: string;
  detail: NonNullable<TGetDocumentDetailResponse>['document'];
  isArchived: boolean;
  editFieldRef: React.MutableRefObject<HTMLButtonElement | null>;
}) => {
  const utils = trpc.useUtils();
  const { _ } = useLingui();
  const { toast } = useToast();
  const updateFields = trpc.discovery.updateDetectedFields.useMutation({
    onSuccess: () => {
      void utils.discovery.getDocumentDetail.invalidate({ id: documentId });
      void utils.discovery.findDocuments.invalidate();
    },
    onError: (err) => {
      toast({
        title: _(msg`Speichern fehlgeschlagen`),
        description: err.message,
        variant: 'destructive',
      });
    },
  });

  return (
    <Card className="flex flex-col gap-3 p-3">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">
        <Trans>Erkannte Felder</Trans>
      </p>
      <FieldRow
        label={_(msg`Korrespondent`)}
        value={detail.correspondent}
        disabled={isArchived}
        editFieldRef={editFieldRef}
        onSave={async (next) => {
          await updateFields.mutateAsync({ id: documentId, correspondent: next });
        }}
      />
      <FieldRow
        label={_(msg`Betrag`)}
        value={detail.detectedAmount}
        disabled={isArchived}
        onSave={async (next) => {
          await updateFields.mutateAsync({ id: documentId, detectedAmount: next });
        }}
      />
      <FieldRow
        label={_(msg`Rechnungsnummer`)}
        value={detail.detectedInvoiceNumber}
        disabled={isArchived}
        monospace
        onSave={async (next) => {
          await updateFields.mutateAsync({ id: documentId, detectedInvoiceNumber: next });
        }}
      />
    </Card>
  );
};

const FieldRow = ({
  label,
  value,
  disabled,
  monospace,
  onSave,
  editFieldRef,
}: {
  label: string;
  value: string | null;
  disabled: boolean;
  monospace?: boolean;
  onSave: (next: string | null) => Promise<void>;
  editFieldRef?: React.MutableRefObject<HTMLButtonElement | null>;
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

  return (
    <div className="flex flex-col gap-1">
      <p className="text-xs text-muted-foreground">{label}</p>
      {disabled || !isEditing ? (
        <button
          type="button"
          ref={editFieldRef}
          disabled={disabled}
          onClick={() => setIsEditing(true)}
          className={`group flex items-baseline gap-2 text-left text-sm ${
            disabled ? 'cursor-default' : 'hover:text-foreground'
          }`}
        >
          <span
            className={`font-medium ${monospace ? 'font-mono' : ''} ${
              value ? '' : 'text-muted-foreground'
            }`}
          >
            {value ?? '–'}
          </span>
          {!disabled && (
            <PenLineIcon
              className="h-3 w-3 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
              aria-hidden
            />
          )}
        </button>
      ) : (
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
          className={`h-8 ${monospace ? 'font-mono' : ''}`}
        />
      )}
    </div>
  );
};

const AttachmentSection = ({
  teamUrl,
  documentId,
  artifacts,
}: {
  teamUrl: string;
  documentId: string;
  artifacts: TDiscoveryArtifact[];
}) => {
  const attachments = artifacts.filter((a) => a.kind === 'ATTACHMENT');
  if (attachments.length === 0) {
    return (
      <Card className="flex flex-col gap-1 p-3 text-xs text-muted-foreground">
        <p className="font-medium uppercase tracking-wide">
          <Trans>Anhang</Trans>
        </p>
        <p>
          <Trans>Kein Anhang — bei Bedarf im Kunden-Portal nachziehen.</Trans>
        </p>
      </Card>
    );
  }

  const previewable = attachments.find(
    (a) => a.contentType === 'application/pdf' || a.contentType.startsWith('image/'),
  );

  return (
    <Card className="flex flex-col gap-2 p-3">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">
        <Trans>Anhang ({attachments.length})</Trans>
      </p>
      <ul className="flex flex-col gap-1.5">
        {attachments.map((a) => (
          <li key={a.id} className="flex items-center justify-between gap-2 text-sm">
            <span className="flex min-w-0 items-center gap-1.5">
              <PaperclipIcon
                className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground"
                aria-hidden
              />
              <span className="truncate" title={a.fileName}>
                {a.fileName}
              </span>
            </span>
            <a
              href={`/t/${teamUrl}/find-documents/${documentId}/artifacts/${a.id}?inline=1`}
              target="_blank"
              rel="noreferrer noopener"
              className="flex items-center gap-1 text-xs text-primary hover:underline"
            >
              <EyeIcon className="h-3 w-3" aria-hidden />
              <Trans>Vorschau</Trans>
            </a>
          </li>
        ))}
      </ul>
      {previewable && (
        <object
          data={`/t/${teamUrl}/find-documents/${documentId}/artifacts/${previewable.id}?inline=1`}
          type={previewable.contentType}
          className="mt-2 h-64 w-full rounded border bg-muted/30"
          aria-label="Anhang-Vorschau"
        >
          <p className="p-2 text-xs text-muted-foreground">
            <Trans>Vorschau nicht verfügbar — bitte Anhang öffnen.</Trans>
          </p>
        </object>
      )}
    </Card>
  );
};

const KeyboardLegend = () => (
  <div className="mt-2 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
    <span className="flex items-center gap-1">
      <KeyboardIcon className="h-3 w-3" aria-hidden />
      <Trans>Tastenkürzel:</Trans>
    </span>
    <Legend keyHint="J" label="Weiter" />
    <Legend keyHint="K" label="Zurück" />
    <Legend keyHint="A" label="Ins Archiv" />
    <Legend keyHint="I" label="Ignorieren" />
    <Legend keyHint="S" label="Überspringen" />
    <Legend keyHint="E" label="Feld bearbeiten" />
    <Legend keyHint="Esc" label="Liste" />
  </div>
);

const Legend = ({ keyHint, label }: { keyHint: string; label: string }) => (
  <span className="flex items-center gap-1">
    <Kbd>{keyHint}</Kbd>
    <span>{label}</span>
  </span>
);

const Kbd = ({ children, className }: { children: React.ReactNode; className?: string }) => (
  <kbd
    className={`rounded border bg-background px-1.5 font-mono text-[10px] uppercase leading-tight ${
      className ?? ''
    }`}
  >
    {children}
  </kbd>
);
