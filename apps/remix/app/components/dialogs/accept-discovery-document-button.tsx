// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 NexaStack, NexaSign contributors
import { useState } from 'react';

import { Trans } from '@lingui/react/macro';
import { CheckCircleIcon, Loader2Icon } from 'lucide-react';

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
import { Checkbox } from '@nexasign/ui/primitives/checkbox';

const STORAGE_KEY = 'nexafile_accept_warning_dismissed';

const isDismissed = (): boolean => {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
};

const setDismissed = (value: boolean): void => {
  if (typeof window === 'undefined') return;
  try {
    if (value) {
      window.localStorage.setItem(STORAGE_KEY, '1');
    } else {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // localStorage abgeschaltet (Private Mode etc.) — Confirm wird dann
    // jedes Mal gezeigt. Akzeptables Verhalten, kein Datenverlust.
  }
};

type Props = {
  onConfirm: () => void;
  disabled?: boolean;
  isPending?: boolean;
  size?: 'default' | 'sm';
  variant?: 'default' | 'outline';
  /** Label override — Card-Listen-Variante ist kürzer als Detail-Variante. */
  label?: React.ReactNode;
  className?: string;
};

/**
 * Akzeptieren-Button mit einmaligem Confirm-Dialog. Beim ersten Klick zeigt
 * der Dialog die GoBD-/WORM-Konsequenz und einen „Diese Warnung nicht mehr
 * anzeigen"-Checkbox — Default checked, weil ein Power-User mehrere Belege
 * hintereinander akzeptiert. Spätere Klicks führen die Aktion ohne Dialog
 * direkt aus.
 *
 * Persona-Nutzen: verhindert WORM-Lock auf versehentlich akzeptierten
 * Werbe-Mails beim ersten Klick, bremst aber nicht den Power-Flow danach.
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
  const [dontShowAgain, setDontShowAgain] = useState(true);

  const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (isDismissed()) {
      onConfirm();
      return;
    }
    setOpen(true);
  };

  const handleConfirm = () => {
    if (dontShowAgain) {
      setDismissed(true);
    }
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
        {label ?? <Trans>Akzeptieren</Trans>}
      </Button>

      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              <Trans>Beleg akzeptieren — 10 Jahre Aufbewahrung</Trans>
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-3">
              <span className="block">
                <Trans>
                  Akzeptierte Belege unterliegen der 10-jährigen GoBD- Aufbewahrung (§ 147 AO / §
                  257 HGB). Sie können sie danach nur noch archivieren — nicht mehr ignorieren oder
                  löschen.
                </Trans>
              </span>
              <span className="block">
                <Trans>
                  Werbe-Mails, die versehentlich akzeptiert werden, bleiben 10 Jahre im System.
                </Trans>
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={dontShowAgain}
              onCheckedChange={(checked) => setDontShowAgain(checked === true)}
            />
            <span>
              <Trans>Diese Warnung nicht mehr anzeigen</Trans>
            </span>
          </label>
          <AlertDialogFooter>
            <AlertDialogCancel>
              <Trans>Abbrechen</Trans>
            </AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirm}>
              <Trans>Akzeptieren und sperren</Trans>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};
