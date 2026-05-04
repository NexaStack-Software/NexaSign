// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 NexaStack, NexaSign contributors
import { useEffect, useRef, useState } from 'react';

import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react';
import { Trans } from '@lingui/react/macro';
import { BellIcon, CheckCircle2Icon, Loader2Icon, XIcon } from 'lucide-react';

import type { TActiveSyncRun } from '@nexasign/trpc/server/discovery-router/schema';
import { Button } from '@nexasign/ui/primitives/button';
import { Card } from '@nexasign/ui/primitives/card';

const NOTIFICATION_OPT_IN_KEY = 'nexafile_notify_on_sync_done';

const isNotificationApiAvailable = () => typeof window !== 'undefined' && 'Notification' in window;

type Props = {
  activeRuns: ReadonlyArray<TActiveSyncRun>;
  locale: string;
};

/**
 * Vertrauen-Banner während ein Sync läuft. Adressiert zwei häufige
 * Persona-Sorgen bei langen Importen:
 *   1) „Wenn ich die Seite zumache, bricht es ab"
 *   2) „Wie lange dauert das noch?"
 *
 * Banner liegt oberhalb des dünnen Status-Streifens und zeigt:
 *   - Klar: „Du kannst die Seite schließen, wir machen weiter"
 *   - Pro Run: Mails geprüft, Belege gefunden, Verarbeitungs-Rate
 *   - Optional: Browser-Notification beim Abschluss (mit Opt-in)
 */
export const BackgroundSyncBanner = ({ activeRuns, locale }: Props) => {
  const { _ } = useLingui();
  const numberFmt = new Intl.NumberFormat(locale);

  // Notification-Erlaubnis. Persona klickt einmal auf den Button → wir
  // requesten die Permission. Antwort wird in localStorage festgehalten,
  // damit der Banner nicht jeden Besuch erneut den Button zeigt.
  const [notifyEnabled, setNotifyEnabled] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    try {
      return window.localStorage.getItem(NOTIFICATION_OPT_IN_KEY) === '1';
    } catch {
      return false;
    }
  });

  // Letzter aktiver Run-Counter — wenn er von >0 auf 0 fällt UND notifyEnabled
  // gesetzt ist, feuern wir eine Browser-Notification. Persona kann auf
  // anderem Tab arbeiten und wird dann gepingt.
  const lastCountRef = useRef(activeRuns.length);
  useEffect(() => {
    if (!notifyEnabled) {
      lastCountRef.current = activeRuns.length;
      return;
    }
    if (lastCountRef.current > 0 && activeRuns.length === 0) {
      try {
        if (isNotificationApiAvailable() && Notification.permission === 'granted') {
          const note = new Notification('NexaFile — Sync abgeschlossen', {
            body: _(msg`Deine Belege sind bereit. Klick öffnet die Liste.`),
            icon: '/static/favicon.ico',
            silent: false,
          });
          note.onclick = () => {
            window.focus();
            note.close();
          };
        }
      } catch {
        // Notification kann blockieren oder fehlschlagen — egal, kein
        // Hard-Fail, der Sync ist fertig und der Banner verschwindet.
      }
    }
    lastCountRef.current = activeRuns.length;
  }, [activeRuns.length, notifyEnabled, _]);

  // Wenn der User den Banner schon einmal gesehen hat (mehrere Runs in einer
  // Sitzung), zeigen wir den Erklär-Text nur beim ersten Mal voll, danach
  // kompakt.
  const [hasBeenSeen, setHasBeenSeen] = useState(false);
  useEffect(() => {
    if (activeRuns.length > 0 && !hasBeenSeen) {
      setHasBeenSeen(true);
    }
  }, [activeRuns.length, hasBeenSeen]);

  if (activeRuns.length === 0) return null;

  const requestNotificationPermission = async () => {
    if (!isNotificationApiAvailable()) return;
    try {
      const permission = await Notification.requestPermission();
      const enabled = permission === 'granted';
      setNotifyEnabled(enabled);
      try {
        if (enabled) window.localStorage.setItem(NOTIFICATION_OPT_IN_KEY, '1');
      } catch {
        // Speicher gesperrt — fällt zurück auf Session-Default.
      }
    } catch {
      // Permission-Request ist fire-and-forget — wenn er fehlschlägt,
      // bleibt notifyEnabled false und der Banner zeigt den Button erneut.
    }
  };

  const disableNotification = () => {
    setNotifyEnabled(false);
    try {
      window.localStorage.removeItem(NOTIFICATION_OPT_IN_KEY);
    } catch {
      // s.o.
    }
  };

  return (
    <Card className="mb-3 flex flex-col gap-2 border-primary/40 bg-primary/5 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2">
          <Loader2Icon
            className="mt-0.5 h-5 w-5 flex-shrink-0 animate-spin text-primary"
            aria-hidden
          />
          <div>
            <p className="text-sm font-semibold">
              <Trans>Sync läuft im Hintergrund</Trans>
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              <Trans>
                Du kannst diese Seite jetzt schließen — wir laufen weiter und du siehst die Belege
                beim nächsten Besuch.
              </Trans>
            </p>
          </div>
        </div>

        {isNotificationApiAvailable() &&
          (notifyEnabled ? (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 text-xs"
              onClick={disableNotification}
              aria-label={_(msg`Benachrichtigung deaktivieren`)}
            >
              <CheckCircle2Icon className="h-3.5 w-3.5 text-emerald-600" aria-hidden />
              <Trans>Benachrichtigung aktiv</Trans>
              <XIcon className="ml-1 h-3 w-3" aria-hidden />
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="h-7 gap-1.5 text-xs"
              onClick={() => void requestNotificationPermission()}
            >
              <BellIcon className="h-3.5 w-3.5" aria-hidden />
              <Trans>Benachrichtige mich, wenn fertig</Trans>
            </Button>
          ))}
      </div>

      <ul className="space-y-1.5 border-t border-primary/20 pt-2 text-xs">
        {activeRuns.map((run) => {
          const elapsedMs = Date.now() - run.startedAt.getTime();
          const elapsedSec = Math.max(elapsedMs / 1000, 1);
          const ratePerMin = (run.mailsChecked / elapsedSec) * 60;
          const found = run.documentsAuto + run.documentsManual;
          return (
            <li key={run.id} className="flex flex-wrap items-center justify-between gap-x-3">
              <span className="font-medium text-foreground">{run.sourceLabel}</span>
              <span className="tabular-nums text-muted-foreground">
                <Trans>
                  {numberFmt.format(run.mailsChecked)} Mails geprüft · {numberFmt.format(found)}{' '}
                  Belege · {ratePerMin >= 10 ? Math.round(ratePerMin) : ratePerMin.toFixed(1)}{' '}
                  Mails/Min
                </Trans>
              </span>
            </li>
          );
        })}
      </ul>
    </Card>
  );
};
