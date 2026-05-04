// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 NexaStack, NexaSign contributors
import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react';
import { Trans } from '@lingui/react/macro';
import { ArrowRightIcon, KeyboardIcon, SparklesIcon } from 'lucide-react';
import { Link } from 'react-router';

import type { TGetOverviewResponse } from '@nexasign/trpc/server/discovery-router/schema';
import { Button } from '@nexasign/ui/primitives/button';
import { Card } from '@nexasign/ui/primitives/card';

import { SmartBulkAcceptDialog } from '~/components/dialogs/smart-bulk-accept-dialog';

type Props = {
  overview: TGetOverviewResponse;
  reviewHref: string;
  locale: string;
};

/**
 * Hero-Card oben auf der Find-Documents-Seite. Erstes was der Nutzer nach
 * dem Sync sieht — schafft den „es hat funktioniert"-Moment, fasst die
 * Dimension zusammen, schiebt den Nutzer in den Schnell-Review-Modus.
 *
 * Wird ausgeblendet wenn `overview.total === 0` (Empty-State separat).
 */
export const SyncOverviewCard = ({ overview, reviewHref, locale }: Props) => {
  const { _ } = useLingui();

  if (overview.total === 0) return null;

  const dateFmt = new Intl.DateTimeFormat(locale, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
  const numberFmt = new Intl.NumberFormat(locale);
  const currencyFmt = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: 0,
  });
  const monthFmt = new Intl.DateTimeFormat(locale, {
    month: 'long',
    year: 'numeric',
  });

  const totalEur = overview.estimatedTotalCents / 100;
  const rangeText = (() => {
    if (!overview.rangeFrom || !overview.rangeTo) return null;
    return `${dateFmt.format(overview.rangeFrom)} – ${dateFmt.format(overview.rangeTo)}`;
  })();

  return (
    <Card className="relative mb-6 overflow-hidden border-primary/30 bg-gradient-to-br from-primary/5 via-background to-background p-6">
      <div className="absolute right-6 top-6 hidden md:block">
        <SparklesIcon className="h-8 w-8 text-primary/40" aria-hidden />
      </div>

      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium text-primary">
          <Trans>Dein Beleg-Archiv</Trans>
        </p>
        <h2 className="text-2xl font-semibold leading-tight md:text-3xl">
          <Trans>{numberFmt.format(overview.total)} Belege gefunden</Trans>
          {overview.estimatedTotalCents > 0 && (
            <>
              {' · '}
              <span className="text-muted-foreground">≈ {currencyFmt.format(totalEur)}</span>
            </>
          )}
        </h2>
        {rangeText && (
          <p className="text-sm text-muted-foreground">
            <Trans>Zeitraum: {rangeText}</Trans>
            {overview.lastCompletedSyncAt && (
              <>
                {' · '}
                <Trans>Letzter Sync: {monthFmt.format(overview.lastCompletedSyncAt)}</Trans>
              </>
            )}
          </p>
        )}
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat
          label={_(msg`Mit Anhang`)}
          value={numberFmt.format(overview.downloadable)}
          tone="positive"
        />
        <Stat
          label={_(msg`Mit erkanntem Betrag`)}
          value={numberFmt.format(overview.withAmount)}
          tone="neutral"
        />
        <Stat
          label={_(msg`Noch zu prüfen`)}
          value={numberFmt.format(overview.needsReview)}
          tone={overview.needsReview > 0 ? 'attention' : 'neutral'}
        />
        <Stat
          label={_(msg`Akzeptiert`)}
          value={numberFmt.format(overview.accepted)}
          tone="positive"
        />
      </dl>

      {overview.yearDistribution.length > 1 && (
        <YearDistributionBar distribution={overview.yearDistribution} />
      )}

      {overview.needsReview > 0 && (
        <div className="mt-5 flex flex-col gap-3 rounded-md bg-primary/10 px-4 py-3 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0">
            <p className="text-sm font-medium">
              <Trans>
                {numberFmt.format(overview.needsReview)} Belege warten auf deine Prüfung.
              </Trans>
            </p>
            <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
              <KeyboardIcon className="h-3 w-3" aria-hidden />
              <Trans>Mit Tastenkürzeln (J/K/A/I) bist du in wenigen Minuten durch.</Trans>
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <SmartBulkAcceptDialog
              locale={locale}
              triggerVariant="outline"
              triggerLabel={<Trans>Vollständige in einem Klick</Trans>}
            />
            <Button asChild size="sm">
              <Link to={reviewHref}>
                <Trans>Schnell-Review starten</Trans>
                <ArrowRightIcon className="ml-2 h-4 w-4" aria-hidden />
              </Link>
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
};

const Stat = ({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: 'neutral' | 'positive' | 'attention';
}) => {
  const valueClass =
    tone === 'positive'
      ? 'text-emerald-700 dark:text-emerald-400'
      : tone === 'attention'
        ? 'text-amber-700 dark:text-amber-400'
        : 'text-foreground';
  return (
    <div className="flex flex-col gap-0.5 rounded-md bg-background/50 px-3 py-2 ring-1 ring-border/50">
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className={`text-xl font-semibold tabular-nums ${valueClass}`}>{value}</dd>
    </div>
  );
};

/**
 * Mini-Balken-Verteilung pro Jahr. Bewusst dezent — die Wow-Card ist die
 * Übersicht, die Details kommen in der Tabelle/Filterung.
 */
const YearDistributionBar = ({
  distribution,
}: {
  distribution: TGetOverviewResponse['yearDistribution'];
}) => {
  const max = Math.max(...distribution.map((d) => d.count));
  return (
    <div className="mt-5">
      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        <Trans>Verteilung pro Jahr</Trans>
      </p>
      <div className="flex items-stretch gap-2">
        {[...distribution].reverse().map((d) => {
          const heightPx = max > 0 ? Math.max(6, Math.round((d.count / max) * 48)) : 6;
          return (
            <div key={d.year} className="flex flex-1 flex-col items-center gap-1">
              <div className="flex h-12 w-full items-end">
                <div
                  className="w-full rounded-sm bg-primary/40"
                  style={{ height: `${heightPx}px` }}
                  title={`${d.year}: ${d.count}`}
                  aria-label={`${d.year}: ${d.count}`}
                />
              </div>
              <div className="text-[10px] tabular-nums text-muted-foreground">{d.year}</div>
              <div className="text-xs font-medium tabular-nums">{d.count}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
