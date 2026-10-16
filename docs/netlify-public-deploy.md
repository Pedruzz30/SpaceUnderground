# Optional Netlify projects

GitHub Pages is the canonical public production target for Space Underground.
Every push to `main` is built and published by
`.github/workflows/deploy-pages.yml` to:

`https://pedruzz30.github.io/SpaceUnderground/`

The Netlify projects below remain available as an optional/legacy deployment
path and for previews. They are not the canonical public production URL.

Both Netlify projects use the `Pedruzz30/SpaceUnderground` repository and can
track branch `main`. Only each project's build output is published.

| Setting | Public website | Admin |
| --- | --- | --- |
| Project | `spaceunderground` | `space-underground-admin` |
| URL | `https://spaceunderground.netlify.app/` | `https://space-underground-admin.netlify.app/` |
| Base directory | repository root (empty) | `admin` |
| Package directory | `deploy/public` | existing setting |
| Configuration | `deploy/public/netlify.toml` | root `netlify.toml` |
| Build command | `npm run build` | `npm run build` |
| Published output | `dist` from repository root | `dist` inside `admin` |

Netlify checks the package directory for `netlify.toml` before checking the
base directory and repository root. If the optional public Netlify project is
used, keep its package directory at `deploy/public` so the Admin configuration
cannot override its build. Do not change the Admin project's existing
repository or build settings.

The public build uses only the publishable Supabase configuration from
`scripts/build-public.mjs`. Do not copy Admin environment variables or backend
secrets into the public project.

For a manual source upload using a Netlify deploy integration, create a
temporary copy of the tracked repository and replace its root `netlify.toml`
with `deploy/public/netlify.toml` before uploading. Keep this replacement out
of the Git repository: the original root configuration belongs to the Admin.

The public canonical URL, SEO metadata, sitemap and robots configuration are
controlled by `SITE_URL` in `site.config.js`, which currently points to
GitHub Pages.
