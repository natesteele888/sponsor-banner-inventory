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
  is used, and with neither, the matching logo from the league's Sponsor Logos
  folder (below). Only files in those folders, or that sponsor's own form
  folder, are ever served.
- **Sponsor Logos folder:** one logo per sponsor in a Drive folder named
  `Sponsor Logos` (in the league's Assets and Logos folder), each file named
  for its sponsor. A sponsor whose sheet name matches a file there shows that
  logo on its card, in its team page logo box and on its team page, with no
  one setting it. Names match exactly ("&" and "and", "LLC", "Inc", "P.C." and
  case don't count), or closely when the two start the same for at least 9
  letters and are each other's only close match, so a shared town name alone
  never matches. Add a logo by dropping a PNG/JPG/GIF/WebP named for the
  sponsor into the folder; the app sees it within ten minutes. The folder is
  found by name and remembered in the `SPONSOR_LOGO_FOLDER_ID` Script
  Property (run `forgetSponsorLogoFolder` if it is ever replaced). Board-only
  action `sponsorLogoList` gives a small copy of each matched logo.
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

One line under the counts gives this season's committed total, where last
season stood on the same date, and last season's final. Tap the line for two
plain bars with their numbers printed on them, nothing to hover: gray is last
season's whole sponsor money, with a dark mark and its amount where it stood on
this date (when a dated total exists), and blue is this season so far. Under
them are the month-by-month totals. In kind is left out of both years' dollars.

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

**Record a payment** (editors only) is for a payment that just came in: Crossbar (online), check, cash or Venmo. Type who paid, the amount, how, a check number or Venmo name if there is one, and their email if you have it, then **Find them**. The app lists the likeliest rows first: signed up and waiting on payment, then people someone reached out to, then walk-ins, then everyone else, and last anyone already marked paid. It matches the business name, the contact's name or the email. Pick one (**This one**, tapped twice) and it marks that row paid, sets the amount if it differs, fills a missing email, puts how they paid in the sheet's **Paid how** column (Crossbar (online), Check, Cash or Venmo), adds a line such as "Paid by check Nov 19 ($300, check #1234)" to Notes, opens the sponsor and opens the receipt preview. **Add new sponsor** does the same for someone who isn't on the sheet yet. Nothing is sent until **Send** is tapped.

The email is laid out like the league's Crossbar emails: a light grey page, a centered 650px column with the league logo on top, white cards with rounded corners, and a small grey footer with the league's name and address.

The email is the league's non-profit donation receipt (donor, contact, address, amount, date, the no-goods-or-services line, who issued it, the 501(c)(3) line with the EIN) with the league letterhead. Above it, as its own card with space between, is the one step left for the sponsor: "One more step: your sponsor info packet" and a **Fill out your sponsor packet** button. The receipt card stands alone, so a screenshot of it is a clean tax copy. A PDF of the receipt alone (no packet card, no link) is attached to every receipt email. In the app, **Preview** on a waiting row and **Open receipt** on a sent one show the receipt with a **Print / Save as PDF** button, which prints the receipt without the packet card. Each sent receipt is remembered in the `RECEIPTS_<season>` Script Property, so it is never sent twice. A changed amount is a new receipt. When the sheet has a **Paid how** column, the receipt names the payment method. This never writes to the sponsorship sheet.

Setup (Apps Script editor):

1. Add `apps-script/Receipts.gs` as a new script file named `Receipts`, and paste the new `Code.gs`.
2. In **Project Settings → Script Properties**, add `RECEIPT_ORG_ADDRESS`, `RECEIPT_EIN` and `RECEIPT_ISSUER` as the old receipt shows them, `SPONSOR_PACKET_URL` (change it here when the packet page moves), and `RECEIPTS_TEST_TO` (your own address).
3. Deploy a new version. Google asks once to allow sending email as you.

Heads-up: run `installReceiptPing` once from the editor. Every hour, any receipt that has just started waiting gets one short email to you (or to `RECEIPTS_PING_TO`), never to a sponsor, with a link to the Sponsors tab. Each receipt is mentioned once. `removeReceiptPing` turns it off.

Until `RECEIPTS_LIVE` is set to `on`, every Send goes only to `RECEIPTS_TEST_TO`, marked [TEST], and the row stays in the list. Set `RECEIPTS_LIVE` to `on` only once the board agrees to send to sponsors; delete it to go back to test mode.

## Sponsor info packets

What sponsors send on the info packet page (level, business, jersey name, write-up, socials, banner choice, logo) shows under **Sponsor info packets** on the Sponsors tab, newest first, with new ones marked. Open one to see everything they sent and the logo from its files folder. A sponsor's card says "Info packet in" with the day and what kind it was (same as last year, N changes, or new sponsor), matched to the sponsor it was sent for, not the name they typed; a paid sponsor without one says "Waiting on info packet". Their detail opens with what they sent and the logo. Under the packets, **Paid, waiting on their info packet** lists paid sponsors with none back yet, and whether their receipt (which carries the packet link) has gone out. It's read live from the "LYBS Sponsor Info Packets" sheet (tab Packets) and never written to. A packet whose business isn't on the sponsor list yet has an **Add to sponsor list** button (any signed-in board member): it adds a row with the business, contact, email, phone, level and amount from that packet, marks it contacted and signed up, and notes the packet's date. The backend reads the packet row itself, so the page can't change what goes in. A business already on the list is refused, so nothing goes in twice.

Setup: add `apps-script/Packets.gs` as a script file named `Packets` and deploy a new version. The sheet is found by its name. When it moves (for example to the league's info account), share the sheet and its folder with the account this script runs as, and set the `PACKET_SHEET_ID` Script Property if the name changes. Put the packet page's link in `SPONSOR_PACKET_URL` so receipts include it; change it there when the page moves.

## The sponsor's own page (sponsor.html)

The **Fill out your sponsor packet** button in each receipt opens that sponsor's own page: `sponsor.html?t=...`, with a long random token made the first time their receipt is previewed or sent. Tokens live only on the private data Sheet's **2027 Sponsor pages** tab, never in this repo. The page shows the business, the contact's name and the level they paid for, locked as **Paid**, with their info form right under it. The levels above theirs show as optional upgrades with only the difference owed. Picking one adds that level's fields (write-up, banner) and shows how to pay the difference: Venmo and an online link when `SPONSOR_PAY_VENMO` and `SPONSOR_PAY_ONLINE_URL` are set in Script Properties, a check to the league's mailing address, or cash to a board member.

What they send goes on the **LYBS Sponsor Info Packets** sheet's Packets tab, with their files in a folder inside the packets folder, so it shows under Sponsor info packets like any packet. Its Level says "(paid)", or "(upgrade from ..., $N more owed)".

An upgrade only counts once the difference is paid. Until then the sheet keeps the old level and amount, the sponsor's card says "Upgrade to ... asked, $N to pay", and **Record a payment** lists them first under "Upgrade waiting on payment". Recording a payment for them adds it to their amount. Once the whole difference is in, it sets the new level, ticks Owed a Banner when the new level has one, and marks the upgrade counted. Their next receipt is for the new money only, with the season total under it.

The levels and prices are the defaults in `apps-script/SponsorPage.gs` (Gameday any amount, All-Star $300, MVP $500, Championship $750 and up, as on the league's Become a Sponsor page). Set `SPONSOR_LEVELS` in Script Properties to change them without new code.

Setup: add `apps-script/SponsorPage.gs` as a script file named `SponsorPage` and deploy a new version.

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

## What the app is allowed to email

Every email the script sends goes through one guard in `Mail.gs`, and the
script asks Google for as little as it can (`apps-script/appsscript.json`).

- **What Google still lets the script do:** send email as the script owner,
  read their mail (it looks for Crossbar donation notices) and make drafts.
  It can't delete, change or label mail, and it can't send as another
  address, so there's no Send-as for the league address any more.
- **What the code allows on top of that:** only the app's own emails
  (receipts, follow-ups, outreach, welcome, the packet notice and the owner's
  alerts). Each one goes only to the address on that sponsor's own row. A
  receipt may also copy, at most, two addresses: the row's own CC column, or
  what an editor types in the receipt's CC box. Notices go only to the script
  owner (or `RECEIPTS_PING_TO`). Anything else is refused and logged, never
  sent.
- **After this change:** open the project, press Run on any function once and
  Allow the shorter list of permissions. Until that's done the web app asks
  for it.

Replies to receipts go to the league address (`SEND_FROM`) as reply-to.

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

## Outreach

The Outreach tab sends the first "would you sponsor us?" email to businesses on the sheet that nobody has reached yet. It lists the rows the sheet still shows as not contacted (filter by the sheet's own Status and LYBS Owner), and each row is checked before it can be picked:

- Held, can't be ticked: no email, an email cell with no address in it, already emailed from here, said no, or walk-in only.
- Needs a look, starts unticked: the contact's name doesn't match the address (a books person or a front desk can be right), more than one address in the cell, the same address on another row, or the sheet already says contacted.

Pick who it's from (your own Gmail), tick up to 15, preview any of them (To and the greeting side by side), and tap Send twice. Each business gets its own email with only its address in To: never a shared To, CC or BCC. Right before sending, each row is read again and must still have the same business and address. Sent rows get the sender's name in Contacted? and Status moves to Contacted, logged like any other change. Nothing runs on a schedule.

Setup (Apps Script editor): add `apps-script/Outreach.gs` as a new script file named `Outreach`, then deploy a new version. Optional Script Properties: `OUTREACH_PACKET_FILE` (Drive id of the packet PDF to attach), `OUTREACH_LEVELS_URL` and `OUTREACH_SIGNUP_URL` (the league pages the email links to), `OUTREACH_SIGN` (sign-off lines), `OUTREACH_DAY_MAX` (most a day, 40 by default).

## Welcome

Sponsors who sign up on the league website get the website's thank-you and next steps email straight away. Anyone who pays by check or is added to the sheet by hand doesn't, so the Welcome tab sends them the same email from the app.

- **Who's listed:** every row that's signed up, paid, or has a tier picked, unless it says not sponsoring. Each shows "Needs welcome email" or how it got one (from the website, sent here, or marked by hand), and the same line shows on the sponsor's card.
- **From the website:** matched by business name against the sheet's OnlineLogs tab, so those are never listed as needing it.
- **The email:** thank-you, the level and season, and next steps. A paid sponsor hears that the payment came in; an unpaid one gets the payment deadline, the online payment page and, when `RECEIPT_ORG_ADDRESS` is set, where to mail a check.
- **Sending:** Preview first, then Send twice. One email per sponsor, only their address in To, no CC or BCC, from the same sender picker as Outreach. Rows with no address can't be sent; rows that need a look say why and send only on "Looked, send".
- **Already had it:** marks a sponsor done without sending.

Nothing runs on a schedule, nothing changes on the sheet, and the record of who's had it lives in the script's own properties.

## Who it's from

Outreach and Welcome emails come from whoever is signed in and are signed by them. Receipts always come from the script owner.

- **The script owner:** the app sends straight from their Gmail, as before, with their sign-off (`OUTREACH_SIGN`).
- **Any other board member, one-time Allow:** they tap **Send from my Gmail** twice, a small page opens, and the email goes from their own Gmail. The first time, Google asks them to Allow one thing: send email as them. **Back to the app** marks the row. See One-time Allow below.
- **Without the Allow sender set up:** each email opens filled in, in their own Gmail (or their phone's mail app). They press Send there, then tap **I sent it** so the sheet and the Welcome list catch up.
- These emails link to the levels on the league site instead of attaching the packet.
- **A title under the name:** set `OUTREACH_SIGNS` to JSON like `{"their@email": "Their Name\nTheir title"}`.

### The greeting

"Hi" and the contact's first name, or "Hi [Business] team" when there's no name (LLC, Inc and the like left off), never "Hi there". A past sponsor (last season's level, or "Has sponsored in past") is thanked for last season first; a new one hears who's writing and why in the first line.

## One-time Allow (apps-script-sender/)

A separate small Apps Script project that runs as whoever opens it, so an email goes from that board member's own Gmail. It can only send an email this app made and signed, to that one address, once, for the board member it was made for, within 15 minutes.

1. New Apps Script project, named "LYBS Sponsor Sender". Paste in `apps-script-sender/Code.gs`, and in Project Settings tick "Show appsscript.json" and paste in `apps-script-sender/appsscript.json`.
2. Script Properties in both projects: `SENDER_SECRET`, the same long random string (24 characters or more) in each. Never in this repo.
3. Deploy the sender: Deploy → New deployment → Web app, Execute as: User accessing the web app, Who has access: Anyone with a Google account. Copy its `/exec` link.
4. In the main project's Script Properties, set `SENDER_URL` to that link.

Without both settings, board members keep the open-in-Gmail way.

## In kind and a second banner

- **In kind:** a sponsor paying in goods or services. It shows as In kind when the sheet's Paid how column says so, or, on a sheet with no such column, when the notes say "paid in kind" (Record a payment's In kind writes that note). In kind is counted on its own, never as dollars, and its receipt describes the gift with no dollar amount.
- **A second banner:** when the sheet's **Banner needed?** cell says 2 banners (or a second banner) and has the wording in quotes, the next check for new sponsors adds a row on the 2027 banners tab named "[Sponsor] (second banner)", with that wording, Design needed and Order new. It has the sponsor's level, adds no money and no sponsor to the counts, gets no info-request email, and is paid when the sponsor is.

## Cards and counts

- **Cards:** under the name, the level as a colored pill (Gameday, All-Star, MVP, Championship each their own color, In kind in green), then short pills for where it stands: contacted, packet in or waiting, welcomed or needs one, needs an owner. Owner and contact sit on their own line in bold. The paid and receipt status stays the badge on the right. Notes and write-ups sit behind a Notes tap.
- **Counts:** every count is a button. Committed, paid, in kind, this season's sponsors, past sponsors and needs an owner each show just those sponsors. Not contacted opens Outreach showing the ones ready to send. The line under the three big buttons lists what's waiting (receipts, welcome emails, outreach, packets, banners to order), and each one opens its list. On the 2027 banners tab every count shows its banners.

## The packet loop

Each packet sent from a receipt link emails the script owner (never the sponsor) one notice of three kinds:

- **Returning, same as last year:** good to proceed, including the banner when last year's is in banner stock.
- **Returning with changes:** each change listed against what the board sheet has (level, contact, email, business name, a new logo, jersey name, write-up, banner). Last year's jersey names and write-ups weren't kept, so those show as sent.
- **New sponsor:** everything they sent, and either "banner file ready" or "you make the banner".

The kind and a one-line note go on the sponsor's private pages record (`packetAt`, `packetKind`, `packetNote`). For a banner level the sponsor's row on the 2027 banners tab is filled in too: Info received, their answers and files, and the banner: from stock (the banner in stock with their name is assigned when there's exactly one and it's free) or Order new, with **What the banner needs** (In stock, File in hand ready to order, Design needed, or Check with sponsor). A status set by hand (Reprint needed, Ordered, Ready to hang) is left alone. An upgrade waiting on payment shows as waiting on payment.

The 2027 banners tab counts ready to order and need a design, and shows what this year's new banners cost: the paid banners still to buy, times the per-banner price in the private Script Properties `BANNER_ORDER_EACH` (all in), with `BANNER_ORDER_VENDOR` and `BANNER_ORDER_NOTE`. Pricing only: nothing is ordered from the app.
