# Sponsors tab

The app's first tab shows the season's sponsorship sheet (the one the
sponsorship lead keeps, named `<season>_Sponsorship Sheet` in Drive) as it is
right now: who owns each sponsor on the board, who has contacted them, the
contact person, phone and email, last year's and this year's level, amount,
paid, and the banner and plaque flags. Every column on the sheet shows on a
sponsor's detail, so a column the board adds later shows up with no change
here. A Notes column also shows as a short line on the sponsor's card and is
searched. The header is the first row with three or more filled cells, so a
blank or title row above it is fine. The sheet's other tabs (website form log,
jerseys, plaques) are listed under the sponsors.

```
  sponsorship sheet in Drive (read only from here; never changed)
          │   sponsorBook, behind the Dashboard sign-in (board/director/admin)
          ▼
  Sponsors tab ── Save team ──► Script Properties of the private
                                 Apps Script project (SPONSOR_TEAM_<season>_*)
                                        │   sponsorSheet (no contact columns)
                                        ▼
                     LYBS Dashboard: Uniforms and Jersey Order pages
```

## Where the data lives (for the Nate Brain and other apps)

- **Sponsors, contacts, levels, paid:** the sponsorship sheet in Drive. Found
  by its name, `<season>_Sponsorship Sheet`; the backend remembers its address
  in the Apps Script project's Script Properties (`SPONSOR_SHEET_ID_<season>`).
  The address is not written in this repo on purpose.
- **Sponsor to team:** the Apps Script project's Script Properties, one entry
  per sponsor named `SPONSOR_TEAM_<season>_<key>`, each a small JSON object:
  key, company, division, team, note, imageFileId (team page logo), updatedAt. (Not a Sheet tab: Google
  refused to let the web app add one to the data Sheet.) Other apps get them
  through `sponsorSheet`, which already folds them into each sponsor's team.
- **Banner-level sponsors ($500+) and their banner plan:** tab
  `<season> Banners` of the same private Sheet (see 2027-sponsor-intake.md).
- **How another app reads it:** POST to the Apps Script `/exec` address in
  `config.js` with a Dashboard sign-in token: `sponsorBook` (everything,
  contacts included, for this app), `sponsorSheet` (no contacts, for the
  Dashboard), `seasonList` (banner sponsors). Only the board, director and
  admin roles get an answer.
