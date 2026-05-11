<?php
// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 NexaStack, NexaSign contributors. Based on NexaSign (AGPL-3.0).
/**
 * Gemeinsamer Header/Nav für alle NexaFILE-/Vorlagen-Seiten.
 * Layout-gleich zur Remix-App (app-header.tsx + app-nav-desktop.tsx): Logo,
 * Nav-Links, Search-Button, Inbox-Icon, Avatar-Slot. Auf den PHP-Seiten gibt es
 * keinen Login-State — Search/Inbox/Avatar sind daher reine Portal-Links in
 * die App (dort wird das Interaktive gerendert, wenn User eingeloggt ist).
 *
 * Erwartete Variablen vom Includer:
 *   $current_section — 'vorlagen' | 'gobd' (für active-State)
 */
$section = $current_section ?? '';
function nx_active(string $needle, string $haystack): string {
    return $needle === $haystack ? ' nx-nav-active' : '';
}

// Demo-Modus wird über die PHP-FPM-Env NEXASIGN_DEMO_MODE=1 im Pool
// [nexasign-demo] aktiviert. In Prod ist die Env nicht gesetzt — dann
// zeigen alle Portal-Links auf nexasign.nexastack.co wie bisher. In der
// Demo-Instanz zeigen sie auf die Demo-Subdomain, damit Entscheider nicht
// versehentlich in die Produktions-App rutschen.
$nx_is_demo   = getenv('NEXASIGN_DEMO_MODE') === '1';
$nx_app_base  = $nx_is_demo
    ? 'https://nexasign-demo.nexastack.co'
    : 'https://nexasign.nexastack.co';
