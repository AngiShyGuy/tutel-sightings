# 🐢 Tutel Sightings

A public, searchable, filterable archive of every appearance by **Vedal987** on other people's streams.

Hosted on **[GitHub Pages](https://angishyguy.github.io/tutel-sightings)**.

![Tutel Sightings preview](https://i.imgur.com/25VGr4l.png)

---

## Features

- **Searching and filtering** based on the title, activities played, collab partners, date range or games played.
- **Multiple VOD support** for each stream, allowing for multi-parters or for different streamers' perspectives of the same event.
- **Collab summaries** for some streams in case you forgot what that one call-in was about again.
- **Highlights timestamps** for quick access to a stream's best moments.
- **Watch progress** by marking streams as watched and writing down your current timestamp via the `···` menu.
- **Export / Import progress data** to back up your watch data as a JSON file and restore it on another browser or device.

---

## Data Schema

All appearance data lives in `data/appearances.json` as an array of entry objects.

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
| `summary` | string | Summary of the events and discussions in the collab |
| `vod_type` | string | `"povs"` (Default) or `"parts"` — Dictates whether the VODs associated with the stream are sequential parts or different perspectives. Only relevant for multi-VOD entries |
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

| Field | Type | Description |
|---|---|---|
| `vod_title` | string | The real title of the VOD as it appears on YouTube |
| `streamer` | string | The streamer whose POV this is. Must match a name in `collab_partners` |
| `vod_part` | integer \| null | Part number for `"parts"` entries (`1`, `2`, …). `null` for `"povs"` entries |
| `video_id` | string | The YouTube video ID — the part after `?v=` or `youtu.be/` |
| `timestamp_seconds` | int \| null | When Vedal *appears*, in seconds. `null` if he's there from the start |
| `timestamp_end_seconds` | int \| null | When Vedal *leaves*, in seconds. `null` if unknown |

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

## Contributing 4 Dummies

To contribute a new stream / VOD appearance, open `data/appearances.json` and add a new entry appropriately.
If you're not familiar with enough with coding, I'd recommend using a grid-based JSON editor like [Jsonite](https://www.jsonite.it/) and use the data schema provided above.

---

*Tutel Sightings is a fan project and is not affiliated with Vedal987, Neuro-sama, or any of the VTubers listed.*
