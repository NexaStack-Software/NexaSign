// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 NexaStack, NexaSign contributors
import { promises as fs } from 'node:fs';
import path from 'node:path';

import { getSession } from '@nexasign/auth/server/lib/utils/get-session';
import { getAbsoluteArchivePath } from '@nexasign/lib/server-only/sources/archive';
import { getTeamByUrl } from '@nexasign/lib/server-only/team/get-team';
import { prisma } from '@nexasign/prisma';

import type { Route } from './+types/find-documents.$id.artifacts.$artifactId';

const dispositionHeader = (fileName: string, inline: boolean): string => {
  const safe = fileName.replace(/["\r\n]/g, '_');
  return `${inline ? 'inline' : 'attachment'}; filename="${safe}"`;
};

export async function loader({ request, params }: Route.LoaderArgs) {
  const { user } = await getSession(request);
  const inline = new URL(request.url).searchParams.get('inline') === '1';
  const team = await getTeamByUrl({
    userId: user.id,
    teamUrl: params.teamUrl,
  });

  const artifact = await prisma.discoveryArtifact.findFirst({
    where: {
      id: params.artifactId,
      discoveryDocument: {
        id: params.id,
        teamId: team.id,
        OR: [{ providerSource: 'local' }, { uploadedById: user.id }],
      },
    },
    include: {
      discoveryDocument: { select: { archivePath: true } },
    },
  });

  if (!artifact || !artifact.discoveryDocument.archivePath) {
    throw new Response('Not Found', { status: 404 });
  }

  const archiveDir = path.resolve(getAbsoluteArchivePath(artifact.discoveryDocument.archivePath));
  const filePath = path.resolve(archiveDir, artifact.relativePath);
  const archivePrefix = `${archiveDir}${path.sep}`;

  if (!filePath.startsWith(archivePrefix)) {
    throw new Response('Invalid artifact path', { status: 400 });
  }

  const content = await fs.readFile(filePath).catch(() => null);
  if (!content) {
    throw new Response('Not Found', { status: 404 });
  }

  return new Response(content, {
    headers: {
      'Content-Type': artifact.contentType,
      'Content-Length': String(content.length),
      'Content-Disposition': dispositionHeader(artifact.fileName, inline),
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
