// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 NexaStack, NexaFile contributors
import { getSession } from '@nexasign/auth/server/lib/utils/get-session';
import { getTeamByUrl } from '@nexasign/lib/server-only/team/get-team';
import { prisma } from '@nexasign/prisma';

import { buildDiscoveryExportWhere } from '~/utils/discovery-export-filters.server';
import {
  MAX_DOCUMENTS_PER_ZIP,
  buildDiscoveryDocumentsZip,
  discoveryZipFileName,
} from '~/utils/discovery-export.server';

import type { Route } from './+types/find-documents.zip-attachments';

export async function loader({ request, params }: Route.LoaderArgs) {
  const { user } = await getSession(request);
  const team = await getTeamByUrl({
    userId: user.id,
    teamUrl: params.teamUrl,
  });

  const url = new URL(request.url);
  const ids = (url.searchParams.get('ids') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  if (ids.length > MAX_DOCUMENTS_PER_ZIP) {
    throw new Response(`Zu viele Belege auf einmal (max ${MAX_DOCUMENTS_PER_ZIP}).`, {
      status: 400,
    });
  }

  const where =
    ids.length > 0
      ? {
          id: { in: ids },
          teamId: team.id,
          OR: [{ providerSource: 'local' as const }, { uploadedById: user.id }],
        }
      : buildDiscoveryExportWhere({ userId: user.id, teamId: team.id, url });

  const documents = await prisma.discoveryDocument.findMany({
    where,
    select: {
      id: true,
      title: true,
      correspondent: true,
      documentDate: true,
      capturedAt: true,
      detectedInvoiceNumber: true,
      archivePath: true,
      artifacts: {
        select: {
          kind: true,
          fileName: true,
          fileSize: true,
          relativePath: true,
        },
      },
    },
    orderBy: [{ documentDate: 'asc' }, { capturedAt: 'asc' }],
    take: MAX_DOCUMENTS_PER_ZIP + 1,
  });

  if (documents.length === 0) {
    throw new Response('Keine Belege fuer den ZIP-Export gefunden.', { status: 404 });
  }
  if (documents.length > MAX_DOCUMENTS_PER_ZIP) {
    throw new Response(`Zu viele Belege auf einmal (max ${MAX_DOCUMENTS_PER_ZIP}).`, {
      status: 400,
    });
  }

  const { buffer, documentsAdded } = await buildDiscoveryDocumentsZip({
    title: 'NexaFile ZIP-Export',
    documents,
  });

  return new Response(buffer, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Length': String(buffer.length),
      'Content-Disposition': `attachment; filename="${discoveryZipFileName('belege', documentsAdded)}"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
