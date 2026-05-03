// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 NexaStack, NexaSign contributors
import { useState } from 'react';

import { Trans } from '@lingui/react/macro';
import { DownloadIcon } from 'lucide-react';

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

type Props = {
  href: string;
  totalCount: number;
  downloadableCount: number;
  rangeFrom: Date | null;
  rangeTo: Date | null;
  locale: string;
  size?: 'default' | 'sm';
  className?: string;
};

/**
 * Steuerpaket-Download mit Vorschau-Bestätigung. Vor dem ZIP-Build sieht die
 * Persona, wieviele Belege, mit/ohne Anhang, welcher Zeitraum — verhindert
 * versehentliche Mega-ZIPs („300 Belege über 5 Jahre"), wenn der Filter nicht
 * eng genug war.
 *
 * Implementierung: AlertDialog mit Werten aus dem bereits geladenen Summary
 * (kein neuer Server-Roundtrip). Bestätigung navigiert per `window.location`
 * zum bereits gebauten Server-Endpoint, der das ZIP streamt.
 */
export const TaxPackageConfirmButton = ({
  href,
  totalCount,
  downloadableCount,
  rangeFrom,
  rangeTo,
  locale,
  size = 'sm',
  className,
}: Props) => {
  const [open, setOpen] = useState(false);

  const fmt = new Intl.DateTimeFormat(locale, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
  const rangeText = (() => {
    if (rangeFrom && rangeTo) {
      return `${fmt.format(rangeFrom)} – ${fmt.format(rangeTo)}`;
    }
    if (rangeFrom) return `ab ${fmt.format(rangeFrom)}`;
    if (rangeTo) return `bis ${fmt.format(rangeTo)}`;
    return null;
  })();

  const skippedCount = totalCount - downloadableCount;

  const handleConfirm = () => {
    setOpen(false);
    // Server-Endpoint liefert das ZIP als Stream mit Content-Disposition.
    // Direktes window.location löst den Download aus, ohne dass wir einen
    // unsichtbaren <a>-Klick simulieren müssen.
    if (typeof window !== 'undefined') {
      window.location.href = href;
    }
  };

  return (
    <>
      <Button size={size} className={className} onClick={() => setOpen(true)}>
        <DownloadIcon className="mr-2 h-3.5 w-3.5" aria-hidden />
        <Trans>Steuerpaket erstellen</Trans>
      </Button>

      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              <Trans>Steuerpaket erstellen</Trans>
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <span className="block">
                <Trans>
                  Das ZIP enthält {totalCount} Belege aus dem aktuellen Filter
                  {rangeText && <> · Zeitraum {rangeText}</>}.
                </Trans>
              </span>
              {skippedCount > 0 && (
                <span className="block text-muted-foreground">
                  <Trans>
                    Davon haben {downloadableCount} einen Anhang. Die übrigen {skippedCount} werden
                    im MANIFEST.txt als „nur Mail-Hinweis, PDF im Portal" gelistet.
                  </Trans>
                </span>
              )}
              <span className="block text-muted-foreground">
                <Trans>Die Erstellung kann bei vielen Belegen einige Sekunden dauern.</Trans>
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              <Trans>Abbrechen</Trans>
            </AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirm}>
              <Trans>ZIP erstellen</Trans>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};
