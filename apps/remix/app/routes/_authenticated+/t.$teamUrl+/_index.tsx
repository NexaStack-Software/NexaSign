import { redirect } from 'react-router';

import type { Route } from './+types/_index';

// /t/{teamUrl} → Aufgaben-Start (vier Klartext-Tiles).
export function loader({ params }: Route.LoaderArgs) {
  throw redirect(`/t/${params.teamUrl}/aufgaben`);
}
