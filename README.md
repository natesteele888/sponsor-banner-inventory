# Sponsor Banner Inventory

A small app replacing the one-time "35 photos vs. the 2026 sponsor list"
Claude artifact with something Nate can actually use from his phone: a
scrollable list of every sponsor banner, a full photo + editable info per
banner, a hung/not-hung toggle, a map of where each one is actually hung, and
a form to add new banners as they come in.

Standalone app (like Board Meeting Secretary) — not part of the lybs-reporting
or LYBS Dashboard codebases. It touches sponsor business-contact info (names,
emails, phones for local business owners), which lybs-reporting's own
CLAUDE.md explicitly says must never live in that repo — so this lives here
instead, in its own repo, same reasoning as the Contacts Carve-Out there.

## How it works

```
Google Drive "Sponsor Banners" folder   (the 35 photos, already there)
Google Sheet "Sponsor Banner Inventory (data)"   (one row per banner — the database)
            │
            ▼
apps-script/Code.gs, deployed as a Web App   (the only thing that reads/writes the Sheet or Drive folder)
            │  JSON over HTTP
            ▼
index.html / app.js / style.css   (static, hosted on GitHub Pages — what Nate opens)
```

There's no Firebase project and no sign-in. The Sheet and Drive folder are
already in Nate's own Drive, same as every other document the league uses —
nothing new to create there, no Blaze-plan upgrade, no OAuth setup. The
trade-off: `ACCESS_TOKEN` in `config.js` is a speed bump, not real security
(same posture lybs-reporting's photo-intake script documents for its own
`FORM_TOKEN`) — it stops a crawler stumbling on the URL, not a determined
person reading the page source. Fine for a private tool only Nate uses;
flag it if that stops being true.

## One-time setup (you — about 10 minutes)

1. **Open the Sheet.** "Sponsor Banner Inventory (data)" already exists in
   the "Sponsor Banners" Drive folder, already seeded with all 35 banners
   (sponsor name, tier, contact info, condition — matched against the 2026
   sponsorship sheet; see "How the seed data was built" below for the few
   calls I had to make).
2. **Deploy the backend.** In that Sheet: Extensions → Apps Script. Delete
   the placeholder code, paste in `apps-script/Code.gs` from this repo. Set
   `ACCESS_TOKEN` near the top to a long random string (anything — a
   password generator's output is fine). Deploy → New deployment → **Web
   app** → Execute as **Me**, Who has access **Anyone**. Copy the `/exec`
   URL it gives you.
3. **Wire up the front end.** Open `config.js` in this repo and paste in
   that URL and the same `ACCESS_TOKEN` string.
4. **Put it online.** Create a GitHub repo (e.g. `sponsor-banner-inventory`
   under your account), push this folder to it, then Settings → Pages →
   deploy from the `main` branch, root. GitHub gives you a URL like
   `https://natesteele888.github.io/sponsor-banner-inventory/`.
5. **Point the Toolbox at it.** The Toolbox's "link changed" banner (the one
   that already fixed Gameday Picks and the Signal Study Guide) needs an
   entry in `apps/registry.json` in your `natesteele888.github.io` repo — I
   don't have that repo, so add this yourself:
   ```json
   { "match": "claude.ai/artifact/12zwnZ5N9q53yegAmby4js", "live": "https://natesteele888.github.io/sponsor-banner-inventory/" }
   ```
   (adjust the URL to wherever step 4 actually lands). Next time you open
   the Toolbox, it'll offer to update the link — same one-tap flow as the
   other two apps.
6. Open the live URL on your phone and add it to your home screen.

If you'd rather I do steps 4–5 myself, give me push access to the repo (or
tell me to create one) and I can finish the deploy next time.

## What's in the Sheet

One row per banner. Columns: `id`, `filename`, `driveFileId`, `sponsorName`,
`onSponsorList`, `tier`, `amountPaid`, `contactName`, `contactPhone`,
`contactEmail`, `address`, `condition`, `hung`, `lat`, `lng`, `locationLabel`,
`notes`, `updatedAt`. Edit it directly in Sheets any time — the app just
reads/writes it through Code.gs.

## How the seed data was built

I matched all 35 Drive photos (now all renamed with sponsor names — that
waypoint is done) against the **2026_Sponsorship Sheet** (the one
`build_league_report.py` in lybs-reporting calls "the 2026 sponsor sheet,"
owned by Lauren) and against your Oct 24 board email "Sponsor Banner
Inventory — Fall 2026" (which has per-banner condition and is where I got
"currently all in storage at the Powell snack shack, none hung").

Two things worth your eyes:
- **Black Bear Flooring** (banner filename) only has a plausible match in
  the sheet as **Black Bear Coating & Concrete** (Justin Tousigant) — same
  business under a different name on the banner, or two different
  businesses? I matched them; flagged it in that row's notes either way.
- 11 banners (BriCo Welding, Jacobs Landscaping, Pit Stop Auto, Aho's Carpet
  Cleaning, Lynn Walsh, Thomas Fuel, Mass Ave Towing, KD Custom Apparel, All
  Town Collision, Stiles Co.) aren't current paid 2026 sponsors — marked
  "Legacy" in the app. P.J. Keating's banner is flagged "Poor" condition per
  your email — that's the one needing a reprint.

I used the live Sheet rather than the old artifact's cross-reference against
the public website sponsor page, since the Sheet is the one Lauren actively
maintains and has the contact info the app needs — the old artifact's "3
banners not on the list" note doesn't match this Sheet (Whalom Wash and Maki
are both paid 2026 sponsors here), likely because the public page lags.

## Map

Uses Leaflet + OpenStreetMap, not the Google Maps JS API — no billing-enabled
API key needed, same pin-dropping behavior. Say so if you'd rather have real
Google Maps tiles; that just needs an API key with billing enabled on it.

## Adding new banners later

Use the **＋ Add** tab in the app — upload a photo, fill in sponsor/contact
info, save. It writes straight to the Drive folder and the Sheet; no need to
touch either by hand. There's no automatic re-sync against the sponsorship
sheet for future seasons — if Lauren's sheet changes a lot season to season,
that's a manual add (or ask me to build a sync pass).
