// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 NexaStack, NexaFile contributors
import type { DiscoveryDocumentStatus, Prisma } from '@prisma/client';

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

export const buildDiscoveryExportWhere = ({
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
        { detectedInvoiceNumber: { contains: query, mode: 'insensitive' } },
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
