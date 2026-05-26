# 🐢 Tutel Sightings

A public, searchable, filterable archive of every appearance by **Vedal987** on other people's streams.

Hosted on **[GitHub Pages](https://angishyguy.github.io/tutel-sightings)**.

![Tutel Sightings preview](https://i.imgur.com/25VGr4l.png)

---

## 🎬 YouTube Only

Tutel Sightings only supports **YouTube VODs**. Twitch VODs expire after a limited time and the viewing experience is generally poor for archival use. (This mirrors the approach taken by [Library of Ladev](https://libraryofladev.com), a similar community tool for Neuro-sama VODs.)

If a collab was streamed live on Twitch but later uploaded to YouTube, use the YouTube upload.

---

## ✨ Features

- **Card grid** — every appearance shown as a card with the YouTube thumbnail, colored tag chips, title, date, and collab duration
- **Filterable tags** — click any chip (activity, game, collab partner, appearance weight) to filter instantly. Filters are AND-based: selecting multiple tags narrows results down, not up
- **Search** — matches title, partner names, and game names
- **Sort** — by date, collab duration, or partner count; ascending or descending
- **Collab duration** — computed from per-VOD timestamps. Single and multi-POV entries show one time; ranged POV entries show `min ~ max`; multi-part entries sum the parts
- **Multi-VOD support** — entries with multiple POVs or sequential parts show a cursor-position dropdown when clicked, with each VOD labeled and color-coded by streamer
- **Overflow chips** — tag chips are limited to 2 lines; anything beyond that collapses into a `+N more` chip with a hoverable tooltip showing the rest as clickable tags
- **Watch history** — mark entries as watched/unwatched via the `···` menu. Stored in your browser's localStorage — never leaves your device, never visible to anyone else
  - **Export / Import** — back up your watch history as a JSON file and restore it on another browser or device
  - **Clear data** — wipe your watch history with a two-tap confirmation
- **Mobile support** — responsive layout with a slide-in drawer sidebar on small screens

---

## 🗂️ Data Schema

All appearance data lives in `data/appearances.json` as an array of entry objects.

### Full entry example

```json
{
  "id": "pico-park-human-fall-flat-big-collab",
  "title": "Massive Pico Park & Human Fall Flat Collab",
  "date": "2023-04-14",
  "activities": ["Gaming"],
  "games": ["Pico Park", "Human Fall Flat"],
  "collab_partners": ["Camila", "Saiiren", "Miwo", "MOTHERv3", "OkCode"],
  "appearance_weight": "Full",
  "vod_type": "povs",
  "vods": [
    {
      "vod_title": "18+ Nya Meow Meow | !patreon !discord !yt",
      "streamer": "Miwo",
      "video_id": "S2GGvh8uA2M",
      "timestamp_seconds": 214,
      "timestamp_end_seconds": 11258
    },
    {
      "vod_title": "MASSIVE COLLAB TODAY || REACTING TO BAD DATES || ...",
      "streamer": "MOTHERv3",
      "video_id": "aQ5cqEkgT-8",
      "timestamp_seconds": 4860,
      "timestamp_end_seconds": 15899
    }
  ],
  "notes": null
}
```

### Entry fields

| Field | Type | Description |
|---|---|---|
| `id` | string | Unique slug identifier in kebab-case |
| `title` | string \| null | See **Title Logic** below |
| `date` | string \| null | Stream date as `YYYY-MM-DD`, or `null` if unknown |
| `activities` | string[] | See **Activity Tags** below |
| `games` | string[] | Game name(s), or `[]` if not a gaming session |
| `collab_partners` | string[] | All other VTubers present |
| `appearance_weight` | string | See **Appearance Weight** below |
| `vod_type` | string | `"povs"` or `"parts"` — see **Collab Duration** below. Defaults to `"povs"`. Only relevant for multi-VOD entries |
| `vods` | object[] | One or more VOD objects — see below |
| `notes` | string \| null | Optional freeform notes, not displayed publicly |

### Title logic

1. If `title` is set → use it
2. If `title` is `null` and there is one VOD → use that VOD's `vod_title`

Set `title` when:
- The entry has **multiple VODs** (required — there's no single title to fall back to)
- The **real VOD title** gives no useful context (streamers name things terribly sometimes)

Otherwise, leave `title` as `null` and let the VOD title speak for itself.

### VOD object

```json
{
  "vod_title": "UNCAPPED SUBATHON DAY 4 | P.2",
  "streamer": "Saiiren",
  "vod_part": 1,
  "video_id": "Q1-vkW-oYVY",
  "timestamp_seconds": 40620,
  "timestamp_end_seconds": 43081
}
```

| Field | Type | Description |
|---|---|---|
| `vod_title` | string | The real title of the VOD as it appears on YouTube |
| `streamer` | string | The streamer whose POV this is. Must match a name in `collab_partners` |
| `vod_part` | integer \| null | Part number for `"parts"` entries (`1`, `2`, …). `null` for `"povs"` entries |
| `video_id` | string | The YouTube video ID — the part after `?v=` or `youtu.be/` |
| `timestamp_seconds` | int \| null | When Vedal *appears*, in seconds. `null` if he's there from the start |
| `timestamp_end_seconds` | int \| null | When Vedal *leaves*, in seconds. `null` if unknown |

The `video_id` drives everything — no raw URLs are stored:

| What | Constructed from |
|---|---|
| Watch link | `https://youtu.be/{video_id}?t={timestamp_seconds}` |
| Thumbnail | `https://img.youtube.com/vi/{video_id}/maxresdefault.jpg` |

> **Finding the video ID:** In `https://youtu.be/dQw4w9WgXcQ`, the ID is `dQw4w9WgXcQ`.

> **Timestamp conversion:** `H:MM:SS` → total seconds. `2:02:20` = `(2 × 3600) + (2 × 60) + 20` = `7340`

### Collab duration

Duration is computed per-VOD as `timestamp_end_seconds − timestamp_seconds`. VODs with either timestamp missing are excluded. If no VODs have both, duration is not displayed.

**`"povs"`** (default) — different streamers covering the same event. Each POV may have a different duration, so a range is shown:
```
2:03:41 ~ 3:03:21
```
Sorted by the midpoint of the range.

**`"parts"`** — sequential segments of one long session. Durations are summed:
```
58:15
```
Sorted by the total.

---

## 🏷️ Tag Definitions

### Activity tags

| Tag | Meaning |
|---|---|
| `Gaming` | Playing a game together |
| `Yapping` | Hanging out and talking, no game |
| `Prank Call` | Vedal gets called or calls someone as a bit |
| `Interview` | Vedal (and/or Neuro) is being interviewed |
| `React` | Reacting to content together |
| `Subathon` | Appearance during someone's subathon |
| `Event` | Part of a larger event (debut, milestone, etc.) |

An entry can have multiple activity tags. This list isn't exhaustive — add new ones as needed and assign them a color in `colors.json`.

### Appearance weight

| Value | Meaning |
|---|---|
| `Full` | Vedal is a main presence for most/all of the stream |
| `Partial` | Vedal joins for a meaningful segment (roughly 30+ mins) |
| `Cameo` | Brief appearance — drops by for a few minutes |

---

## 🎨 Color system

All tag colors live in `data/colors.json`, organized by category. The site reads this at load time and applies colors everywhere — chips, POV labels, filter sidebar dots, overflow tooltips.

```json
{
  "fallback": "#6B7280",
  "activities": { "Gaming": "#4A9EFF", ... },
  "games":      { "Payday 3": "#E8341C", ... },
  "collab_partners": { "Saiiren": "#A8D8A8", ... },
  "appearance_weight": { "Full": "#22C55E", ... }
}
```

Any tag not found in `colors.json` automatically gets the `fallback` color — no errors, no crashes. To add a color for a new VTuber, game, or tag, just add a line to the right section. No code changes needed.

---

## 📁 Repo structure

```
tutel-sightings/
├── index.html           ← markup and structure
├── style.css            ← all styling
├── script.js            ← rendering, filtering, sorting, interactions
├── data/
│   ├── appearances.json ← all VOD entries
│   └── colors.json      ← tag color definitions
└── README.md
```

---

## ✏️ Contributing

### Adding a new appearance

1. Open `data/appearances.json` in any text editor
2. Copy an existing entry and paste it at the top of the array
3. Fill in all fields using the schema above
4. If the entry introduces a new VTuber, game, or activity tag, add a color for it in `data/colors.json`
5. Save and push — the site updates automatically via GitHub Pages

**Tips:**
- Leave `title` as `null` for single-VOD entries unless the YouTube title is uninformative
- Leave `vod_type` as `"povs"` unless the VODs are sequential parts of one session
- `timestamp_end_seconds` is optional but enables duration display and duration sorting — fill it in when you know it
- Convert timestamps with: `(hours × 3600) + (minutes × 60) + seconds`

### Adding colors

Open `data/colors.json` and add a line to the appropriate section. Hex colors only. The key must exactly match the string used in `appearances.json` (case-sensitive).

---

*Tutel Sightings is a fan project and is not affiliated with Vedal987, Neuro-sama, or any of the VTubers listed.*
