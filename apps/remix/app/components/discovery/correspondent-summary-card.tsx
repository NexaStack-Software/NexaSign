// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 NexaStack, NexaSign contributors
//
// CorrespondentSummaryCard — „Wer hat Ihnen Belege geschickt?".
// Wird in der Trefferliste UND im Hub angezogen, damit der Block nicht
// dupliziert wird.
import { Trans } from '@lingui/react/macro';
import { Link } from 'react-router';

import { trpc } from '@nexasign/trpc/react';
import { Card } from '@nexasign/ui/primitives/card';

type Props = {
  teamUrl: string;
};

export const CorrespondentSummaryCard = ({ teamUrl }: Props) => {
  const { data: correspondentSummary } = trpc.discovery.getCorrespondentSummary.useQuery();

  if (!correspondentSummary || correspondentSummary.entries.length === 0) {
    return null;
  }

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold">
            <Trans>Wer hat Ihnen Belege geschickt?</Trans>
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            <Trans>
              Pro Absender sehen Sie, wieviele Mails ein PDF dabei hatten und wieviele Sie manuell
              aus dem Portal ziehen müssen. Klick öffnet die Trefferliste mit Filter auf diesen
              Absender — dann arbeiten Sie sie am Stück ab.
            </Trans>
          </p>
        </div>
        {correspondentSummary.totalDistinct > correspondentSummary.entries.length && (
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
            <Trans>
              Top {correspondentSummary.entries.length} von {correspondentSummary.totalDistinct}
            </Trans>
          </span>
        )}
      </div>

      <div className="mt-4 overflow-hidden rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left font-medium">
                <Trans>Absender</Trans>
              </th>
              <th className="px-3 py-2 text-right font-medium">
                <Trans>Mit PDF</Trans>
              </th>
              <th className="px-3 py-2 text-right font-medium">
                <Trans>Nur Portal</Trans>
              </th>
              <th className="px-3 py-2 text-right font-medium">
                <Trans>Gesamt</Trans>
              </th>
              <th className="px-3 py-2 text-right font-medium">
                <Trans>Portal-Login</Trans>
              </th>
            </tr>
          </thead>
          <tbody>
            {correspondentSummary.entries.map((entry) => (
              <tr key={entry.correspondent} className="border-t hover:bg-muted/30">
                <td className="px-3 py-2">
                  <Link
                    to={`/t/${teamUrl}/find-documents?correspondent=${encodeURIComponent(entry.correspondent)}`}
                    className="font-medium text-foreground hover:underline"
                  >
                    {entry.correspondent}
                  </Link>
                  {entry.senderDomain && (
                    <span className="ml-2 text-xs text-muted-foreground">{entry.senderDomain}</span>
                  )}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                  {entry.withPdf}
                </td>
                <td
                  className={`px-3 py-2 text-right font-medium tabular-nums ${
                    entry.withoutPdf > 0 ? 'text-amber-700' : 'text-muted-foreground'
                  }`}
                >
                  {entry.withoutPdf}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{entry.total}</td>
                <td className="px-3 py-2 text-right">
                  {entry.portalUrl ? (
                    <a
                      href={entry.portalUrl}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                      title={entry.portalLabel ?? entry.portalUrl}
                    >
                      {entry.portalLabel ?? <Trans>Login öffnen</Trans>}
                      <span aria-hidden>↗</span>
                    </a>
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
};
