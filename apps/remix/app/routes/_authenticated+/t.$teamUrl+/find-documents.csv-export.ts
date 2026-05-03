// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 NexaStack, NexaFile contributors
//
// CSV-Export für die aktuelle Filter-Sicht von „Dokumente finden". Liefert
// ALLE gefilterten Belege, nicht nur die aktuelle Page (PAGE_SIZE=25). Der
// frühere clientseitige Export hat nur die sichtbaren 25 Belege exportiert,
// was bei der Steuer-Nachhol-Persona mit oft 200+ Belegen zu stillem
// Datenverlust führte.
//
// Auth-Modell und Filter-Parsing sind identisch zu `find-documents.tax-package.ts`.
import type { DiscoveryDocumentStatus, Prisma } from '@prisma/client';

import { getSession } from '@nexasign/auth/server/lib/utils/get-session';
import { getTeamByUrl } from '@nexasign/lib/server-only/team/get-team';
import { prisma } from '@nexasign/prisma';

import type { Route } from './+types/find-documents.csv-export';

const UI_TO_NATIVE_STATUS: Record<string, DiscoveryDocumentStatus[]> = {
  inbox: ['INBOX'],
  'pending-manual': ['PENDING_MANUAL'],
  accepted: ['ACCEPTED', 'SIGNED'],
  archived: ['ARCHIVED'],
  ignored: ['IGNORED'],
  processed: ['ACCEPTED', 'SIGNED', 'ARCHIVED', 'IGNORED'],
};

const parseDate = (value: string | null): Date | undefined => {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
};

const appendAnd = (
  where: Prisma.DiscoveryDocumentWhereInput,
  condition: Prisma.DiscoveryDocumentWhereInput,
) => {
  const current = Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : [];
  where.AND = [...current, condition];
};

const intersectStatus = (
  left: DiscoveryDocumentStatus[] | undefined,
  right: DiscoveryDocumentStatus[],
): DiscoveryDocumentStatus[] => {
  if (!left) return right;
  return left.filter((status) => right.includes(status));
};

const setStatusWhere = (
  where: Prisma.DiscoveryDocumentWhereInput,
  statuses: DiscoveryDocumentStatus[],
) => {
  const current =
    typeof where.status === 'object' && 'in' in where.status && Array.isArray(where.status.in)
      ? where.status.in
      : undefined;
  where.status = { in: intersectStatus(current, statuses) };
};

const buildWhere = ({
  userId,
  teamId,
  url,
}: {
  userId: number;
  teamId: number;
  url: URL;
}): Prisma.DiscoveryDocumentWhereInput => {
  const where: Prisma.DiscoveryDocumentWhereInput = {
    teamId,
    OR: [{ providerSource: 'local' }, { uploadedById: userId }],
  };

  const status = url.searchParams.get('status');
  if (status && status !== 'all' && UI_TO_NATIVE_STATUS[status]) {
    setStatusWhere(where, UI_TO_NATIVE_STATUS[status]);
  }

  const query = url.searchParams.get('query')?.trim();
  if (query) {
    appendAnd(where, {
      OR: [
        { title: { contains: query, mode: 'insensitive' } },
        { correspondent: { contains: query, mode: 'insensitive' } },
      ],
    });
  }

  const from = parseDate(url.searchParams.get('documentDateFrom'));
  const to = parseDate(url.searchParams.get('documentDateTo'));
  if (from || to) {
    where.documentDate = { gte: from, lt: to };
  }

  const qualityFilter = url.searchParams.get('qualityFilter');
  if (qualityFilter === 'needs-review') {
    setStatusWhere(where, ['INBOX', 'PENDING_MANUAL']);
  }
  if (qualityFilter === 'downloadable') {
    appendAnd(where, {
      archivePath: { not: null },
      artifacts: { some: { kind: 'ATTACHMENT' } },
    });
  }
  if (qualityFilter === 'missing-amount') {
    where.detectedAmount = null;
  }
  if (qualityFilter === 'missing-invoice-number') {
    where.detectedInvoiceNumber = null;
  }

  return where;
};

const csvEscape = (val: string | null | undefined): string => {
  if (val == null) return '';
  if (/[",\n;]/.test(val)) return `"${val.replace(/"/g, '""')}"`;
  return val;
};

const formatIsoDate = (date: Date | null): string => (date ? date.toISOString().slice(0, 10) : '');

export async function loader({ request, params }: Route.LoaderArgs) {
  const { user } = await getSession(request);
  const team = await getTeamByUrl({
    userId: user.id,
    teamUrl: params.teamUrl,
  });
  const url = new URL(request.url);
  const where = buildWhere({ userId: user.id, teamId: team.id, url });

  const documents = await prisma.discoveryDocument.findMany({
    where,
    select: {
      title: true,
      correspondent: true,
      documentDate: true,
      capturedAt: true,
      detectedAmount: true,
      detectedInvoiceNumber: true,
      status: true,
      acceptedAt: true,
      acceptedBy: { select: { name: true } },
      source: { select: { label: true } },
      _count: { select: { artifacts: true } },
    },
    orderBy: [{ documentDate: 'asc' }, { capturedAt: 'asc' }],
  });

  const header = [
    'Datum',
    'Korrespondent',
    'Betreff',
    'Betrag',
    'Rechnungs-Nr',
    'Status',
    'Quelle',
    'Akzeptiert am',
    'Akzeptiert von',
    'Hat Anhang',
  ];

  const rows = documents.map((d) => [
    formatIsoDate(d.documentDate ?? d.capturedAt),
    d.correspondent ?? '',
    d.title,
    d.detectedAmount ?? '',
    d.detectedInvoiceNumber ?? '',
    d.status,
    d.source?.label ?? '',
    formatIsoDate(d.acceptedAt),
    d.acceptedBy?.name ?? '',
    d._count.artifacts > 3 ? 'ja' : 'nein',
  ]);

  const csv = [header, ...rows].map((row) => row.map(csvEscape).join(';')).join('\r\n');
  // BOM für Excel-Kompatibilität auf deutschen Systemen.
  const body = `\uFEFF${csv}`;

  const today = new Date().toISOString().slice(0, 10);
  const filename = `belege-${today}-${documents.length}.csv`;

  return new Response(body, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
