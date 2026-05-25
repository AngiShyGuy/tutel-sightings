# 🐢 Tutel Sightings

A public, searchable, filterable archive of every stream appearance by **Vedal987** — the VTuber best known for letting his AI, Neuro-sama, run his channel while he goes off to appear in everyone else's streams.

Built as a static website hosted on **GitHub Pages**, with data stored in plain JSON files that are easy to edit without touching any code.

---

## 🎬 YouTube Only

Tutel Sightings only supports **YouTube VODs**. Twitch VODs are not supported and there are no plans to add support for them — Twitch VODs expire after a limited time and the viewing experience is generally poor for this use case. (This mirrors the approach taken by [Library of Ladev](https://libraryofladev.com), a similar community tool for Neuro-sama VODs.)

If a collab was streamed live on Twitch but later uploaded to YouTube, the YouTube upload is the appropriate link to use.

---

## 🗂️ Data Schema

Each VOD appearance is one entry in `data/appearances.json`. Here's what a full entry looks like:

```json
{
  "id": "payday3-saiiren-subathon-d4",
  "title": null,
  "date": "2023-XX-XX",
  "activities": ["gaming"],
  "games": ["Payday 3"],
  "collab_partners": ["Saiiren"],
  "appearance_weight": "full",
  "vod_type": "povs",
  "watched": true,
  "vods": [
    {
      "vod_title": "I Spent 7 Days Straight Streaming Payday 3 (Day 4)",
      "streamer": "Saiiren",
      "vod_part": null,
      "video_id": "dQw4w9WgXcQ",
      "timestamp_seconds": null,
      "timestamp_end_seconds": null
    }
  ],
  "notes": ""
}
```

### Field Reference

| Field | Type | Description |
|---|---|---|
| `id` | string | Unique slug identifier (kebab-case) |
| `title` | string \| null | Optional title override — see **Title Logic** below |
| `date` | string \| null | Stream date in `YYYY-MM-DD` format, or `null` if unknown |
| `activities` | string[] | See **Activity Tags** below |
| `games` | string[] | Game name(s), or `[]` if not a gaming session |
| `collab_partners` | string[] | List of other VTubers present |
| `appearance_weight` | string | See **Appearance Weight** below |
| `vod_type` | string | `"povs"` or `"parts"` — see **Collab Duration** below. Defaults to `"povs"`. Only relevant for multi-VOD entries |
| `watched` | boolean | Personal watch status — tracked locally in your browser, not shown to visitors |
| `vods` | object[] | One or more VOD links — see **VOD Object** below |
| `notes` | string | Optional freeform notes (not displayed publicly) |

### Title Logic

The card title is determined as follows:

1. If `title` is set → use it *(always required for multi-VOD entries; use for single-VOD entries when the real title gives no useful context)*
2. If `title` is `null` and there is one VOD → use that VOD's `vod_title`

Titles are **truncated with an ellipsis** if they are too long. They have two lines of total space before they are cut off.

### VOD Object

```json
{
  "vod_title": "I Spent 7 Days Straight Streaming Payday 3 (Day 4)",
  "streamer": "Saiiren",
  "vod_part": null,
  "video_id": "dQw4w9WgXcQ",
  "timestamp_seconds": 3600,
  "timestamp_end_seconds": 7340
}
```

| Field | Type | Description |
|---|---|---|
| `vod_title` | string | The real title of the VOD as it appears on YouTube |
| `streamer` | string | The name of the streamer whose POV the VOD is from. Should be identical to the name of one of the `collab_partners`. |
| `vod_part` | integer | If `vod_part = "parts"`, this variable is used to denote what part it is. If `vod_part = "povs"`, this variable should stay `null`.| 
| `video_id` | string | The YouTube video ID (the part after `?v=` or `youtu.be/`) |
| `timestamp_seconds` | int \| null | When Vedal *appears* in this VOD, in seconds. Used for the deep link. `null` if he's there from the start |
| `timestamp_end_seconds` | int \| null | When Vedal *leaves* in this VOD, in seconds. Used to compute duration. `null` if unknown |

Timestamps are **per-VOD** because streamers may join the call at different times, end their stream early, or have different start points entirely. Each VOD tracks Vedal's presence independently.

The `video_id` is used to dynamically construct everything — no raw URLs are stored in the JSON:

| What | Constructed URL |
|---|---|
| Watch link | `https://youtu.be/{video_id}` (+ `?t={timestamp_seconds}` if set) |
| Thumbnail | `https://img.youtube.com/vi/{video_id}/maxresdefault.jpg` |

> **Finding the video ID:** In `https://youtu.be/dQw4w9WgXcQ` or `https://www.youtube.com/watch?v=dQw4w9WgXcQ`, the ID is `dQw4w9WgXcQ`.

> **Timestamp conversion:** `H:MM:SS` → total seconds. e.g. `2:02:20` = `(2 × 3600) + (2 × 60) + 20` = `7340`

> **Multiple VODs per entry** is supported — for streams with multiple POVs or multi-part sessions. The card thumbnail is always sourced from the **first VOD** in the array. Clicking the card opens a dropdown at cursor position to choose a POV.

---

### Collab Duration

Duration is computed per-VOD as `timestamp_end_seconds − timestamp_seconds`. VODs missing either timestamp are excluded from the calculation. If no VODs have both timestamps, duration is not displayed.

How duration is displayed and sorted depends on `vod_type`:

#### `"povs"` (default) — multiple perspectives of the same event

Different streamers may join or leave at different times, so each POV yields a different duration. The **range** is displayed:

```
Duration: 30:49 ~ 36:59
```

For **sorting**, the midpoint of the range is used (e.g. `~33:54`), which is more representative than always picking the shortest or longest.

#### `"parts"` — sequential segments of one long session

Parts are additive. Durations are **summed** across all VODs with complete timestamps:

```
Duration: 2:14:08
```

For **sorting**, the total sum is used directly.

---

## 🏷️ Tag Definitions

### Activity Tags (`activities` field)

An entry can have **multiple** activity tags.

| Tag | Meaning |
|---|---|
| `gaming` | They're playing a game together |
| `yapping` | Hanging out and talking, no game |
| `prank-call` | Vedal gets called or calls someone as a bit |
| `interview` | Vedal (and/or Neuro) is being interviewed |
| `react` | Reacting to content together |
| `subathon` | Appearance during someone's subathon |
| `event` | Part of a larger event (debut, milestone, etc.) |

> This list isn't exhaustive — add new tags as needed, and add their color to `data/colors.json`.

### Appearance Weight (`appearance_weight` field)

| Value | Meaning |
|---|---|
| `full` | Vedal is a main presence for most/all of the stream |
| `partial` | Vedal joins for a meaningful segment (roughly 30+ mins) |
| `cameo` | Brief appearance — he drops by for a few minutes |

---

## 🎨 Color System

All tag colors are defined in **`data/colors.json`**. This covers every category of tag: activities, games, collab partners, and appearance weights. You decide every color.

```json
{
  "fallback": "#4B5563",
  "activities": {
    "gaming":     "#4A9EFF",
    "yapping":    "#C084FC",
    "prank-call": "#F87171",
    "interview":  "#34D399",
    "react":      "#FBBF24",
    "subathon":   "#A78BFA",
    "event":      "#F472B6"
  },
  "games": {
    "Payday 3":     "#E8341C",
    "Helldivers 2": "#FFD700"
  },
  "collab_partners": {
    "Saiiren":  "#A8D8A8",
    "Camila":   "#FFB347",
    "MOTHERv3": "#7EB8D4",
    "OkCode":   "#B39DDB",
    "Koko":     "#F9A8D4",
    "Miwo":     "#86EFAC"
  },
  "appearance_weight": {
    "full":    "#22C55E",
    "partial": "#EAB308",
    "cameo":   "#6B7280"
  }
}
```

**Rules:**
- Any tag not found in `colors.json` automatically gets the `fallback` color — no errors, no crashes.
- To add a new VTuber, game, or activity color, just add a line to the right section. No code changes needed.

### POV Chip Colors

The `"[streamer]'s POV"` chips (detailed below) are colored by taking the streamer's assigned color, which can be easily found by using the VOD's `streamer` variable.

---

## 🖥️ UI Design Spec

**Aesthetic:** Sleek, modern, dark — like a VOD catalogue.

| Property | Value |
|---|---|
| Background | Dark gray (e.g. `#111827` / `#1F2937`) — not pure black |
| Accent / highlights | Green (e.g. `#22C55E` or similar) |
| Corner radius | Rounded throughout — cards, chips, buttons, inputs |
| Theme | Dark only (no light mode planned) |

### Card Layout (per entry)

```
┌─────────────────────────────────────────────────────┐
│                                                      │
│            YouTube thumbnail (16:9)                  │  ← clicking opens VOD
│                                                      │  ← (or POV picker dropdown
│                                                      │     at cursor if multi-VOD)
├─────────────────────────────────────────────────────┤
│  [ gaming ]  [ Payday 3 ]  [ Saiiren ]  [ +2 more ] │  ← colored, clickable chips
│  VOD Title or Entry Title Override (truncated…)      │  ← clicking title opens VOD too (or the dropdown)
│  2024-03-15  ·  Duration: 30:49 ~ 36:59             │  ← date + computed duration of vedal screentime (`timestamp_end_seconds` - `timestamp_seconds`)
└─────────────────────────────────────────────────────┘
```

**Interaction details:**
- Clicking the **thumbnail or title** opens the VOD directly (single VOD) or a **cursor-position dropdown** to pick a POV (multi-VOD).
- In multi-VOD entries with several different perspectives, the cursor-position dropdown VODs have label chips that read, for instance, `"Saiiren's POV"`. This chip is auto-generated by taking each VOD's `streamer` variable and adding "'s POV" to the end.
- Each **tag chip** is clickable and immediately filters the list by that tag.
- **`+ N more`** on collab partners: hovering reveals the full partner list as a tooltip. Partners are capped at **2 visible** before the overflow chip. Games always display in full (usually just 1–2).

### Filter & Sort Controls

- [x] Filter by: activity, game, collab partner, appearance weight
- [x] Sort by: date, collab duration, collab partner count
- [x] Search bar (matches title, partner names, game names)
- [ ] Personal watch status toggle (stored in browser localStorage — your eyes only)
- [x] Mobile responsive layout

---

## 🛠️ Tech Stack

| Layer | Tool | Why |
|---|---|---|
| Hosting | GitHub Pages | Free, static, no backend needed |
| Data | `data/appearances.json` + `data/colors.json` | Plain JSON, editable in VSCode or any text editor |
| Frontend | Vanilla HTML + CSS + JS (separate files) | No frameworks, no build step, human-readable and contribution-friendly |

No npm. No Node. No database. No API keys. The whole thing runs from files.

---

## 📁 Repo Structure

```
tutel-sightings/
├── index.html              ← markup and structure
├── style.css               ← all styling
├── script.js               ← filtering, sorting, card rendering, color system
├── data/
│   ├── appearances.json    ← all VOD entries live here
│   └── colors.json         ← tag color definitions (you control all of these)
└── README.md               ← you are here
```

---

## ✏️ How to Add a New Entry

1. Open `data/appearances.json` in VSCode
2. Copy an existing entry and paste it at the top of the array
3. Fill in the fields — grab the `video_id` from the YouTube URL
4. If you're adding a new VTuber, game, or activity tag, add their color to `data/colors.json`
5. Save and push to GitHub — the site updates automatically

**Tips:**
- `title` can stay `null` for single-VOD entries unless the VOD title gives no useful context
- Convert timestamps with: `(hours × 3600) + (minutes × 60) + seconds`
- `timestamp_end_seconds` is optional per VOD but enables duration display and sorting — worth filling in when known
- `vod_type` only matters for multi-VOD entries; leave it as `"povs"` unless the VODs are sequential parts of one session
- POV chip colors are derived automatically from the partner name — no extra setup needed
- The thumbnail is fetched automatically from YouTube using the `video_id`

---

*This tracker is a fan project and is not affiliated with Vedal987 or any of the VTubers listed.*
