# Spendable 🪙

A cute, super-simple budgeting web app for people who **don't want to budget**.
It answers one question:

> **How much can I spend right now and still have enough for my bills?**

No accounts, no logins, no spreadsheets. Open it, add your bills once, and each
month tick them off as they leave your account — the app always shows the one
number that matters: **what's safe to spend.**

> Live app: enable GitHub Pages for this repo and open
> `https://netblue4.github.io/LanguageLearner/`
> *(the repo is still named "LanguageLearner" — the app inside it is Spendable; you can rename the repo in Settings if you like.)*

---

## How it works

**The maths is just:**

```
safe to spend  =  current balance  −  bills you haven't paid yet
```

When a bill leaves your account, your balance drops **and** that bill is no
longer "owed" — so your safe-to-spend stays the same. That's the whole trick:
you always know what's truly yours to spend.

### Two screens

**1. Budget** (set up once)
- Tap a common bill (Rent, Water, Electricity, Phone…) or type your own
  (e.g. *"Jenny uni fees"*).
- Enter the amount.
- Choose **Every month** (recurring) or **One-off** (e.g. *"pay Jenny back"*).

**2. Monthly** (use all the time)
- Pick the month.
- See your big **safe-to-spend** number and a progress bar of what's left.
- Tap the green **✓** next to a bill the moment it comes off your account.
- Tap **Balance** to punch in your current account balance.

That's it. Recurring bills show up automatically every month; one-offs show up
only in the month you add them.

---

## Your data & privacy

- Everything is stored **only on your device**, in the browser's `localStorage`.
  Nothing is uploaded anywhere; it works offline.
- It survives closing the app, reloading, and adding it to your home screen.
- It would be lost if you clear the browser's site data, so the **Budget →
  Settings → Backup** section lets you **Export** a backup file and **Restore**
  it (handy for moving to a new phone).

---

## Install it on your phone (PWA)

1. Enable GitHub Pages (repo **Settings → Pages → Deploy from branch → `main` / root**).
2. Open the site URL on your phone.
3. Browser menu → **Add to Home Screen**. It then opens full-screen like a normal app.

---

## Project structure

| File | Purpose |
|------|---------|
| `index.html` | The two screens + add/balance sheets |
| `styles.css` | Cute, pastel, mobile-first styling |
| `app.js` | All logic + `localStorage` persistence |
| `manifest.webmanifest` | PWA metadata |
| `sw.js` | Offline caching service worker (network-first) |
| `icons/` | App icons |

No build step, no dependencies — just static files.
