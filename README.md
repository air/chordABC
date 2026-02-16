# chordABC

A single-page web app that lets you click piano keys to form chords, then appends them as ABC notation to a growing text output. You know which keys you're pressing but not ABC notation — this tool bridges that gap.

## How to Use

Open `index.html` in any browser. No build step, no dependencies (abcjs is loaded from CDN).

1. Click piano keys to select notes (they highlight blue and play a tone)
2. Each new note replays all selected notes together so you hear the chord forming
3. Press **Spacebar** to replay the current chord at any time
4. The chord name appears live as you select notes (e.g. "Cmaj", "Abmin / G#min")
5. Click **Add this chord** to append the selected notes as ABC notation
6. Use **Undo** or **Clear All** as needed
7. **Undo** restores the removed chord's notes back onto the keyboard
8. Click a line in the textarea to preview it — keys light up yellow and the chord plays
9. While previewing, click keys to edit that chord in-place (add/remove notes)
10. Use **Up/Down arrow keys** in the textarea to step through chords
11. Click **Load .abc** to import an existing ABC file; **Download .abc** to save
12. The rendered music staff on the right updates live to verify your notation

## Architecture

Everything lives in a single `index.html` — HTML, CSS, and JS are all embedded. The only external dependency is [abcjs](https://www.abcjs.net/) loaded from CDN for staff rendering.

## Technical Details

### Piano Keyboard
- 5 octaves: C1 through B5 (60 keys total: 35 white, 25 black)
- CSS-rendered with `<div>` elements; black keys absolutely positioned over white keys
- Each key stores its MIDI note number as a `data-midi` attribute
- Black key labels use the musician-preferred spelling (Db, Eb, Ab, Bb) except F# which stays as F#

### Enharmonic Spelling & Flats

The tool makes opinionated choices about sharp vs flat spelling to match what musicians expect:

**Preferred root names for black keys:**
| Piano Key | Sharp | Flat | Preferred |
|-----------|-------|------|-----------|
| C#/Db | C# | Db | **Db** |
| D#/Eb | D# | Eb | **Eb** |
| F#/Gb | F# | Gb | **F#** |
| G#/Ab | G# | Ab | **Ab** |
| A#/Bb | A# | Bb | **Bb** |

**Chord tone spelling:** Each note within a chord is spelled based on its interval from the root using music-theory-correct letter offsets. For example:
- **Fdim** (F, Ab, B) → `[F,_A,B,]` — the G# is written as `_A` (Ab) because it's the minor 3rd of F, and the expected letter for a 3rd is A, not G
- **Ebmin** → uses `_E` (Eb) and `_G` (Gb) where appropriate
- The tool avoids unusual enharmonics (Cb, E#, Fb, B#) — if a theoretically correct spelling lands on a white key, the natural name is used instead (e.g. B instead of Cb)

**Chord name display:** When the root is a black key, both enharmonic names are shown in the live display (e.g. "Abmin / G#min"). The ABC output uses the preferred spelling.

**How it works internally:** Each chord pattern stores `letterOffsets` — the expected scale-degree jumps from the root letter. When a chord is identified, each note's pitch class is compared against the expected letter to determine if it needs a sharp (`^`), flat (`_`), or natural. This is done by the `noteSpelling()` function.

### ABC Notation Mapping

| Octave | Style | Example |
|--------|-------|---------|
| C1–B1 | Uppercase + `,,,` | `C,,,` `_D,,,` `B,,,` |
| C2–B2 | Uppercase + `,,` | `C,,` `_D,,` `B,,` |
| C3–B3 | Uppercase + `,` | `C,` `_A,` `B,` |
| C4–B4 | Uppercase | `C` `_E` `B` |
| C5–B5 | Lowercase | `c` `_a` `b` |

- Single notes output bare: `C`
- Chords wrapped in brackets, sorted low-to-high: `[CEG]`
- Sharps: `^C`, `^F` — Flats: `_D`, `_A`
- Each line includes a `%` comment with human-readable note names and octave numbers for easy reference: `[C,EG] % C3 E4 G4`

### Chord Identification
- Recognizes: maj, min, 7, maj7, min7, dim, dim7, aug, sus2, sus4, 6, min6, 9, maj9, min9
- Detection works across all inversions by trying each note as a potential root
- Identified chords are prefixed in the ABC output as chord symbols: `"Cmaj"[CEG]`
- Chord name shown live above the keyboard as notes are selected

### Audio
- Web Audio API: `OscillatorNode` with triangle wave
- Exponential gain decay over ~1.2s
- Frequency from MIDI: `440 * 2^((midi - 69) / 12)`
- Selecting a note replays all selected notes together (volume scaled by `1/sqrt(n)` to prevent clipping)
- Deselecting a note is silent
- Spacebar replays the current chord on demand (disabled when textarea is focused)

### Rendered Staff
- Uses [abcjs](https://www.abcjs.net/) loaded from CDN to render ABC notation as SVG
- Displayed side-by-side with the textarea for live visual verification
- Styled for dark theme (light notes on dark background, yellow chord symbols)
- Updates automatically on every change

### File Load/Save
- **Load .abc**: Imports an ABC file, parsing header fields and body tokens; rejects invalid files
- **Download .abc**: Saves the current output; uses the loaded filename if available, otherwise `chords.abc`
- Lyrics lines (`w:`) are preserved from loaded files but are non-interactive (can't be selected or edited, arrow keys skip past them)

### Textarea Features
- Read-only; all edits happen through the UI (adding chords, editing via preview, undo)
- Syntax coloring via overlay: header lines grey, chord lines cyan, lyrics lines green
- When a chord is selected for preview, non-selected lines dim to focus attention
- Hover highlights indicate clickable chord lines
- Arrow key navigation skips non-chord lines (lyrics, bar lines) and scrolls to keep trailing lyrics visible

### Token System
- The ABC output is managed as a header string + array of tokens
- Undo removes the last token and restores its notes onto the keyboard
- Clear All empties the token array and resets the header
- Header is pre-populated: `X:1`, `T:Untitled`, `M:4/4`, `L:1/4`, `K:C`

### MIDI Numbering
- Uses standard MIDI: C4 = 60, calculated as `(octave + 1) * 12 + noteIndex`
- Range: MIDI 24 (C1) through MIDI 83 (B5)

## What's Not Implemented
- No note duration control (everything defaults to `L:1/4`)
- No sustain/pedal simulation
- No MIDI input support
- No playback of the full ABC output
