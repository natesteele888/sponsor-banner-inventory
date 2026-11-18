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
