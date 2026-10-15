# Titlovi.com unofficial — Cloudflare v2.3.0

[Configure the Cloudflare addon](https://titlovi-com-unofficial.cufri.workers.dev/configure)

Unofficial Nuvio/Stremio subtitle relay using each user's private official Titlovi.com addon. Not affiliated with Titlovi.com.

Features: English, Macedonian, Serbian, Croatian and Bosnian subtitles, with optional additional Cyrillic versions for Serbian/Croatian/Bosnian. Original subtitles stay selectable. Transliteration preserves timings; it is not Macedonian translation.

## Deploy

    npm install
    npm test
    npx wrangler login
    npx wrangler secret put CONFIG_SECRET
    npm run deploy

Important: Preserve the **existing** CONFIG_SECRET value. Changing it invalidates the private installation links. Never commit it or private /c/... links to GitHub.

Worker entry: src.js, configuration: wrangler.toml; tests: test.mjs.

## Migration

The legacy server.js and Render configuration remain available for rollback. Do not delete the Render service until Cloudflare operation and migration of old installed onrender.com links are confirmed.

For full instructions and supported formats, see [README_MK.md](README_MK.md).
