# Duelist — HAT tournament tracker

A responsive React + Vite app for 4–12 players, served as static files on GitHub Pages. Supabase provides email/password authentication, PostgreSQL, row-level security and a card-art cache. Matches are played on Dueling Nexus.

## Run locally

```sh
npm ci
npm run dev
```

Without Supabase configuration, the app opens a clearly labelled, read-only sample tournament. The deck checker, card grids, rules, fixtures, standings and bracket can be explored without an account. Preview data never writes to a live database.

For live accounts, copy `.env.example` to `.env.local`, then set:

```dotenv
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_OR_ANON_KEY
```

These values are public browser configuration. Never put a Supabase service-role/secret key in a `VITE_` variable, GitHub Pages, or this repository. Restart Vite after changing configuration.

## Set up Supabase

1. Create a Supabase project. In its SQL editor, execute these files **once, in this order**:
   - `supabase/migrations/001_schema.sql` — tables, policies, validation, standings and transactional tournament RPC.
   - `supabase/migrations/002_card_catalog.sql` — pinned historical catalog (6,155 cards).
   - `supabase/migrations/003_image_bucket.sql` — public card artwork bucket; no browser write access.
2. Enable email/password authentication. Keep email confirmation enabled for a public tournament. Configure the Auth Site URL and allowed redirect URL as your full Pages URL, including its repository path and trailing slash. Add your local development URL for local testing.
3. Create your own account through the app and confirm the email. Promote only your account in the Supabase SQL editor:

   ```sql
   insert into public.organizers(user_id)
   select id from auth.users where lower(email) = lower('YOUR_ORGANISER_EMAIL')
   on conflict do nothing;
   ```

   Check that one account was found. Refresh the app; the Organiser tab appears. Players cannot grant themselves this role. Organiser access is global across tournaments.
4. Deploy the small image-cache Edge Function using the Supabase CLI from this repository:

   ```sh
   supabase login
   supabase link --project-ref YOUR_PROJECT_REF
   supabase functions deploy card-image --no-verify-jwt
   ```

   The function intentionally serves public artwork without JWTs so HTML image tags work. It accepts only numeric IDs from the historical catalog, fetches from a fixed image host, and stores images in the public `card-images` bucket. It uses the Supabase-provided server-side service role; that key never reaches the browser. Deck data is never in this bucket. The 37 example-deck images are already included locally. Other cards require this function for artwork; validation and text details still work if image retrieval fails. First image loads need network access; subsequent loads use cached storage. The public endpoint is bounded to the catalog but can incur storage/egress charges if heavily used.
5. In Organiser, create a tournament, give it a future submission deadline, and share the app link. Sign up a second test account to check email delivery and the live Auth flow before inviting everyone.

Alternative migration deployment with a linked Supabase CLI: `supabase db push`. The SQL files are migrations, not repeatable seed scripts; do not rerun them on an initialized project.

## Publish to GitHub Pages

The repository remote is `https://github.com/Naem-Haq/Yu-Gi-Oh-Tornament.git`.

1. Authenticate GitHub CLI (`gh auth login`) or push through your preferred Git client.
2. In repository **Settings → Secrets and variables → Actions → Variables**, create `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` using the same public settings as above.
3. In **Settings → Pages**, set the build source to **GitHub Actions**.
4. Commit and push this project to `main`. `.github/workflows/deploy.yml` runs tests, builds, and publishes the static artifact. It intentionally fails if live configuration is absent, rather than publishing a demo as a real tournament.
5. The expected project URL is `https://naem-haq.github.io/Yu-Gi-Oh-Tornament/`. Confirm the actual URL in the successful deployment job and use it in Supabase Auth URL settings.

Vite uses relative asset paths. Navigation stays within the single page, so repository subpaths and refreshes work without a Pages fallback router. You can also run the workflow manually. No paid application server is required.

## Tournament workflow

- Players sign in, select the tournament, register a display name, then save 1–3 validated decks.
- The deadline or organiser's manual lock closes deck editing and registration. Unlocking is allowed only before the draw; extending an expired deadline requires the organiser to set a future one.
- The organiser generates the draw once every registered player has at least one valid list. This permanently locks all decks and registrations. Unique random seeds are published before play.
- 4–5 players: one group; top four qualify for 1v4 and 2v3 semifinals.
- 6–12: two balanced groups (odd player counts differ by one); top two qualify for A1vB2 and B1vA2.
- Round-robin fixtures use the circle method. Each pair meets once, no player is double-booked within a round, tables are unique across groups in that round. Odd groups have byes; byes do not award points.
- Each participant commits one of their registered decks before reporting a match. Commitment is final for that best of three and hidden from opponents. Side-decking between games is handled on Nexus, not by editing the registered list.
- Either participant reports a 2–0, 2–1, 0–2 or 1–2 score, in the displayed player order. The other confirms or disputes. Pending and disputed scores do not affect standings.
- The organiser can enter or override any result, including resolving disputes, with a required reason. Prior states and actions are audited.
- The organiser advances after all current-stage results are confirmed. Semifinals/final are generated automatically. Advancing after the final declares the champion.
- Correcting an earlier-stage result deletes dependent knockout matches and their deck commitments, reopens that stage, and requires advancing again. Audit records of previous actions are retained. This prevents stale qualifiers; players must replay affected knockout matches under the corrected bracket.

