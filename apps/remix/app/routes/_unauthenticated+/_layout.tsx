import { Link, Outlet } from 'react-router';

import backgroundPattern from '@nexasign/assets/images/background-pattern.png';

export default function Layout() {
  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden px-4 py-12 md:p-12 lg:p-24">
      <div>
        <div className="absolute -inset-[min(600px,max(400px,60vw))] -z-[1] flex items-center justify-center opacity-70">
          <img
            src={backgroundPattern}
            alt="background pattern"
            className="dark:brightness-95 dark:contrast-[70%] dark:invert dark:sepia"
            style={{
              mask: 'radial-gradient(rgba(255, 255, 255, 1) 0%, transparent 80%)',
              WebkitMask: 'radial-gradient(rgba(255, 255, 255, 1) 0%, transparent 80%)',
            }}
          />
        </div>

        {/* NexaFile-Wortmarke über dem Login-Formular — gibt allen öffentlichen
            Seiten (Signin, Signup, Forgot-Password, …) einen sichtbaren Brand-Anker. */}
        <Link
          to="/"
          className="relative mx-auto mb-8 flex items-center justify-center rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
          aria-label="NexaFile"
        >
          <picture>
            <source type="image/webp" srcSet="/logo-1x.webp 1x, /logo-2x.webp 2x" />
            <img
              src="/logo-1x.png"
              srcSet="/logo-1x.png 1x, /logo-2x.png 2x"
              alt="NexaFile"
              height={144}
              width={602}
              style={{ width: '300px', height: 'auto', display: 'block' }}
            />
          </picture>
        </Link>

        <div className="relative w-full">
          <Outlet />
        </div>
      </div>
    </main>
  );
}
