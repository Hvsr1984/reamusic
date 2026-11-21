# REA Music Admin setup

Use Node 24. Apply supabase/migrations/001_rea.sql to a development Supabase project. Disable public registration, create the owner in Authentication and insert that user's UUID into rea.admins(id) using a trusted SQL session. Schedule public.rea_prune() daily using Supabase Cron.

Copy .env.example to .env and admin/.env.example to admin/.env. Supply the project URL in both files, the service role and a random rate-limit secret only in the player server environment, and the anonymous project key in the admin environment. Use exact origins including scheme and port.

Run npm test and npm run build. Start the player with node --env-file=.env server.js and the dashboard with node --env-file=admin/.env admin/dev.js. Open http://127.0.0.1:4500 and http://127.0.0.1:4501/login. Enable Usage analytics in the player sidebar.

For deployment use separate Vercel projects rooted at the repository and admin respectively. Configure HTTPS origins and environment variables before deployment. Approval is required for pushing changes and deploying.

Presence measures unique opted-in browser identifiers within a configurable 60-second window. Background tabs with ongoing playback can count. Delayed or blocked requests and cleared storage affect accuracy. Anonymous submissions can be forged despite origin checks, validation and rate limiting. Reports use server timestamps and half-open local calendar-day ranges in the selected time zone. Concurrent counts are sampled peaks. For higher traffic preaggregate daily reports and partition events by time.

If sign-in fails, check the allowlist and the project URL. If counts stay empty, check consent, collection settings, exact player origin and collector HTTP status. A 503 indicates a backend configuration or availability issue.
