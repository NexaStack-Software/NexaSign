// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 NexaStack, NexaSign contributors
import { useEffect, useState } from 'react';

import { Trans } from '@lingui/react/macro';
import { ArrowRightIcon, CheckCircle2Icon, CircleIcon, XIcon } from 'lucide-react';
import { Link } from 'react-router';

import { Button } from '@nexasign/ui/primitives/button';
import { Card } from '@nexasign/ui/primitives/card';

const DISMISS_KEY = 'nexafile_first_run_checklist_dismissed';
const TAX_PACKAGE_KEY = 'nexafile_first_tax_package_created';

const isDismissed = () => {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(DISMISS_KEY) === '1';
  } catch {
    return false;
  }
};

const isTaxPackageCreated = () => {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(TAX_PACKAGE_KEY) === '1';
  } catch {
    return false;
  }
};

/**
 * Setzt den localStorage-Flag, dass die Persona einmal ein Steuerpaket
 * erstellt hat. Wird vom TaxPackageConfirmButton beim Klick auf „ZIP
 * erstellen" aufgerufen, damit der vierte Checklisten-Schritt grün wird.
 */
export const markTaxPackageCreated = () => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(TAX_PACKAGE_KEY, '1');
  } catch {
    // localStorage gesperrt — Checklist bleibt für die Session leer beim
    // 4. Schritt, kein Hard-Fail.
  }
};

type Props = {
  hasSource: boolean;
  hasSuccessfulSync: boolean;
  hasReviewedAtLeastOne: boolean;
  /** URL-Pfad zur Quellen-Settings-Seite. */
  sourcesHref: string;
  /** ID-Anker zum Sync-Panel auf der gleichen Seite (optional). */
  startSyncAnchor?: string;
  reviewHref: string;
  taxPackageHref: string;
};

/**
 * Onboarding-Checklist mit den 4 Kern-Schritten der Catch-Up-Workflow:
 *   1) Postfach verbinden
 *   2) Erste Suche starten
 *   3) Mindestens einen Beleg durchgehen
 *   4) Steuerpaket erstellen
 *
 * Sichtbar bis alle 4 Schritte erledigt sind ODER der User explizit
 * schließt. Schritt 4 wird über localStorage getrackt — kein Server-Trip
 * für eine reine UI-Hilfe.
 *
 * Dismiss ist persistent (localStorage), damit erfahrene User nicht
 * jeden Page-Visit die Checkliste wegklicken müssen.
 */
export const FirstRunChecklist = ({
  hasSource,
  hasSuccessfulSync,
  hasReviewedAtLeastOne,
  sourcesHref,
  reviewHref,
  taxPackageHref,
}: Props) => {
  const [dismissed, setDismissed] = useState(false);
  const [taxPackageDone, setTaxPackageDone] = useState(false);

  useEffect(() => {
    setDismissed(isDismissed());
    setTaxPackageDone(isTaxPackageCreated());
  }, []);

  // localStorage-Polling wäre teuer — wir hören stattdessen auf das
  // window-Event „storage" und ein eigenes „nexafile:tax-package-created",
  // das der TaxPackageConfirmButton bei Erfolg dispatcht.
  useEffect(() => {
    const onStorage = () => setTaxPackageDone(isTaxPackageCreated());
    window.addEventListener('storage', onStorage);
    window.addEventListener('nexafile:tax-package-created', onStorage);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('nexafile:tax-package-created', onStorage);
    };
  }, []);

  const steps = [
    {
      id: 1,
      done: hasSource,
      label: <Trans>Postfach verbinden</Trans>,
      hint: <Trans>Verbinden Sie Ihr E-Mail-Postfach via IMAP.</Trans>,
      cta: <Trans>Postfach hinzufügen</Trans>,
      href: sourcesHref,
    },
    {
      id: 2,
      done: hasSuccessfulSync,
      label: <Trans>Erste Suche starten</Trans>,
      hint: (
        <Trans>Wählen Sie einen Zeitraum und lassen Sie NexaFile Ihr Postfach durchsuchen.</Trans>
      ),
      cta: <Trans>Auf dieser Seite weiter</Trans>,
      href: '#mailbox-search-panel',
    },
    {
      id: 3,
      done: hasReviewedAtLeastOne,
      label: <Trans>Belege durchgehen</Trans>,
      hint: <Trans>Akzeptiere oder ignoriere die gefundenen Belege im Schnell-Review.</Trans>,
      cta: <Trans>Schnell-Review öffnen</Trans>,
      href: reviewHref,
    },
    {
      id: 4,
      done: taxPackageDone,
      label: <Trans>Steuerpaket erstellen</Trans>,
      hint: <Trans>Lade ein ZIP mit allen akzeptierten Belegen + MANIFEST.txt.</Trans>,
      cta: <Trans>Steuerpaket bauen</Trans>,
      href: taxPackageHref,
    },
  ];

  const completedCount = steps.filter((s) => s.done).length;
  const allDone = completedCount === steps.length;

  if (dismissed) return null;
  if (allDone) return null;

  // Nächster offener Schritt — visuell hervorgehoben, alle anderen blass.
  const nextStep = steps.find((s) => !s.done);

  const handleDismiss = () => {
    setDismissed(true);
    try {
      window.localStorage.setItem(DISMISS_KEY, '1');
    } catch {
      // Speicher gesperrt — bleibt für diese Session weg.
    }
  };

  return (
    <Card className="mb-6 p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-primary">
            <Trans>Erste Schritte</Trans>
          </p>
          <h2 className="text-lg font-semibold">
            <Trans>
              Schritt {completedCount} von {steps.length} — so kommen Sie zum Steuerpaket
            </Trans>
          </h2>
        </div>
        <button
          type="button"
          onClick={handleDismiss}
          className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="Checkliste dauerhaft schließen"
        >
          <XIcon className="h-4 w-4" aria-hidden />
        </button>
      </div>

      <ol className="mt-4 space-y-2">
        {steps.map((step) => {
          const isNext = nextStep?.id === step.id;
          return (
            <li
              key={step.id}
              className={`flex flex-wrap items-center justify-between gap-3 rounded-md border px-3 py-2 ${
                step.done
                  ? 'border-emerald-200 bg-emerald-50/60 dark:bg-emerald-950/20'
                  : isNext
                    ? 'border-primary/40 bg-primary/5'
                    : 'border-muted bg-background'
              }`}
            >
              <div className="flex min-w-0 items-start gap-2">
                {step.done ? (
                  <CheckCircle2Icon
                    className="mt-0.5 h-4 w-4 flex-shrink-0 text-emerald-600"
                    aria-hidden
                  />
                ) : (
                  <CircleIcon
                    className={`mt-0.5 h-4 w-4 flex-shrink-0 ${
                      isNext ? 'text-primary' : 'text-muted-foreground'
                    }`}
                    aria-hidden
                  />
                )}
                <div className="min-w-0">
                  <p
                    className={`text-sm font-medium ${
                      step.done ? 'text-muted-foreground line-through' : ''
                    }`}
                  >
                    {step.label}
                  </p>
                  {!step.done && (
                    <p className="mt-0.5 text-xs text-muted-foreground">{step.hint}</p>
                  )}
                </div>
              </div>
              {!step.done && isNext && (
                <Button asChild size="sm" className="h-7 gap-1.5 px-2.5 text-xs">
                  <Link to={step.href}>
                    {step.cta}
                    <ArrowRightIcon className="h-3 w-3" aria-hidden />
                  </Link>
                </Button>
              )}
            </li>
          );
        })}
      </ol>
    </Card>
  );
};
