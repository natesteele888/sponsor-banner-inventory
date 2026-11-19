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

## What the Sponsors list shows first

The list opens on this season's sponsors (anyone with an amount this season), named by the season, for example "2027 sponsors". Every year's rows are one pick away under **Show → All sponsors, every year**, along with the other views.

## Donation receipts for paid sponsors

When a sponsorship editor marks a row **Paid?** and the row has an email and an amount, the Sponsors tab shows it under **Receipts to send**. **Mark paid** on a sponsor's card opens that receipt's preview right there, with its own **Send** button (twice: the second tap sends). From the list, **Preview** shows the email and **Send** sends it the same way. Nothing is ever sent on its own; there is no trigger. Only the sponsorship editors (see Board edits) can send a receipt or mark one done; anyone else signed in sees the preview only. Sponsors get this receipt from here whether they paid by check or online, so Crossbar's receipt is not used for a sponsor (a row whose Paid? or Notes says online, website, Crossbar or card is tagged **Paid online** as a reminder). Plain donations that aren't for a sponsorship never show here; those keep Crossbar's own receipt. **Not needed** takes a row off the list (and **Undo** puts it back).

**Record a payment** (editors only) is for a payment that just came in, online or by check. Type who paid, the amount, how, and their email if you have it, then **Find them**. The app lists the likeliest rows first: signed up and waiting on payment, then people someone reached out to, then walk-ins, then everyone else, and last anyone already marked paid. It matches the business name, the contact's name or the email. Pick one (**This one**, tapped twice) and it marks that row paid, sets the amount if it differs, fills a missing email, adds "Paid by check" or "Paid online" with the day to Notes, opens the sponsor and opens the receipt preview. **Add new sponsor** does the same for someone who isn't on the sheet yet. Nothing is sent until **Send** is tapped.

The email is laid out like the league's Crossbar emails: a light grey page, a centered 650px column with the league logo on top, white cards with rounded corners, and a small grey footer with the league's name and address.

The email is the league's non-profit donation receipt (donor, contact, address, amount, date, the no-goods-or-services line, who issued it, the 501(c)(3) line with the EIN) with the league letterhead. Above it, as its own card with space between, is the one step left for the sponsor: "One more step: your sponsor info packet" and a **Fill out your sponsor packet** button. The receipt card stands alone, so a screenshot of it is a clean tax copy. A PDF of the receipt alone (no packet card, no link) is attached to every receipt email. In the app, **Preview** on a waiting row and **Open receipt** on a sent one show the receipt with a **Print / Save as PDF** button, which prints the receipt without the packet card. Each sent receipt is remembered in the `RECEIPTS_<season>` Script Property, so it is never sent twice. A changed amount is a new receipt. This never writes to the sponsorship sheet.

Setup (Apps Script editor):

1. Add `apps-script/Receipts.gs` as a new script file named `Receipts`, and paste the new `Code.gs`.
2. In **Project Settings → Script Properties**, add `RECEIPT_ORG_ADDRESS`, `RECEIPT_EIN` and `RECEIPT_ISSUER` as the old receipt shows them, `SPONSOR_PACKET_URL` (change it here when the packet page moves), and `RECEIPTS_TEST_TO` (your own address).
3. Deploy a new version. Google asks once to allow sending email as you.

Heads-up: run `installReceiptPing` once from the editor. Every hour, any receipt that has just started waiting gets one short email to you (or to `RECEIPTS_PING_TO`), never to a sponsor, with a link to the Sponsors tab. Each receipt is mentioned once. `removeReceiptPing` turns it off.

Until `RECEIPTS_LIVE` is set to `on`, every Send goes only to `RECEIPTS_TEST_TO`, marked [TEST], and the row stays in the list. Set `RECEIPTS_LIVE` to `on` only once the board agrees to send to sponsors; delete it to go back to test mode.

## Sponsor info packets

What sponsors send on the info packet page (level, business, jersey name, write-up, socials, banner choice, logo) shows under **Sponsor info packets** on the Sponsors tab, newest first, with new ones marked. Open one to see everything they sent and the logo from its files folder. A sponsor's card says "Info packet in" when the business name matches. It's read live from the "LYBS Sponsor Info Packets" sheet (tab Packets) and never written to. A packet whose business isn't on the sponsor list yet has an **Add to sponsor list** button (any signed-in board member): it adds a row with the business, contact, email, phone, level and amount from that packet, marks it contacted and signed up, and notes the packet's date. The backend reads the packet row itself, so the page can't change what goes in. A business already on the list is refused, so nothing goes in twice.

