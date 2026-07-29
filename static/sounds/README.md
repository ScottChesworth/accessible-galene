# Earcons (UI sound cues)

Drop short WAV files here to play audible cues alongside the
screen-reader announcements. They are a best-effort fallback: any file
that is missing or won't play is simply skipped.

Expected filenames (served from `/sounds/<name>.wav`):

| File          | Plays when                                   |
|---------------|----------------------------------------------|
| `muted.wav`   | you mute your microphone                     |
| `unmuted.wav` | you turn your microphone on                  |
| `raise.wav`   | you raise your hand                          |
| `lower.wav`   | you lower your hand                          |
| `notify.wav`  | another participant raises their hand        |
| `joined.wav`  | a participant joins (operators only)         |
| `left.wav`    | a participant leaves (operators only)        |

Guidance:

- Keep them short (roughly 100-400 ms) so they don't collide with
  screen-reader speech.
- Make the pairs clearly distinguishable (e.g. a rising tone for
  `unmuted`/`raise`, a falling tone for `muted`/`lower`).
- To use a different audio format, change the `.wav` extension in
  `playEarcon()` in `../galene.js`.
