# LYBS Sponsors (was Sponsor Banner Inventory)

The league's sponsor app. **Sponsors** shows the season's sponsorship sheet
live, with each sponsor's team; **Banners** is the banner inventory below;
**2027 banners** is the banner intake. See
[docs/sponsors-tab.md](docs/sponsors-tab.md) for the Sponsors tab, where
every piece of sponsor data lives, and how other apps read it.

## Banner inventory

A small app replacing the one-time "35 photos vs. the 2026 sponsor list"
Claude artifact with something Nate can actually use from his phone: a
scrollable list of every sponsor banner, a full photo + editable info per
banner, a hung/not-hung toggle, a drawing of each field showing where each
one hangs, and a form to add new banners as they come in.

Standalone app (like Board Meeting Secretary) — not part of the lybs-reporting
or LYBS Dashboard codebases. It touches sponsor business-contact info (names,
emails, phones for local business owners), which lybs-reporting's own
CLAUDE.md explicitly says must never live in that repo — so this lives here
instead, in its own repo, same reasoning as the Contacts Carve-Out there.

## 2027 sponsor intake

The **2027** tab lists every banner-level sponsor ($500+) for the season,
whether they used the website form, just paid online, or emailed. An hourly
check finds them, emails Nate, and sends each one a link to `intake.html`
(the reply form with drop-downs and logo/banner uploads). See
[docs/2027-sponsor-intake.md](docs/2027-sponsor-intake.md) for the diagram,
the email, and the one-time setup.

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

Sign-in uses the LYBS Dashboard's accounts and roles. The page signs in through
the Dashboard's Firebase project and sends that sign-in with every request. The
Apps Script checks it and allows only the board, director and admin roles from
the Dashboard's approved list. To give someone access, set their role in
Dashboard → Manage. The repo holds no secret and no sponsor data.

## One-time setup

1. ~~Open the Sheet, deploy the backend, wire up config.js~~ — **done.** The
   backend is live as a standalone Apps Script project ("Sponsor Banner
   Inventory", not bound to the Sheet — it references it by `SHEET_ID` so it
   didn't need the Sheets UI's "Extensions → Apps Script" link, which only
   opens from a real click). `config.js` already has the real `/exec` URL
   in it. The one click I couldn't do myself — Google's
   OAuth consent screen, which browser automation can't click through by
   design — Nate did directly in the Apps Script editor.
2. **Put it online** (needs you — I have no `gh` CLI or GitHub session to
   do this myself). Create a GitHub repo (e.g. `sponsor-banner-inventory`
   under your account), push this folder to it, then Settings → Pages →
   deploy from the `main` branch, root. GitHub gives you a URL like
   `https://natesteele888.github.io/sponsor-banner-inventory/`.
3. **Point the Toolbox at it.** The Toolbox's "link changed" banner (the one
   that already fixed Gameday Picks and the Signal Study Guide) needs an
   entry in `apps/registry.json` in your `natesteele888.github.io` repo — I
   don't have that repo, so add this yourself:
   ```json
   { "match": "claude.ai/artifact/12zwnZ5N9q53yegAmby4js", "live": "https://natesteele888.github.io/sponsor-banner-inventory/" }
   ```
   (adjust the URL to wherever step 2 actually lands). Next time you open
   the Toolbox, it'll offer to update the link — same one-tap flow as the
   other two apps.
4. Open the live URL on your phone and add it to your home screen.

If you'd rather I do steps 2–3 myself, give me push access to the repo (or
tell me to create one) and I can finish the deploy next time.

**Apps Script project:** https://script.google.com/home/projects/1v62MCGPSN1mejTXsYfosCWnidALXejuhVxEPmeLHek03ANNQHuAJueNE/edit
— if `Code.gs` ever needs a code change, edit it there (or paste an updated
copy in), then Deploy → Manage deployments → pencil icon → Version: **New
version** → Deploy, which keeps the same `/exec` URL so `config.js` doesn't
need to change.

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
owned by the sponsorship lead) and against your Oct 24 board email "Sponsor Banner
Inventory — Fall 2026" (which has per-banner condition and is where I got
"currently all in storage at the Powell snack shack, none hung").

A few banners matched the sheet under a different business name, and some
banners belong to past sponsors (shown as "Past sponsor" in the app); those
calls are in each row's notes in the Sheet, not here, since this repo is public.

I used the live Sheet rather than the old artifact's cross-reference against
the public website sponsor page, since the Sheet is the one the sponsorship lead actively
maintains and has the contact info the app needs — the old artifact's "3
banners not on the list" note doesn't match this Sheet (Whalom Wash and Maki
are both paid 2026 sponsors here), likely because the public page lags.

## Fields

The **Fields** tab draws each LYBS field (Marshall Park's baseball and upper
softball fields, Powell, McNally, Fitzgerald) with a dot wherever a banner
hangs; tap a dot for that banner. To place one, open the banner in **Banner
stock**, pick its field under **Where it hangs** and tap the drawing.

The spot is kept in the banner row's `locationLabel` column as
`spot:<field id>@<x>,<y>` (0 to 100 across the drawing), so the Apps Script
backend didn't change. The old `lat`/`lng` columns from the earlier street map
are left as they were. The drawings are plain diamonds, not surveys; a field's
quirks (press box, snack shack) are listed in `fields.js` and can be added to.

## Adding new banners later

Use **＋ Add a banner** on the Banner stock tab — upload a photo, fill in sponsor/contact
info, save. It writes straight to the Drive folder and the Sheet; no need to
touch either by hand. There's no automatic re-sync against the sponsorship
sheet for future seasons — if the sponsorship lead's sheet changes a lot season to season,
that's a manual add (or ask me to build a sync pass).