Setup: add `apps-script/Packets.gs` as a script file named `Packets` and deploy a new version. The sheet is found by its name. When it moves (for example to the league's info account), share the sheet and its folder with the account this script runs as, and set the `PACKET_SHEET_ID` Script Property if the name changes. Put the packet page's link in `SPONSOR_PACKET_URL` so receipts include it; change it there when the page moves.

## Board edits (straight into the shared sheet)

Edits made in the app go straight into the one sponsorship sheet the app reads.
With `SPONSOR_SHEET_USE` unset, that's the sponsorship lead's sheet, found by
its name. With `SPONSOR_SHEET_USE` set to the board's own sponsor sheet, it's
that one. There is no separate copy to keep in step either way.

**The board's own sheet** has a tab people type in, **Enter sponsors here**,
and a sorted view tab (`<season> sponsors`) that is all formulas. When the
sheet has a tab named Enter sponsors here, the app reads and writes that tab
and never the view (the `SPONSOR_TAB_USE` Script Property can name another
tab). Everything else that reads sponsors goes through this backend, so it all
moves together: the Sponsors tab, receipts and follow-ups, the year-over-year
strip, the hourly banner scan, the Dashboard (`sponsorSheet`) and Ballclub
team pages (`teamPageSponsor`).

On that sheet **Status** is a typed dropdown, not a formula, so it follows each
change made in the app: Mark paid → Paid; Not sponsoring → Not sponsoring; a
level or amount entered → Signed up, not paid; Mark contacted → Contacted
(from Not contacted or Walk-in); Walk-in only → Walk-in, not visited (from Not
contacted); a new row → Not contacted, or Contacted when added as contacted.
A change that sets Status itself keeps it as given. Each move is in the Change
log. A sheet whose Status is a formula, or that has no Status column, is
never given one. Follow-up emails also skip a row whose Status is Paid or Not
sponsoring. Set `SPONSOR_EDITS` to `off` to stop every edit at once (the app goes
back to read-only); delete it to turn edits back on.

- **Add a contact:** any signed-in board member can add a person or business
  they reached out to. A name already on the sheet is refused. Columns the
  sheet works out with a formula get the row above's formula.
- **Edit a row, Mark paid, Mark contacted, Not sponsoring, Assign:** only
  editors. Editors are the league admin account plus the Google addresses in
  the Script Property `SPONSOR_EDITORS` (comma separated). Formula columns are
  left alone. "Not sponsoring" goes in the Contacted? column and takes the row
  off follow-up emails. Adding a contact opens the new row in the edit form,
  so an editor can fill in every other column right away.
- **The sheet's own dropdowns and checkboxes:** the edit form reads them from
  the sheet each time (nothing about the choices is in this repo). A dropdown
  column is a dropdown in the app, keeping any value already there that the
  list doesn't have. A checkbox column is a checkbox. A value that a strict
  dropdown (like Status) refuses is turned down before anything is written,
  with the choices it takes, and a change the sheet still refuses when it
  lands says so rather than "Saved".
- **Hold to confirm:** Mark paid, Mark contacted, Not sponsoring, Assign and
  Save changes are pressed and held until the ring fills. A plain tap asks
  "Tap again or hold" with what will change (for example "Amount: $500 →
  $1,000"); a second tap within a few seconds does it, which also works from
  the keyboard. Each one then shows a ✓ line such as "Paid."
- **Change history:** every change made in the app (who, what, old → new,
  when) is written to a **Change log** tab in the same sheet, made the first
  time it's needed. Each sponsor's card shows its own changes under
  **Changes**.
- Each save checks the row still holds the same sponsor, so a sheet that was
  re-sorted since the page loaded is not written to the wrong row.

## Views, towns and owners

- **Show** has: this season's sponsors, all sponsors, past sponsors nobody has
  reached out to yet, needs a new owner, walk-in only, and **My sponsors**.
- **Town** filters by the town in the Address column.
- **Assign:** editors set a sponsor's owner (the LYBS Owner column) on its
  card. **My sponsors** lists the rows whose owner is you; it shows once
  `SPONSOR_PEOPLE` is set, as `Name = google address, Name = google address`
  (the name is how you appear in the LYBS Owner column).
- **Needs a new owner:** past sponsors not signed this season whose owner is
  blank or only former board members. Former members are listed in
  `SPONSOR_FORMER_OWNERS` (comma separated first names as they appear in the
  sheet). The card still shows who reached out last year.
- **Walk-in only:** editors can label a sponsor walk-in only (a "Walk-in only"
  column, made the first time). Its card shows the address with a map link
  and a **Print form** button that opens the printable sponsorship form. The
  form lives in the league's Drive, never in this repo; set `WALKIN_FORM_ID`
  to its Drive file id. The app only hands it to signed-in board members.

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

## Paid sponsors for the posting plan (Spotlights.gs)

The Sponsors app shows nothing social. Marking a sponsor paid is the trigger
for the Dashboard's Social Studio, which asks this script for paid sponsors at
Championship or MVP (`spotlightSponsors`: level, team, jersey name and
write-up, no contacts or amounts) and their logo (`spotlightLogo`), plans
their spotlight posts and hands back the card it drew (`spotlightCardSave`).
The card is filed as `spotlight-<key>.png` in a **Sponsor Spotlight Cards**
folder in the Drive of the account this script runs as. The folder is made
private, and nothing is saved there if anyone has been given access to it.
The three actions answer the league admin only, the one account Social
Studio opens for. Nothing here posts anywhere. See lybs-reporting
`docs/social-spotlights.md`.
