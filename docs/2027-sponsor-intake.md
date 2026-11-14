# 2027 sponsor banner intake

Every sponsor at $500 and up (MVP, Championship, Championship+) gets a 3x5
banner. This is how each one gets caught, asked for their info, and matched
to a banner, however they signed up.

## The path, start to finish

```
  HOW THEY SIGN UP                     WHAT CATCHES IT (every hour, Season.gs)
  ─────────────────                    ──────────────────────────────────────
  Website sponsorship form  ──────►  OnlineLogs tab of the 2027 sponsorship sheet
  Website payment, no form  ──────►  "Donation received from …" email in Nate's Gmail
  Email / check / in person ──────►  a row on the "2027 sponsors" tab (Amount $500+)
                                     or "＋ Add sponsor" in the app
                                              │
                                              ▼
                         "2027 Banners" tab of the private data Sheet
                                              │
              ┌───────────────────────────────┼───────────────────────────────┐
              ▼                               ▼                               ▼
   Email to Nate: "New 2027           Info email to the sponsor        2027 tab in the app:
   banner sponsors (n)"               (Gmail draft, or sent)           assign a banner from
                                      with their own form link         stock, or mark "Order new"
                                              │
                                              ▼
                                  intake.html (the reply form)
                                  drop-downs + logo/design uploads
                                              │
                                              ▼
                       Files → Drive "2027 Sponsor Submissions/<Company>"
                       Answers → their row      Email to Nate: "info received"
```

**Why a form page and not a form inside the email:** most mail apps (Gmail
included) strip drop-downs and file buttons out of emails, so the email
carries one button that opens a small page instead. Each sponsor's link has
a long random code in it, so the page only ever shows and fills in that one
sponsor. Sponsors don't need a Google account, which a Google Form with file
uploads would have required.

**Website payments with no form** only tell us a person's name and the
amount. The scan matches the name to a contact on the sponsorship sheet
(or the same last name and the same amount). With no match the row is
called "Needs a match: <name>", Nate gets told, and no sponsor email goes out
until he fills in the company and email.

## The sponsor email

Variables in braces. Same asks as the 2026 "Sponsorship Info Request" email.

> **Subject:** LYBS 2027 sponsorship: your banner and sponsor info
>
> Hi {first name},
>
> Thank you so much for sponsoring Lunenburg Youth Baseball & Softball at the
> {tier} level ({amount}) for 2027. We are excited to have {company}'s support!
>
> To make sure you are properly recognized, please fill out this short form
> by {deadline}:
>
> **[ Send us your banner & sponsor info ]**  ← {their personal form link}
>
> It asks for:
> - The website or social link for your sponsor listing
> - Your business name as it should appear on the team jersey
> - A short write-up about your business (up to 200 characters) for our website
> - A high resolution logo (PNG, SVG, AI, EPS, PDF or JPG)
> - Your 3x5 vinyl banner for the fence at Marshall Park: reuse last season's,
>   send a print-ready design, or we can design one with your logo
>
> If the button gives you any trouble, just reply to this email with the same
> info and attach your files.
>
> Thank you again!
>
> Nate Steele
> Director & IT/Social Media Coordinator
> Lunenburg Youth Baseball & Softball

It goes from Nate's Gmail with info@lunenburgybs.com copied, like last year.
Wording, deadline, CC and signature are constants at the top of `Season.gs`.

## The reply form (intake.html)

| Field | Kind |
|---|---|
| Name, email, phone | text (name and email required) |
| Website or social link | link |
| Business name for the jersey | text, required |
| Sponsor write-up | 200 characters, with a counter |
| Logo | file upload, required (or a share link) |
| What should we do for your banner? | drop-down: reuse last season's / attaching a print-ready design / please design one |
| Banner design | file upload, shows when they pick "attaching" |
| Wording, colors, notes | shows when it's a new banner |
| Share link for big files | link |

Files up to 15 MB each, 30 MB in all. PNG, JPG, PDF, SVG, AI, EPS, PSD and
TIFF are recognized by their contents, not their names.

## Turning it on (one time, in the Apps Script editor)

1. Open the Sponsor Banner Inventory Apps Script project.
2. Replace `Code.gs` with this repo's `apps-script/Code.gs`.
3. Files → + → Script, name it `Season`, paste in `apps-script/Season.gs`.
4. Pick `installSeasonTrigger` in the function menu and press Run. Google asks
   for Gmail permission (to read the league's donation notices and make the
   sponsor emails); allow it. This turns on the hourly check.
5. Deploy → Manage deployments → pencil → Version: New version → Deploy.
   The `/exec` URL stays the same.

Sponsor emails start as **drafts** in Gmail. To have them send on their own,
run `setRequestMode('send')` once (or set Script property `REQUEST_MODE` to
`send`). `removeSeasonTrigger` turns the hourly check off.

## For next season

Change `SEASON`, `SPONSOR_SHEET_ID`, `SPONSOR_TAB`, `INFO_DEADLINE` and
`DONATIONS_SINCE` at the top of `Season.gs`. A new "<year> Banners" tab is
made on its own.