- **Ballclub team pages ("Sponsored by"):** `teamPageSponsor` with `teamId`
  and a Ballclub sign-in token, not a Dashboard one. The answer is the names
  and logos of the sponsors lined up with that one team (team set in this app
  first, then the sheet's Associated Team cell), at most three. No contact,
  level, amount, paid, owner or notes. Allowed for whoever Ballclub lets see
  that team: its code accounts, a Google account with a grant for the team,
  or a Ballclub board member. Ballclub's signed-out public view gets nothing.
  Coaches see no other sponsor information anywhere.
- **Team page logos:** set in the sponsor's box on this tab ("Team page
  logo"), saved in the `Team Page Logos` folder inside Sponsor Banners in
  Drive, with the file id on the sponsor's team entry (`imageFileId`). With
  none set, a PNG/JPG/GIF/WebP logo the sponsor sent through their reply form
  is used. Only files in that folder, or that sponsor's own form folder, are
  ever served.
- **Team names for the pickers:** the Dashboard's `lybs_bins/lybs-team-assignments`
  (this season's teams once drafted, the last draft's before that). Only
  division and team names are kept from it.

Nothing here copies sponsor data into a repo, the phone's storage or the
Dashboard's Firestore: each open of the tab reads the sheet again.

## Turning it on (one time, in the Apps Script editor)

1. Open the Sponsor Banner Inventory Apps Script project.
2. Replace `Code.gs` with this repo's `apps-script/Code.gs`.
3. Replace `Season.gs` with this repo's `apps-script/Season.gs`.
   If the project has a `SponsorSheet` file from lybs-reporting, delete it:
   `Season.gs` has that code now.
4. Files → + → Script, name it `History`, paste in `apps-script/History.gs`
   (the year-over-year strip).
5. Deploy → Manage deployments → pencil → Version: New version → Deploy.
   The `/exec` address stays the same. Google may ask once to allow the
   script to read the sheet's saved versions.

The first time the tab opens, the backend looks the sheet up by name. If the
sheet is ever renamed, run `forgetSponsorSheet` once from the editor.

## Year over year

A thin bar under the counts shows this season's committed total against last
season's final, with a mark where last season stood on the same date. Tap it
for month-by-month totals.

- **This season:** each day the tab opens, the backend keeps that day's
  totals (dollars committed, dollars paid, how many sponsors) in the Apps
  Script project's Script Properties (`SPONSOR_SNAPS_<season>`). Totals only,
  no names, behind the same sign-in.
- **Last season:** there was no dated log, so its totals come from the saved
  versions of last season's sponsorship sheet in Drive, read once and kept
  (`SPONSOR_PREV_<season>`). Drive keeps older versions thinly, so a total
  more than a week from the nearest saved version shows as "about", and dates
  between the sheet starting and its first saved version show "no record".
  Run `forgetSponsorHistory` from the editor to read them again.

## Letting someone in without the Dashboard

For someone who should see this app but has no Dashboard role, add their
Google address to the Script Property `SPONSORS_ONLY_EMAILS` (Project
Settings → Script Properties; separate several with commas). They sign in
with Google and see every tab here; the page hides its links to the
Dashboard. Remove the address to take access away; it ends within five
minutes. The list stays in the private Apps Script project, never in this
repo. Needs the Apps Script deploy for this change.

## Donation receipts for paid sponsors

When the sponsorship lead marks a row **Paid?** and the row has an email and an amount, the Sponsors tab shows it under **Receipts to send**. A board member taps **Preview** to see the email, then **Send** (twice: the second tap sends). Nothing is ever sent on its own; there is no trigger. Sponsors get this receipt from here whether they paid by check or online, so the league site's receipt button is not used for a sponsor (a row whose Paid? or Notes says online, website, Crossbar or card is tagged **Paid online** as a reminder). Plain donations from people who aren't on the sponsor list never show here; those keep the website's receipt button. **Not needed** takes a row off the list (and **Undo** puts it back).

The email is the league's non-profit donation receipt (donor, contact, address, amount, date, the no-goods-or-services line, who issued it, the 501(c)(3) line with the EIN) plus a button to the sponsor packet page. Each sent receipt is remembered in the `RECEIPTS_<season>` Script Property, so it is never sent twice. A changed amount is a new receipt. This never writes to the sponsorship sheet.

Setup (Apps Script editor):

1. Add `apps-script/Receipts.gs` as a new script file named `Receipts`, and paste the new `Code.gs`.
2. In **Project Settings → Script Properties**, add `RECEIPT_ORG_ADDRESS`, `RECEIPT_EIN` and `RECEIPT_ISSUER` as the old receipt shows them, `SPONSOR_PACKET_URL` (change it here when the packet page moves), and `RECEIPTS_TEST_TO` (your own address).
3. Deploy a new version. Google asks once to allow sending email as you.

Heads-up: run `installReceiptPing` once from the editor. Every hour, any receipt that has just started waiting gets one short email to you (or to `RECEIPTS_PING_TO`), never to a sponsor, with a link to the Sponsors tab. Each receipt is mentioned once. `removeReceiptPing` turns it off.

Until `RECEIPTS_LIVE` is set to `on`, every Send goes only to `RECEIPTS_TEST_TO`, marked [TEST], and the row stays in the list. Set `RECEIPTS_LIVE` to `on` only once the board agrees to send to sponsors; delete it to go back to test mode.

## Sponsor info packets

What sponsors send on the info packet page (level, business, jersey name, write-up, socials, banner choice, logo) shows under **Sponsor info packets** on the Sponsors tab, newest first, with new ones marked. Open one to see everything they sent and the logo from its files folder. A sponsor's card says "Info packet in" when the business name matches. It's read live from the "LYBS Sponsor Info Packets" sheet (tab Packets) and never written to.

Setup: add `apps-script/Packets.gs` as a script file named `Packets` and deploy a new version. The sheet is found by its name. When it moves (for example to the league's info account), share the sheet and its folder with the account this script runs as, and set the `PACKET_SHEET_ID` Script Property if the name changes. Put the packet page's link in `SPONSOR_PACKET_URL` so receipts include it; change it there when the page moves.

## Board edits (the board's own copy of the sheet)

The app can run on the board's own copy of the sponsorship sheet instead of
reading the sponsorship lead's sheet. Nothing changes until this is switched on.

- **Switch on:** set the Script Property `SPONSOR_SHEET_USE` to the copy's
  spreadsheet id. The app then reads and writes only that copy.
- **Switch back:** delete `SPONSOR_SHEET_USE`. The app goes back to reading the
  lead's sheet by name, and every edit is refused, so that sheet is never
  written from the app.
- **Add a contact:** any signed-in board member can add a person or business
  they reached out to. A name already on the sheet is refused. Columns the
  sheet works out with a formula get the row above's formula.
- **Edit a row, Mark paid, Mark contacted, Not sponsoring:** only editors.
  Editors are the league admin account plus the Google addresses in the
  Script Property `SPONSOR_EDITORS` (comma separated). Paid rows and amounts
  can be changed. Formula columns are left alone. "Not sponsoring" goes in
  the Contacted? column and takes the row off follow-up emails.
- Each save checks the row still holds the same sponsor, so a sheet that was
  re-sorted since the page loaded is not written to the wrong row.

## Follow-up emails

Sponsors the board has contacted who haven't paid and haven't said no get a
short follow-up at a few set dates ("rounds"). From a round's date until the
next one, they show under **Follow-ups to send**. A board member taps
**Preview**, then **Send** (twice). Nothing is sent on a schedule. **Skip**
leaves one out for that round. **Schedule** lists the rounds with a sample
preview of each email.

- Who gets one: Contacted? has a name or "Yes" (not blank, "No" or "Not
  sponsoring"), Paid? is not yes, and the row has an email.
- Default rounds: Dec 10 (holiday hello), Jan 14 (new year check-in), Feb 11
  (before jerseys) and Mar 6 (last call). Change them with `NUDGE_DATES`
  (e.g. `2026-12-10, 2027-01-14`); the first is the holiday email and the
  last is the last call.
- Script Properties: `NUDGE_SIGN` (the sign-off, "Name, Title"),
  `SPONSOR_DEADLINE` (default "March 20"), `NUDGES_LIVE` ("on" sends to
  sponsors; otherwise tests go to `RECEIPTS_TEST_TO`), and the shared
  `RECEIPT_ORG_ADDRESS` for where checks go.

## Sending from the league's address

Receipts and follow-ups both send through `Mail.gs`. Set `SEND_FROM` to the
league's address. Nothing goes to a sponsor until that address is in the
"Send mail as" list of the Gmail account that owns this script (Gmail →
Settings → Accounts and Import → Send mail as → Add another email address,
then the confirmation link Gmail mails to that address). Until then, live
sends are refused, and test sends come from the owner's Gmail with the
league address as reply-to.

When the board copy is switched on and has a **Receipt sent** or **Last
follow-up** column, each live send writes its date (and the round's name) on
that sponsor's row, so the sheet shows it too.

The receipt and the follow-ups carry the LYBS logo as a letterhead, top left
(`icons/lybs-wordmark.png`, attached inline when sent; `LEAGUE_LOGO_URL`
overrides it).
