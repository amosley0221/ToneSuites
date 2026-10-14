# Setting up Tone Suites

This guide covers installing the apps, connecting your UGREEN NAS and Google Drive, and the
one-time GitHub setup that lets releases build and update in place.

---

## 1. One-time: GitHub secrets (needed before the first release)

The release workflow signs every build. Signing keys never live in the repo — they are
GitHub Actions secrets. In **github.com/amosley0221/ToneSuites → Settings → Secrets and
variables → Actions → New repository secret**, add:

| Secret | Value |
| --- | --- |
| `TAURI_SIGNING_PRIVATE_KEY` | Contents of `tone-updater.key` (the desktop update signing key) |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Its password |
| `ANDROID_KEYSTORE_BASE64` | The Android keystore (`tone-release.jks`) as base64 |
| `ANDROID_KEYSTORE_PASSWORD` | Keystore password |

The matching **public** update key is already in `src-tauri/tauri.conf.json`.

> **Back up the keystore and both passwords** (password manager + offline copy).
> Android only installs an update over the existing app when it is signed with the *same* key.
> If the key is lost, every device has to uninstall once and reinstall. The same goes for the
> desktop update key: if it's lost, desktop apps can't verify updates.

## 2. Releasing a new version

Every change adds notes under `## [Unreleased]` in `CHANGELOG.md`. To release:

```bash
npm run release -- patch --push      # or minor / major / 1.4.0
```

This moves the Unreleased notes under the new version, bumps the version everywhere, commits,
tags `vX.Y.Z` and pushes. The **Release** workflow then:

1. creates a draft GitHub Release whose description is that version's CHANGELOG section,
2. builds the Windows installer (NSIS) and macOS app (universal `.dmg` + updater bundle),
3. builds and signs the Android APK (`ToneSuites-X.Y.Z.apk`),
4. publishes the release (marked *latest*).

Then:

- **Windows/macOS** apps find the update on launch (and every 6 h), show the update notes and
  restart into the new version. You never uninstall.
- **Android**: Vault sees the new APK on the release page; installing it upgrades in place.
  The app also checks the release itself and offers the download.
- After updating, each app shows **What's new** with the same notes.

## 3. Installing

| Platform | File on the release page | Notes |
| --- | --- | --- |
| Windows | `Tone Suites_X.Y.Z_x64-setup.exe` | The build isn't code-signed, so SmartScreen may say "Windows protected your PC": click **More info → Run anyway**. Updates after that install silently. |
| macOS | `Tone Suites_X.Y.Z_universal.dmg` | Not notarized (that needs a paid Apple Developer account). First launch: open it once, then **System Settings → Privacy & Security → Open Anyway**. Updates after that install in place. |
| Android | `ToneSuites-X.Y.Z.apk` | Install through Vault. Android 10 or newer. |

## 4. UGREEN NAS (DH2300) over WebDAV

Tone syncs your workspace folder to the NAS over **WebDAV**, which works on Windows, macOS and
Android without mounting drives.

1. In **UGOS Pro**, open **Control Panel → File Services → WebDAV** and enable it (HTTP and/or
   HTTPS). Note the port it shows.
2. Create a shared folder (or use an existing one) and, inside it, a folder for Tone, e.g.
   `Documents/Tone`. Make sure your NAS user has read/write access to it.
3. In Tone: **Settings (⚙) → Sync → + NAS / WebDAV**
   - Name: e.g. `Home NAS`
   - Address: `http://<NAS IP>:<port>/<shared folder>/Tone`, e.g. `http://192.168.1.50:5005/Documents/Tone`
   - Username / password: your UGOS account (the password is stored only on that device)
   - **Test connection**, then **Save**.
4. Repeat on each device (same address and folder). Devices then show up on Home.

**If your DH2300's UGOS Pro has no WebDAV option**, use your always-on Plex PC as the bridge:
map the NAS share on that PC and serve it over WebDAV, e.g. with rclone:
`rclone serve webdav "\\NAS\Documents\Tone" --addr :8080 --user <user> --pass <pass>` (run it as a
startup task). Then use `http://<Plex PC IP>:8080` as the address in Tone.

### Syncing away from home (Tailscale)

WebDAV on your home network isn't reachable from outside. Don't open router ports. Use
**Tailscale** instead (free for personal use):

- Install Tailscale on your Windows PC, Mac and Android phone and sign in with the same account.
- If the NAS can run Tailscale (UGOS App Center or Docker), install it there and use its Tailscale IP
  (`100.x.y.z`) in the Tone address.
- Otherwise, install Tailscale on the **Plex PC** and turn on **subnet routing** for your home
  network (e.g. `192.168.1.0/24`; approve it in the Tailscale admin console). Your devices then
  reach the NAS's normal LAN address from anywhere, so the same Tone address works at home and
  away.

When the NAS can't be reached, Tone keeps working locally and syncs the queued changes when
it can.

## 5. Google Drive

Tone uses your own Google Cloud OAuth client (free), so no third party is involved.

1. Go to <https://console.cloud.google.com/> and create a project named e.g. **Tone Suites**.
2. **APIs & Services → Library → Google Drive API → Enable.**
3. **Google Auth Platform** (OAuth consent screen):
   - Branding: app name `Tone Suites`, your email as support and developer contact.
   - Audience: **External**. Add your Google account as a test user, then click **Publish app**
     so it's *In production*. Test-mode sign-ins expire every 7 days. Because the app is
     unverified, Google shows a warning when you sign in: click **Advanced → Go to Tone Suites**.
   - Data access: add the scope `https://www.googleapis.com/auth/drive`.
4. **Clients → Create client → Application type: Desktop app.** Copy the **Client ID** and
   **Client secret**.
5. In Tone: **Settings → Sync → + Google Drive**, paste both, keep the sync folder `Tone` (or pick
   another name), then **Sign in with Google**. Your browser opens, you approve, and Tone shows
   "Connected as …".
6. Do the same on each device (same client ID and secret).

With Drive connected you can:
- sync the workspace to `My Drive/Tone`,
- open any file in your Drive (**File → Open from NAS / Google Drive…**). Google Docs/Sheets
  open as Word/Excel files,
- save a copy of exports to Drive (Convert dialog option).

## 6. How sync works

- Everything saves to the local **workspace folder** first (Documents/Tone on desktop, app storage
  on Android). Autosave runs every 5 s by default.
- Each provider (NAS, Drive) mirrors that folder. Tone remembers what each side looked like at
  the last sync, so it can tell an edit made here from one made elsewhere.
- If the same file changed on two devices, Tone asks: **Merge both** (keeps both copies),
  **Keep A**, or **Keep B**. You can switch this to "keep newest" or "keep both" in
  Settings → Sync.
- Each device publishes its open tabs to the provider, which is how **Home** offers "continue
  here" for another device's documents.
- Deleting a synced file on one device deletes it on the others. Google Drive deletions go to the
  Drive trash.