?>
<?php if ($nx_is_demo): ?>
<style>
  .nx-demo-banner {
    background: #fff7ed;
    color: #7c2d12;
    border-bottom: 1px solid #fdba74;
    padding: 0.625rem 1rem;
    font: 500 0.875rem/1.4 system-ui, -apple-system, sans-serif;
    text-align: center;
  }
  .nx-demo-banner strong { font-weight: 700; }
  .nx-demo-banner a { color: #9a3412; text-decoration: underline; margin-left: 0.5rem; }
</style>
<div class="nx-demo-banner" role="status">
  <strong>Öffentliche Demo.</strong>
  Daten werden regelmäßig zurückgesetzt — keine vertraulichen Informationen eingeben.
  <a href="https://github.com/NexaStack-Software/NexaFile">Selbst hosten</a>
</div>
<?php endif; ?>
<style>
  /* Lokale Farbtokens, 1:1 zu NexaSigns theme.css — damit die Nav exakt
     dieselben Farben nutzt wie die App, unabhängig von den :root-Variablen
     der einbettenden PHP-Seite. */
  .nx-header {
    --nx-background:         #fdf9f3;
    --nx-foreground:         #1c1c18;
    --nx-muted:              #f1ede7;
    --nx-muted-foreground:   #44474d;
    --nx-border:             #e6d8cc;
    --nx-primary:            #9e4127;
    --nx-primary-foreground: #fdf9f3;

    position: sticky; top: 0; z-index: 60;
    width: 100%;
    padding: 1rem 0;                         /* py-4 = 15–16 px vertikale Luft */
    display: flex; align-items: center;
    background: rgba(253, 249, 243, 0.95);   /* bg-background/95 */
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    border-bottom: 1px solid transparent;    /* border-b-transparent, wird beim Scrollen sichtbar (optional) */
    transition: border-color 0.2s;
  }
  .nx-header-inner {
    width: 100%;
    max-width: 1280px;                       /* max-w-screen-xl */
    margin: 0 auto;
    padding: 0 1rem;                         /* px-4 */
    display: flex; align-items: center;
    justify-content: space-between;
    gap: 1rem;                                /* gap-x-4 */
  }
  @media (min-width: 768px) {
    .nx-header-inner { padding: 0 2rem; justify-content: flex-start; } /* md:px-8 md:justify-normal */
  }

  /* ─────── Logo ─────── */
  .nx-logo {
    display: none;                           /* hidden */
    align-items: center;
    border-radius: 0.375rem;                 /* rounded-md */
    flex-shrink: 0;
    text-decoration: none;
  }
  @media (min-width: 768px) { .nx-logo { display: inline-flex; } } /* md:inline-flex */
  /* Hoehe identisch zur Remix-AppHeader (apps/remix/app/components/general/app-header.tsx),
     damit die Logo-Groesse zwischen PHP-Vorlagen-Seiten und der Remix-App nicht springt.
     80px gewählt, weil ein 120px-hohes Logo (502px breit bei 4.18:1 Aspect) zusammen mit
     den 4 Nav-Links + Search-Button + Inbox + Avatar-Block die max-w-screen-xl (1280px)
     Header-Breite sprengt — Logo würde optisch in den Nav-Bereich gequetscht. */
  .nx-logo img { height: 80px; width: auto; display: block; }

  /* ─────── Mittelblock: Nav + Search (=AppNavDesktop) ─────── */
  .nx-nav-wrapper {
    display: none;
    margin-left: 2rem;                       /* ml-8 */
    flex: 1;
    align-items: center;
    gap: 3rem;                                /* gap-x-12 */
    justify-content: space-between;
  }
  @media (min-width: 768px) { .nx-nav-wrapper { display: flex; } }

  .nx-primary-nav,
  .nx-mobile-primary-nav {
    display: flex; align-items: baseline;
    gap: 1.5rem;                              /* gap-x-6 */
  }
  .nx-primary-nav a,
  .nx-mobile-primary-nav a {
    color: var(--nx-muted-foreground);
    text-decoration: none;
    font-weight: 500;                         /* font-medium */
    line-height: 1.25rem;                     /* leading-5 */
    border-radius: 0.375rem;                  /* rounded-md */
    transition: opacity 0.15s;
  }
  .nx-primary-nav a:hover,
  .nx-mobile-primary-nav a:hover { opacity: 0.8; }
  .nx-primary-nav a.nx-nav-active,
  .nx-mobile-primary-nav a.nx-nav-active { color: var(--nx-foreground); }

  .nx-mobile-primary-nav {
    width: 100%;
    padding: 0.75rem 1rem 0;
    overflow-x: auto;
    border-top: 1px solid var(--nx-border);
    background: rgba(253, 249, 243, 0.95);
  }
  .nx-mobile-primary-nav a {
    white-space: nowrap;
    font-size: 0.9375rem;
  }
  @media (min-width: 768px) { .nx-mobile-primary-nav { display: none; } }

  /* ─────── Search-Button (Portal-Link ins App-Command-Menu) ─────── */
  .nx-search-btn {
    display: flex; align-items: center; justify-content: space-between;
    width: 100%; max-width: 24rem;            /* max-w-96 */
    height: 2.5rem;                           /* h-10 */
    padding: 0 1rem;
    background: var(--nx-background);
    border: 1px solid var(--nx-border);
    border-radius: 0.5rem;                    /* rounded-lg */
    color: var(--nx-muted-foreground);
    font-size: 0.875rem;                      /* text-sm */
    text-decoration: none;
    transition: background 0.15s;
  }
  .nx-search-btn:hover { background: var(--nx-muted); }
  .nx-search-btn .nx-search-label { display: flex; align-items: center; gap: 0.5rem; }
  .nx-search-btn .nx-search-label svg { width: 1.25rem; height: 1.25rem; flex-shrink: 0; }
  .nx-shortcut {
    background: var(--nx-muted);
    color: var(--nx-muted-foreground);
    border-radius: 0.375rem;
    padding: 0.125rem 0.375rem;
    font-size: 0.75rem;
    letter-spacing: 0.025em;                  /* tracking-wider */
  }

  /* ─────── Inbox-Icon (Portal-Link in die App-Inbox) ─────── */
  .nx-inbox-btn {
    display: none;
    align-items: center; justify-content: center;
    height: 2.5rem; width: 2.5rem;            /* h-10 w-10 */
    border: 1px solid var(--nx-border);
    border-radius: 0.5rem;
    background: var(--nx-background);
    color: var(--nx-muted-foreground);
    text-decoration: none;
    flex-shrink: 0;
    transition: color 0.15s;
  }
  @media (min-width: 768px) { .nx-inbox-btn { display: flex; } }
  .nx-inbox-btn:hover { color: var(--nx-foreground); }
  .nx-inbox-btn svg { width: 1.25rem; height: 1.25rem; }

  /* ─────── Avatar-Platz: „Zur App"-Button ─────────────────────────────────
     Visuelles Pendant zur MenuSwitcher-Komponente in Remix
     (apps/remix/app/components/general/menu-switcher.tsx): h-12, ohne Border,
     Avatar-Kreis links + Text-Block (auf md+) + Chevron-Icon rechts.
     PHP hat keinen Server-Session-Kontext, daher kein User-Name — wir zeigen
     stattdessen das NS-Monogramm und „Zur App" als Sekundärtext. */
  .nx-app-btn {
    margin-left: 1rem;                        /* md:ml-4 */
    display: flex; align-items: center; gap: 0.5rem;
    height: 3rem;                             /* h-12 */
    padding: 0.5rem 0.5rem;                   /* py-2 md:px-2 */
    background: transparent;
    color: var(--nx-foreground);
    text-decoration: none;
    flex-shrink: 0;
    border: 0;
    transition: opacity 0.15s;
  }
  .nx-app-btn:hover { opacity: 0.85; }
  .nx-app-avatar {
    display: flex; align-items: center; justify-content: center;
    flex-shrink: 0;
    height: 2.25rem; width: 2.25rem;          /* h-9 w-9 — wie AvatarWithText */
    border-radius: 9999px;                    /* rounded-full */
    background: var(--nx-primary);
    color: var(--nx-primary-foreground);
    font-family: var(--nx-font-serif, 'Newsreader', Georgia, serif);
    font-size: 0.875rem; font-weight: 600;
    letter-spacing: -0.01em;
  }
  .nx-app-text {
    display: none;                            /* default hidden */
    flex-direction: column; align-items: flex-start;
    line-height: 1.1; gap: 0.125rem;
  }
  @media (min-width: 1024px) { .nx-app-text { display: flex; } } /* lg:flex */
  .nx-app-text-primary {
    font-size: 0.875rem; font-weight: 600;     /* AvatarWithText primary */
    color: var(--nx-foreground);
  }
  .nx-app-text-secondary {
    font-size: 0.75rem; font-weight: 400;
    color: var(--nx-muted-foreground);
  }
  .nx-app-chevron {
    margin-left: auto;
    flex-shrink: 0;
    height: 1rem; width: 1rem;
    color: var(--nx-muted-foreground);
  }
</style>
<header class="nx-header">
  <div class="nx-header-inner">

    <!-- Logo — führt in die App (analog zu app-header.tsx: getRootHref) -->
    <a href="<?= htmlspecialchars($nx_app_base) ?>/" class="nx-logo" aria-label="NexaSign">
      <picture>
        <source type="image/webp" srcset="/logo-1x.webp 1x, /logo-2x.webp 2x">
        <img src="/logo-1x.png" srcset="/logo-1x.png 1x, /logo-2x.png 2x"
             alt="NexaSign" width="335" height="80">
      </picture>
    </a>

    <!-- Nav-Wrapper (equivalent zu AppNavDesktop) -->
    <div class="nx-nav-wrapper">
      <nav class="nx-primary-nav">
        <a href="/vorlagen/" class="<?= nx_active('vorlagen', $section) ?>">Erstellen</a>
        <a href="<?= htmlspecialchars($nx_app_base) ?>/find-documents">Finden</a>
        <a href="<?= htmlspecialchars($nx_app_base) ?>/documents">Signieren</a>
        <a href="<?= htmlspecialchars($nx_app_base) ?>/archiv" class="<?= nx_active('gobd', $section) ?>">Archiv</a>
      </nav>

      <!-- Search-Button — Portal ins App-Command-Menu -->
      <a href="<?= htmlspecialchars($nx_app_base) ?>/" class="nx-search-btn" aria-label="Suche in der App öffnen">
        <span class="nx-search-label">
          <!-- lucide: search -->
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
               stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>
          </svg>
          <span>Suche</span>
        </span>
        <span class="nx-shortcut">Strg+K</span>
      </a>
    </div>

    <!-- Inbox-Icon — Portal zur App-Inbox -->
    <a href="<?= htmlspecialchars($nx_app_base) ?>/inbox" class="nx-inbox-btn" aria-label="Inbox öffnen">
      <!-- lucide: inbox -->
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
           stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/>
        <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>
      </svg>
    </a>

    <!-- Avatar-Platz — pendant zur MenuSwitcher in Remix.
         PHP kennt keinen Login-State: wir rendern keinen Fake-User, sondern
         das NS-Monogramm + „Zur App" als generischer App-Einstieg. Layout
         (Avatar links, Textblock auf lg+, Chevron rechts) entspricht exakt
         AvatarWithText (packages/ui/primitives/avatar.tsx). -->
    <a href="<?= htmlspecialchars($nx_app_base) ?>/" class="nx-app-btn" aria-label="Zur NexaSign-App">
      <span class="nx-app-avatar" aria-hidden="true">NS</span>
      <span class="nx-app-text">
        <span class="nx-app-text-primary">Zur App</span>
        <span class="nx-app-text-secondary">NexaSign</span>
      </span>
      <!-- lucide: chevrons-up-down (gleiches Icon wie MenuSwitcher) -->
      <svg class="nx-app-chevron" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
           stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="m7 15 5 5 5-5"/><path d="m7 9 5-5 5 5"/>
      </svg>
    </a>

  </div>
</header>
<nav class="nx-mobile-primary-nav" aria-label="Hauptnavigation">
  <a href="/vorlagen/" class="<?= nx_active('vorlagen', $section) ?>">Erstellen</a>
  <a href="<?= htmlspecialchars($nx_app_base) ?>/find-documents">Finden</a>
  <a href="<?= htmlspecialchars($nx_app_base) ?>/documents">Signieren</a>
  <a href="<?= htmlspecialchars($nx_app_base) ?>/archiv" class="<?= nx_active('gobd', $section) ?>">Archiv</a>
</nav>
