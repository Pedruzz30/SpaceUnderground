# Separate Netlify projects

Both projects use the `Pedruzz30/SpaceUnderground` repository and production
branch `main`. Only each project's build output is published.

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
base directory and repository root. Set the public project's package directory
to `deploy/public` so the Admin configuration cannot override its build.
Do not change the Admin project's existing repository or build settings.

The public build uses only the publishable Supabase configuration from
`scripts/build-public.mjs`. Do not copy Admin environment variables or backend
secrets into the public project.

For a manual source upload using the Netlify MCP deploy command, create a
temporary copy of the tracked repository and replace its root `netlify.toml`
with `deploy/public/netlify.toml` before uploading. Keep this replacement out
of the Git repository: the original root configuration belongs to the Admin.

After connecting the public project to GitHub, a push to `main` will build
the public website and Admin independently in their respective projects.
