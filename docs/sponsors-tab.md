# Sponsors tab

The app's first tab shows the season's sponsorship sheet (the one the
sponsorship lead keeps, named `<season>_Sponsorship Sheet` in Drive) as it is
right now: who owns each sponsor on the board, who has contacted them, the
contact person, phone and email, last year's and this year's level, amount,
paid, and the banner and plaque flags. Every column on the sheet shows on a
sponsor's detail, so a column the board adds later shows up with no change
here. The sheet's other tabs (website form log, jerseys, plaques) are listed
under the sponsors.

```
  sponsorship sheet in Drive (read only from here; never changed)
          │   sponsorBook, behind the Dashboard sign-in (board/director/admin)
          ▼
  Sponsors tab ── Save team ──► "<season> Sponsor Teams" tab
                                 of this app's private data Sheet
                                        │   sponsorSheet (no contact columns)
                                        ▼
                     LYBS Dashboard: Uniforms and Jersey Order pages
```

## Where the data lives (for the Nate Brain and other apps)

- **Sponsors, contacts, levels, paid:** the sponsorship sheet in Drive. Found
  by its name, `<season>_Sponsorship Sheet`; the backend remembers its address
  in the Apps Script project's Script Properties (`SPONSOR_SHEET_ID_<season>`).
  The address is not written in this repo on purpose.
- **Sponsor to team:** tab `<season> Sponsor Teams` of the private
  "Sponsor Banner Inventory (data)" Sheet. Columns: key, company, division,
  team, note, updatedAt.
- **Banner-level sponsors ($500+) and their banner plan:** tab
  `<season> Banners` of the same private Sheet (see 2027-sponsor-intake.md).
- **How another app reads it:** POST to the Apps Script `/exec` address in
  `config.js` with a Dashboard sign-in token: `sponsorBook` (everything,
  contacts included, for this app), `sponsorSheet` (no contacts, for the
  Dashboard), `seasonList` (banner sponsors). Only the board, director and
  admin roles get an answer.
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
4. Deploy → Manage deployments → pencil → Version: New version → Deploy.
   The `/exec` address stays the same.

The first time the tab opens, the backend looks the sheet up by name. If the
sheet is ever renamed, run `forgetSponsorSheet` once from the editor.
