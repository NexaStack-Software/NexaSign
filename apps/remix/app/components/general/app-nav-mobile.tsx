import { useMemo } from 'react';

import { useLingui } from '@lingui/react/macro';
import { Trans } from '@lingui/react/macro';
import { ReadStatus } from '@prisma/client';
import { Link } from 'react-router';

import LogoImage from '@nexasign/assets/logo.png';
import { authClient } from '@nexasign/auth/client';
import { useSession } from '@nexasign/lib/client-only/providers/session';
import { isPersonalLayout } from '@nexasign/lib/utils/organisations';
import { trpc } from '@nexasign/trpc/react';
import { Sheet, SheetContent } from '@nexasign/ui/primitives/sheet';
import { ThemeSwitcher } from '@nexasign/ui/primitives/theme-switcher';

import { useOptionalCurrentTeam } from '~/providers/team';

export type AppNavMobileProps = {
  isMenuOpen: boolean;
  onMenuOpenChange?: (_value: boolean) => void;
};

export const AppNavMobile = ({ isMenuOpen, onMenuOpenChange }: AppNavMobileProps) => {
  const { t } = useLingui();

  const { organisations } = useSession();

  const currentTeam = useOptionalCurrentTeam();

  const { data: unreadCountData } = trpc.document.inbox.getCount.useQuery(
    {
      readStatus: ReadStatus.NOT_OPENED,
    },
    {
      // refetchInterval: 30000, // Refetch every 30 seconds
    },
  );

  const handleMenuItemClick = () => {
    onMenuOpenChange?.(false);
  };

  const menuNavigationLinks = useMemo(() => {
    let teamUrl = currentTeam?.url || null;

    if (!teamUrl && isPersonalLayout(organisations)) {
      teamUrl = organisations[0].teams[0]?.url || null;
    }

    if (!teamUrl) {
      return [
        {
          href: '/inbox',
          text: t`Inbox`,
        },
        {
          href: '/settings/profile',
          text: t`Settings`,
        },
      ];
    }

    // NexaFile-Hauptnavigation in 4 Schritten: Erstellen → Finden →
    // Signieren → Archivieren. Templates (Signier-Vorlagen) bleiben per Direkt-URL
    // /t/<team>/templates erreichbar, stehen aber nicht in der Haupt-Nav.
    return [
      {
        href: '/vorlagen/',
        text: t`Erstellen`,
        external: true,
      },
      {
        href: `/t/${teamUrl}/find-documents`,
        text: t`Finden`,
      },
      {
        href: `/t/${teamUrl}/documents`,
        text: t`Signieren`,
      },
      {
        href: `/t/${teamUrl}/archiv`,
        text: t`Archiv`,
      },
      {
        href: '/inbox',
        text: t`Inbox`,
      },
      {
        href: '/settings/profile',
        text: t`Settings`,
      },
    ];
  }, [currentTeam, organisations]);

  return (
    <Sheet open={isMenuOpen} onOpenChange={onMenuOpenChange}>
      <SheetContent className="flex w-full max-w-[350px] flex-col">
        <Link to="/" onClick={handleMenuItemClick}>
          <img
            src={LogoImage}
            alt="NexaFile Logo"
            className="dark:invert"
            width={170}
            height={25}
          />
        </Link>

        <div className="mt-8 flex w-full flex-col items-start gap-y-4">
          {menuNavigationLinks.map((link) =>
            'external' in link && link.external ? (
              <a
                key={link.href}
                className="flex items-center gap-2 text-2xl font-semibold text-foreground hover:text-foreground/80"
                href={link.href}
                onClick={() => handleMenuItemClick()}
              >
                {link.text}
              </a>
            ) : (
              <Link
                key={link.href}
                className="flex items-center gap-2 text-2xl font-semibold text-foreground hover:text-foreground/80"
                to={link.href}
                onClick={() => handleMenuItemClick()}
              >
                {link.text}
                {link.href === '/inbox' && unreadCountData && unreadCountData.count > 0 && (
                  <span className="flex h-6 min-w-[1.5rem] items-center justify-center rounded-full bg-primary px-1.5 text-xs font-semibold text-primary-foreground">
                    {unreadCountData.count > 99 ? '99+' : unreadCountData.count}
                  </span>
                )}
              </Link>
            ),
          )}

          <button
            className="text-2xl font-semibold text-foreground hover:text-foreground/80"
            onClick={async () => authClient.signOut()}
          >
            <Trans>Sign Out</Trans>
          </button>
        </div>

        <div className="mt-auto flex w-full flex-col space-y-4 self-end">
          <div className="w-fit">
            <ThemeSwitcher />
          </div>

          <p className="text-sm text-muted-foreground">
            © {new Date().getFullYear()} NexaStack
            <br />
            <Trans>All rights reserved.</Trans>
          </p>
        </div>
      </SheetContent>
    </Sheet>
  );
};
