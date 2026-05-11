// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 NexaStack, NexaSign contributors
import { useState } from 'react';

import { Trans } from '@lingui/react/macro';
import { AlertTriangleIcon, CheckCircleIcon, Loader2Icon } from 'lucide-react';

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
  onConfirm: () => void;
  disabled?: boolean;
  isPending?: boolean;
  size?: 'default' | 'sm';
  variant?: 'default' | 'outline' | 'ghost';
  /** Label override für unterschiedliche Aufruf-Kontexte. */
  label?: React.ReactNode;
  className?: string;
};

/**
 * Bestätigungs-Button für die endgültige (rechtssichere) Archivierung — Stufe 2.
 * Zeigt JEDES MAL die Warnung an, weil die Aktion irreversibel ist (10 Jahre
 * Aufbewahrung, keine Mutation mehr möglich). Kein „nicht mehr anzeigen"-
 * Mechanismus mehr — der Schutz vor versehentlichen WORM-Locks ist wichtiger
 * als ein paar Sekunden Power-User-Geschwindigkeit.
 */
export const AcceptDiscoveryDocumentButton = ({
  onConfirm,
  disabled,
  isPending,
  size = 'default',
  variant = 'default',
  label,
  className,
}: Props) => {
  const [open, setOpen] = useState(false);

  const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    setOpen(true);
  };

  const handleConfirm = () => {
    setOpen(false);
    onConfirm();
  };

  return (
    <>
      <Button
        size={size}
        variant={variant}
        disabled={disabled}
        onClick={handleClick}
        className={className}
      >
        {isPending ? (
          <Loader2Icon className="mr-2 h-4 w-4 animate-spin" aria-hidden />
        ) : (
          <CheckCircleIcon className="mr-1.5 h-4 w-4" aria-hidden />
        )}
        {label ?? <Trans>Endgültig archivieren</Trans>}
      </Button>

      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangleIcon className="h-5 w-5 text-amber-600" aria-hidden />
              <Trans>Achtung — das werden Sie nicht mehr ändern können</Trans>
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-3">
              <span className="block">
                <Trans>
                  Wenn Sie jetzt endgültig archivieren, wird der Beleg{' '}
                  <strong>10 Jahre lang schreibgeschützt aufbewahrt</strong> — wie es das Finanzamt
                  verlangt (§ 147 AO).
                </Trans>
              </span>
              <span className="block">
                <Trans>
                  Sie können den Beleg danach{' '}
                  <strong>
                    nicht mehr ändern, nicht mehr löschen und nicht mehr aus dem Archiv entfernen
                  </strong>
                  . Felder wie Korrespondent, Betrag oder Rechnungsnummer sind dann fix.
                </Trans>
              </span>
              <span className="block">
                <Trans>
                  Wenn Sie noch unsicher sind, lassen Sie den Beleg in „Im Archiv (noch
                  korrigierbar)" liegen.
                </Trans>
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              <Trans>Abbrechen</Trans>
            </AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirm}>
              <Trans>Ja, endgültig archivieren</Trans>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};
