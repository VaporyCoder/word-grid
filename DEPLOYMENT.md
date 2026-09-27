# Couples Wild deployment guide

Couples Wild is a Vite single-page application backed by Supabase. Deploy the same source to either Vercel or Netlify; do not deploy to both under the same production domain.

## 1. Prepare Supabase

1. Create a production Supabase project and enable anonymous sign-ins under Authentication settings.
2. Apply every SQL file in `supabase/migrations` in filename order. With a linked Supabase CLI project, run `npx supabase db push`.
3. In Realtime settings, disable **Allow public access**. The app connects with private channels and the migrations authorize only room members.
4. In Authentication → URL Configuration, set **Site URL** to the exact production origin, such as `https://cards.example.com`. Keep `http://127.0.0.1:5173/**` as an additional local redirect only if needed. This app currently uses anonymous authentication and does not perform an OAuth redirect, but an exact production Site URL keeps Auth ready for future account linking.
5. Schedule room cleanup every 15 minutes with Supabase Cron:

   ```sql
   select cron.schedule(
     'couples-wild-room-cleanup',
     '*/15 * * * *',
     $$select public.cleanup_abandoned_rooms();$$
   );
   ```

6. Review Auth rate limits and database usage alerts for the expected audience. Supabase recommends CAPTCHA or Turnstile for anonymous sign-ins, but do not enable it yet: the current client does not collect or submit a CAPTCHA token. Enabling the dashboard switch alone would prevent new players from entering. Add a client challenge flow before turning it on.

## 2. Production environment variables

Create these variables in the selected hosting provider for Production and Preview builds:

```text
VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_YOUR_KEY
```

Vite embeds `VITE_` variables in the browser bundle. The Supabase publishable key is designed for that use; authorization comes from Row Level Security. Never use a secret key, legacy service-role key, database password, or access token in a `VITE_` variable.

Use a separate Supabase project for untrusted preview deployments when previews need multiplayer access. Otherwise, omit the variables in Preview so those builds stay in the clearly labeled local-preview mode and cannot change production data.

## 3A. Deploy with Vercel

1. Import the repository into Vercel and select the Vite framework preset.
2. Confirm the build command is `npm run build` and output directory is `dist`. `vercel.json` also supplies these values, SPA route rewrites, security headers, and long-term caching for hashed assets.
3. Add the two production environment variables in Project Settings → Environment Variables.
4. Deploy, then attach the production domain and update the Supabase Site URL to that exact HTTPS origin.
5. Open `/`, `/create`, `/join`, `/rules`, `/settings`, and a direct `/room/ABC123` URL. Direct routes must load rather than return a platform 404.

## 3B. Deploy with Netlify

1. Import the repository into Netlify. `netlify.toml` configures Node, `npm run build`, the `dist` publish directory, SPA fallback routing, security headers, and asset caching.
2. Add the two variables under Project configuration → Environment variables. Do not commit a populated `.env` file.
3. Deploy, then attach the production domain and update the Supabase Site URL to that exact HTTPS origin.
4. Repeat the direct-route checks listed for Vercel.

## 4. Release verification

- Confirm the production response includes the Content Security Policy, frame protection, MIME sniffing protection, referrer policy, and permissions policy.
- Create a room in one private/incognito browser, join from a second browser, and play through a complete round.
- Verify an opponent never receives another player’s private hand in browser network responses or Realtime payloads.
- Refresh both browsers mid-turn and confirm the public state and each private hand recover correctly.
- Complete a unanimous rematch and verify the next starting player changes.
- Return to the lobby, leave the room, and verify friendly handling for an invalid or expired code.
- Test desktop and mobile widths, keyboard-only play, reduced motion, color patterns, mute/volume, and confirmation mode.
- Confirm the scheduled cleanup job appears in Supabase Cron and has successful runs.
- Check that the production bundle contains a publishable key only and that no secret/service-role credential is present in source, build logs, or browser requests.
- Keep the previous successful host deployment available for rollback until the multiplayer smoke test passes.

## 5. Operational notes

- Anonymous identities are tied to browser storage. Clearing storage or changing devices prevents a player from reclaiming the old seat.
- Configure Supabase budget/usage notifications and watch Auth, Database, and Realtime usage after launch.
- Supabase does not automatically purge anonymous Auth users. Add a conservative scheduled cleanup only after selecting and documenting a retention period.
- Database migrations should be applied before the matching frontend release. Additive migrations in this project allow the previous frontend to remain usable during the update.
