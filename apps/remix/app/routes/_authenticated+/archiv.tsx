import { redirect } from 'react-router';
import type { LoaderFunctionArgs } from 'react-router';

import { getPreferredTeamUrlOrRedirect } from '~/utils/redirect-to-preferred-team.server';

export async function loader({ request }: LoaderFunctionArgs) {
  const teamUrl = await getPreferredTeamUrlOrRedirect(request);

  throw redirect(`/t/${teamUrl}/archiv`);
}