## Scoring and tiebreaks

The Rules page displays these fixed rules before registration:

1. Match win = 3 points; loss = 0. No draws.
2. Higher game differential (games won minus games lost).
3. Higher games won.
4. Lower published random draw seed.

The same deterministic ordering applies to multi-way ties. Both the browser tables and the database's knockout seeding use these rules. No direct editable win/loss totals exist. The database `standings` view derives all totals from confirmed group results; the UI applies the equivalent calculation to fetched fixtures. Data refreshes every 15 seconds and after each mutation; a refresh button is also available.

## Deck files and historical data

Accepted UTF-8 `.txt` files (up to 50 KB):

```text
Main Deck:
3x Fire Hand
3x Ice Hand

Extra Deck:
1x Abyss Dweller

Side Deck:
2x D.D. Crow
```

This short snippet demonstrates syntax; it is not a valid complete deck. Use **Load example** in the deck workshop for a complete 40/15/15 list. Headings and names are case-insensitive; blank lines and CRLF/BOM are supported. Unknown or post-pool names produce line-specific errors. Entry order is retained in exports. The server independently checks IDs, allowed sections, deck sizes, summed copy limits (including duplicate lines and always-treated-as aliases), and historical restrictions. The browser cannot bypass validation by forging a request.

Sources:

- [HAT Format card pool](https://www.hatformat.com/cardpool.html): July 2014 NAWCQ pool, with the site's linked 8 July cutoff.
- [HAT Format April 2014 banlist](https://www.hatformat.com/banlist.html): 77 forbidden, 71 limited, 14 semi-limited cards.
- [HAT historical rules and errata](https://www.hatformat.com/rules.html).
- [YGOPRODeck API](https://ygoprodeck.com/api-guide/): names, types, card text, dates and artwork.

`data/provenance.json` records the source URLs, retrieval time, counts and SHA-256 of `public/cards.json`. The catalog excludes tokens, skills, non-playable prize cards and later mechanics. The API's `format=tcg` filter incorrectly excluded 17 cards with Speed Duel as their first format, including Artifact Ignition and Downerd Magician. Generation therefore queries TCG release dates directly without that filter, preserving those eligible cards. Pool membership follows the cited HAT community reference, not the current banlist. Images and descriptions show current printings; actual HAT gameplay uses historical effects and rules.

To rebuild the pinned data deliberately, download the banlist HTML to `data/banlist-source.html`, and the provenance API URL JSON to `data/cards-unfiltered-source.json`, then run `npm run data:sync`. Raw source downloads are ignored by Git. Do not regenerate the catalog during an active tournament. Deploy a new migration for any future catalog correction; do not edit a migration already applied in production. `node scripts/cache-example-images.mjs` refreshes missing example artwork with throttled requests.

## Security and verification

- Authenticated users can read tournament schedules, display names and standings. Decks and choices are readable only by their owner or an organiser. Audit history is organiser-only.
- Anonymous callers have no table access or tournament RPC permission.
- Authenticated users have no direct table write grants or write policies. The `tournament_action` security-definer RPC checks Auth identity, ownership, organiser role, deadline and stage for every operation.
- Every mutation locks its tournament row, serializing capacity checks, deck limits, result confirmations and stage advancement. Duplicate draws/submissions are rejected.
- Organiser privileges are assigned only via trusted SQL, never user metadata.
- The small artwork function is the only service-role application code and has no private-data output.

```sh
npm test
npm run build
```

Tests run real PostgreSQL semantics in PGlite, with minimal Supabase Auth role/UID stubs. They cover catalog validation, aliases, all 4–12 player draws, pair/table invariants, knockout seeding and winners, result transitions, private-row policies, forbidden direct writes, deck lock/ownership/count restrictions, and invalidation after upstream corrections. They do not substitute for testing hosted Supabase email delivery, Storage or Edge Function deployment.

Build output is `dist/`. No live Supabase project or GitHub deployment is created just by running these local commands.

