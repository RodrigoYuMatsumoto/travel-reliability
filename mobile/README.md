# Mobile delivery: installable PWA

v0.1 uses the responsive web app on mobile. There is no separate native iOS or
Android binary. The manifest, 192/512 icons and static-only service worker live
in `web/public` and the build script.

On a trusted HTTPS deployment, use the browser's install/add-to-home-screen
action. Installation availability depends on browser/OS support. The UI is
tested at desktop and Pixel-sized viewports; a mobile viewport test is not a
native-device certification.

Offline access requires first loading the static shell and explicitly exporting
an encrypted `.trb` evidence bundle. Open `/?offline=1`, select that file and
enter its passphrase. Decryption and hash verification happen in the browser.
Private API responses and plaintext evidence are never put in service-worker
caches. Keep the passphrase separately; losing it prevents recovery.
