# Titlovi.com unofficial

Unofficial configurable Stremio/Nuvio subtitle addon. **Not affiliated with Titlovi.com.**

Based on the working local Titlovi.com — 5 јазици v1.6 addon. Provides English, Macedonian, Serbian, Croatian, and Bosnian subtitles via each user's own official Titlovi.com Stremio addon. It preserves upstream `lang` and `label`, supports encoded episode IDs, and uses the upstream `videoID` parameter for series. No AI translation.

## Security

Each user provides their own private `https://stremio.titlovi.com/.../manifest.json` URL via `/configure`. Do not commit or share this private URL. The app encrypts per-user configuration with AES-256-GCM using `CONFIG_SECRET`.

**The configured addon installation URL is a bearer credential.** Anyone with it may access the corresponding account. Keep it private; do not paste it into public GitHub issues or logs. The host provider has technical access to server memory; encryption is not end-to-end. Keep `CONFIG_SECRET` stable, or existing installation URLs will become invalid.

This is an unofficial relay, not an anonymous Titlovi.com API or an official endorsement.

## Local development

Requires Node.js 20 or later; there are no runtime npm dependencies.

```powershell
cd C:\TitloviUnofficial
$env:CONFIG_SECRET = 'replace-this-with-a-random-secret-of-at-least-32-characters'
$env:HOST = '127.0.0.1'
$env:PORT = '7100'
npm test
npm start
```

Open `http://127.0.0.1:7100/configure`, enter *your own* private official Titlovi.com manifest URL, select languages, and install the **configured** manifest URL, not the generic one.

## Render deployment

1. Open [Render dashboard](https://dashboard.render.com/) → **New → Web Service** and connect this GitHub repository, or use its `render.yaml` blueprint.
2. Runtime: Node; build command: `npm install`; start command: `npm start`; health-check path: `/health`.
3. Set **CONFIG_SECRET** to a generated secret of at least 32 random characters, for example generate in your own terminal:
   ```bash
   node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
   ```
4. Set **PUBLIC_URL** to the exact HTTPS origin Render assigned, for example `https://your-service.onrender.com` (no trailing slash). `render.yaml` generates `CONFIG_SECRET`, but you still need to configure `PUBLIC_URL` after obtaining the hostname.
5. Deploy. Check `/health`, `/manifest.json` and `/configure` in your browser.
6. Create your **private** configured installation URL through `/configure` and install it into Stremio or Nuvio. Never share this private URL.

Free instances may sleep when idle and cause subtitle timeouts.

## Routes

| Endpoint | Purpose |
| --- | --- |
| `GET /` / `GET /configure` | Configuration page |
| `POST /api/configure` | Create encrypted individual installation URL |
| `GET /manifest.json` | General manifest requiring configuration |
| `GET /c/:token/manifest.json` | Configured Stremio manifest |
| `GET /c/:token/subtitles/:type/:id.json` | Subtitle results |
| `GET /health` | Health check |

### Compatibility note

Nuvio Desktop sometimes URL-encodes episode identifiers, e.g. `tt0903747%3A1%3A1`. This addon decodes them before validation and passes the required `videoID` to Titlovi.com. Original `label` metadata remains in subtitle JSON, though Nuvio versions may not display it. Do not append labels to `lang`: this breaks recognition.

## Validation

Run `npm test`. Six automated tests passed locally; production deployment and access to each user's private Titlovi.com upstream require real-world validation.

## License

MIT license for this project's own source code. Titlovi.com, Stremio, and Nuvio are independent services; comply with their respective terms.
