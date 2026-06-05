# Contributing to Tutel Sightings

Thanks for helping out! This document covers everything you need to know to add or edit entries in `data/appearances.json`.

If you're not comfortable editing JSON directly, [Jsonite](https://www.jsonite.it/) is a free grid-based JSON editor that makes it much easier to work with.

---

## Data Schema

All appearance data lives in `data/appearances.json` as an array of entry objects.

### Entry fields

| Field | Type | Description |
|---|---|---|
| `id` | string | Unique slug in kebab-case (e.g. `pummel-party-camila-big-collab`) |
| `title` | string \| null | See **Title logic** below |
| `date` | string \| null | Stream date as `YYYY-MM-DD`, or `null` if unknown |
| `activities` | string[] | See **Activity tags** below |
| `games` | string[] | Game name(s), or `[]` if not a gaming session |
| `collab_partners` | string[] | All other VTubers present — names must be consistent across entries |
| `appearance_weight` | string | See **Appearance weight** below |
| `summary` | string \| null | 1–2 sentence description of what happens; `null` if not written yet |
| `safari` | boolean | Whether this sighting was pinged in the `#tutel-safari` Discord channel |
| `vod_type` | string | `"povs"` (default) or `"parts"` — see **VOD type** below |
| `vods` | object[] | One or more VOD objects — see **VOD object** below |
| `highlights` | object[] \| null | Highlight timestamps, or `null` if none — see **Highlights** below |

---

### Title logic

Set `title` to a custom string when:
- The entry has **multiple VODs** (required - there's no single title to fall back to)
- The real VOD title gives no useful context

Otherwise, leave `title` as `null` and the site will use the VOD's own title automatically.

```json
// Let the VOD title speak for itself
"title": null,
"vods": [{ "vod_title": "COZY ART STRIM WITH MY FAMILY", ... }]

// Override with something more useful
"title": "Shark Tank with Vedal",
"vods": [{ "vod_title": "You're trapped", ... }]
```

---

### Activity tags

Below are the currently established activity tags, but more can be added later. Adding new ones requires updating `data/colors.json` too.

| Tag | Use when… |
|---|---|
| `Just Chatting` | Vedal appears in a non-gaming, non-specific context |
| `Gaming` | The collab involves playing a game together |
| `Subathon` | The stream is part of a subathon |
| `Drinking` | Drinking is a notable activity |
| `VR` | VR is involved |
| `Prank Call` | Vedal is called without knowing he's on stream |
| `Interview` | Vedal is formally interviewed |
| `Debut` | This is a streamer's debut stream |
| `Baking` | Baking is a notable activity |
| `Fan Submissions` | Fan-submitted content is featured |
| `Development` | Vedal is working on Neuro-sama or related projects live |
| `Subathon Timer Fixing` | Vedal helps fix a streamer's subathon timer |
| `VTuber Awards` | Vedal is watching the annual VTuber Awards with someone |

Entries can have multiple tags, for example a stream that's both a `Subathon` and involves `Gaming`.

---

### Appearance weight

| Value | Meaning |
|---|---|
| `Full` | Vedal is present for most or all of the collab. He is also generally included in the stream title. |
| `Partial` | Vedal appears for a significant portion but not throughout. Long subathon appearances fall under this. |
| `Cameo` | Brief appearance: a quick call-in, raid, or drop-in |

---

### VOD type

| Value | Meaning |
|---|---|
| `"povs"` | Multiple streamers each recorded their own perspective of the same event. Duration is shown as a range (`1:23:45 ~ 2:10:00`). |
| `"parts"` | One long session split across multiple video uploads. Durations are summed. |

For single-VOD entries, `vod_type` doesn't matter but `"povs"` is the default.

---

### VOD object

| Field | Type | Description |
|---|---|---|
| `vod_title` | string | The real title of the VOD as it appears on YouTube. Use `"Unknown VOD Title"` if the VOD is unlisted or unavailable. |
| `streamer` | string | The streamer whose POV this is. Must exactly match a name in `collab_partners`. |
| `video_id` | string | The YouTube video ID — the part after `?v=` in a full URL, or after `youtu.be/`. |
| `timestamp_seconds` | int \| null | When Vedal first appears, in seconds. `null` if he's there from the start. |
| `timestamp_end_seconds` | int \| null | When Vedal leaves, in seconds. `null` if unknown or if the stream ends with Vedal still present. |

**Duration** is computed as `timestamp_end_seconds − timestamp_seconds`. If either is missing, no duration is shown for that VOD.

**Example — multiple POVs:**
```json
"vod_type": "povs",
"vods": [
  {
    "vod_title": "HUGE COLLAB WITH FRIENDS !!!",
    "streamer": "Camila",
    "video_id": "bRfQ9gncSLE",
    "timestamp_seconds": 9022,
    "timestamp_end_seconds": 18615
  },
  {
    "vod_title": "big gaming session",
    "streamer": "Saiiren",
    "video_id": "abc123xyz",
    "timestamp_seconds": 7400,
    "timestamp_end_seconds": 19100
  }
]
```

**Example — sequential parts:**
```json
"vod_type": "parts",
"vods": [
  {
    "vod_title": "SUBATHON DAY 4 P.2",
    "streamer": "Saiiren",
    "video_id": "Q1-vkW-oYVY",
    "timestamp_seconds": 40620,
    "timestamp_end_seconds": 43081
  },
  {
    "vod_title": "SUBATHON DAY 4 P.3",
    "streamer": "Saiiren",
    "video_id": "z53FJTJ7q-8",
    "timestamp_seconds": 0,
    "timestamp_end_seconds": 11415
  }
]
```

---

### Highlights

A list of notable timestamps within the stream. These appear in a popup accessible from the stream card.

| Field | Type | Description |
|---|---|---|
| `title` | string | Short label for the highlight (e.g. `"That's the eject button, Layna."`) |
| `timestamp_seconds` | int | Absolute timestamp in the VOD file, in seconds |
| `vod_index` | int | Zero-based index into the `vods` array — which VOD this timestamp belongs to |

```json
"highlights": [
  {
    "title": "That's the eject button, Layna.",
    "timestamp_seconds": 2756,
    "vod_index": 0
  },
  {
    "title": "Vedal and Koko :Flushed:",
    "timestamp_seconds": 1577,
    "vod_index": 0
  }
]
```

Set to `null` if there are no highlights.

---

## Colors

If you add a game, activity, or collab partner that doesn't already have a colour, add it to `data/colors.json` under the appropriate category. Use a soft, readable hex colour that contrasts well against a dark background.

```json
"games": {
  "My New Game": "#a8e6cf"
},
"collab_partners": {
  "NewStreamer": "#f0c4d4"
}
```

Partner and game colours appear on the filter chips and VOD selector throughout the site, so try to pick something that feels appropriate for the streamer or fits the game's aesthetic.
