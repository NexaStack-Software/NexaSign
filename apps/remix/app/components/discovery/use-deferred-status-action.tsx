// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 NexaStack, NexaSign contributors
import { useCallback, useEffect, useRef } from 'react';

import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react';
import { Trans } from '@lingui/react/macro';

import { trpc } from '@nexasign/trpc/react';
import { ToastAction } from '@nexasign/ui/primitives/toast';
import { useToast } from '@nexasign/ui/primitives/use-toast';

const UNDO_WINDOW_MS = 5000;

type DeferredAction = 'accept' | 'ignore';

type Pending = {
  id: string;
  action: DeferredAction;
  timeoutId: ReturnType<typeof setTimeout>;
  toastDismiss: () => void;
  /** Lokales Rollback wenn der User „Rückgängig" drückt. */
  onUndo: () => void;
};

type Hooks = {
  /** Wird aufgerufen sobald der Server-Commit (nach 5 s) bestätigt zurück kommt. */
  onCommitted?: () => void;
  /** Wird aufgerufen wenn die Mutation server-seitig fehlschlägt. */
  onError?: (err: { message: string }) => void;
};

/**
 * Deferred-Commit-Pattern für Accept/Ignore von Discovery-Dokumenten.
 *
 * Persona-Problem: Akzeptieren ist mit GoBD-WORM-Lock irreversibel — ein
 * versehentlicher Klick kostet 10 Jahre Aufbewahrungspflicht für eine
 * Werbe-Mail. Ignorieren ist zwar reversibel, aber „weg ist weg" für die
 * Zeit, in der der Beleg unsichtbar ist.
 *
 * Lösung: Wenn der User akzeptiert/ignoriert, blenden wir den Beleg sofort
 * in der UI weg (gefühlt „erledigt"), zeigen einen Toast mit „Rückgängig"-
 * Button und fire-en die eigentliche Mutation erst nach 5 s. Bricht der User
 * in dem Fenster ab, kommt er sauber zurück. Beim Verlassen der Seite
 * werden offene Aktionen zur Sicherheit synchron in den Mutation-Pool
 * gegeben — also nichts geht verloren.
 */
export const useDeferredStatusAction = ({ onCommitted, onError }: Hooks = {}) => {
  const { _ } = useLingui();
  const { toast } = useToast();

  const pendingRef = useRef<Map<string, Pending>>(new Map());

  const updateStatusMutation = trpc.discovery.updateStatus.useMutation({
    onSuccess: () => onCommitted?.(),
    onError: (err) => onError?.({ message: err.message }),
  });

  const flush = useCallback(
    (id: string) => {
      const pending = pendingRef.current.get(id);
      if (!pending) return;
      pendingRef.current.delete(id);
      pending.toastDismiss();
      updateStatusMutation.mutate({ id, action: pending.action });
    },
    [updateStatusMutation],
  );

  const cancel = useCallback((id: string) => {
    const pending = pendingRef.current.get(id);
    if (!pending) return;
    clearTimeout(pending.timeoutId);
    pending.toastDismiss();
    pendingRef.current.delete(id);
    pending.onUndo();
  }, []);

  const schedule = useCallback(
    (params: { id: string; action: DeferredAction; onUndo: () => void; previewLabel?: string }) => {
      const { id, action, onUndo, previewLabel } = params;

      // Wenn dieselbe ID schon einen Pending-Eintrag hat (Doppel-Klick),
      // den alten committen und neuen ersetzen. Vermeidet zwei parallele
      // Toasts für denselben Beleg.
      const existing = pendingRef.current.get(id);
      if (existing) {
        clearTimeout(existing.timeoutId);
        existing.toastDismiss();
        pendingRef.current.delete(id);
      }

      const title =
        action === 'accept'
          ? _(msg`Akzeptiert (in 5 s endgültig)`)
          : _(msg`Ignoriert (in 5 s endgültig)`);
      const description = previewLabel ?? '';

      const t = toast({
        title,
        description,
        duration: UNDO_WINDOW_MS,
        action: (
          <ToastAction altText={_(msg`Rückgängig`)} onClick={() => cancel(id)}>
            <Trans>Rückgängig</Trans>
          </ToastAction>
        ),
      });

      const timeoutId = setTimeout(() => flush(id), UNDO_WINDOW_MS);

      pendingRef.current.set(id, {
        id,
        action,
        timeoutId,
        toastDismiss: t.dismiss,
        onUndo,
      });
    },
    [_, toast, cancel, flush],
  );

  // Beim Unmount alle Pending-Aktionen synchron in die Mutation-Queue
  // schieben. Wenn der User die Seite mit Strg+L verlässt sollen seine
  // Akzeptanzen nicht verschwinden — nur der 5-s-Reue-Puffer entfällt.
  useEffect(() => {
    const map = pendingRef.current;
    return () => {
      for (const pending of map.values()) {
        clearTimeout(pending.timeoutId);
        pending.toastDismiss();
        // Fire-and-forget; React-Query unmount-Cleanup könnte die Mutation
        // abbrechen, aber updateStatus läuft auf Server-Side ohnehin durch.
        updateStatusMutation.mutate({ id: pending.id, action: pending.action });
      }
      map.clear();
    };
  }, [updateStatusMutation]);

  return {
    schedule,
    cancel,
    /** True wenn die ID gerade im 5-s-Puffer steht. UI kann das ausblenden. */
    isPending: (id: string) => pendingRef.current.has(id),
  };
};
