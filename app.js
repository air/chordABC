(function() {
  "use strict";

  // --- Note / octave data ---
  const NOTE_NAMES = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];
  const START_OCTAVE = 1;
  const END_OCTAVE = 5;

  // Build key descriptors: { midi, name, octave, isBlack }
  const keys = [];
  for (let oct = START_OCTAVE; oct <= END_OCTAVE; oct++) {
    for (let i = 0; i < 12; i++) {
      const midi = (oct + 1) * 12 + i; // MIDI: C4 = 60
      const name = NOTE_NAMES[i];
      const isBlack = name.includes("#");
      keys.push({ midi, name, octave: oct, isBlack });
    }
  }

  // --- Build piano DOM ---
  const pianoEl = document.getElementById("piano");
  const selectedNotesEl = document.getElementById("selectedNotes");
  const abcOutput = document.getElementById("abcOutput");

  const selectedMidi = new Set();

  // Edit-mode state: when a chord line is previewed, clicking keys edits it
  let editingTokenIndex = null;
  const editingMidi = new Set();

  // Position tracking
  let whiteIndex = 0;
  const WHITE_W = 36;
  const BLACK_W = 24;

  // Black key offsets relative to their preceding white key
  // Pattern within octave: C C# D D# E F F# G G# A A# B
  // Black keys after:       C#    D#      F#    G#    A#
  const blackOffsetFromWhite = WHITE_W - BLACK_W / 2;

  // We need to track white key positions to place black keys
  const whitePositions = [];

  // First pass: create white keys to know positions
  keys.forEach(k => {
    if (!k.isBlack) {
      whitePositions.push({ midi: k.midi, left: whiteIndex * WHITE_W });
      whiteIndex++;
    }
  });

  const totalWidth = whiteIndex * WHITE_W;
  pianoEl.style.width = totalWidth + "px";

  // Lookup: for a black key's midi, find the left of the preceding white key
  function blackKeyLeft(midi) {
    // The white key just below this black key
    const whiteBelow = whitePositions.find(w => w.midi === midi - 1);
    if (whiteBelow) return whiteBelow.left + blackOffsetFromWhite;
    return 0;
  }

  // Preferred display names for black keys
  const PREFERRED_LABEL = { "C#":"Db", "D#":"Eb", "G#":"Ab", "A#":"Bb" };

  // Create all key elements
  keys.forEach(k => {
    const el = document.createElement("div");
    el.className = "key " + (k.isBlack ? "black" : "white");
    el.dataset.midi = k.midi;

    const label = document.createElement("span");
    label.className = "key-label";
    label.textContent = (PREFERRED_LABEL[k.name] || k.name) + k.octave;
    el.appendChild(label);

    if (k.isBlack) {
      el.style.left = blackKeyLeft(k.midi) + "px";
    }

    el.addEventListener("mousedown", (e) => {
      e.preventDefault();
      if (editingTokenIndex !== null) {
        editChord(k.midi);
        e.stopPropagation();
      } else {
        toggleKey(k.midi, el);
      }
    });

    pianoEl.appendChild(el);
  });

  // --- Audio ---
  let audioCtx = null;

  const SAMPLE_MIDS = [36, 48, 60, 72, 84, 96]; // C2, C3, C4, C5, C6, C7
  const SAMPLE_FILES = {
    36: "mp3/public_audio_C2v10.mp3",
    48: "mp3/public_audio_C3v10.mp3",
    60: "mp3/public_audio_C4v10.mp3",
    72: "mp3/public_audio_C5v10.mp3",
    84: "mp3/public_audio_C6v10.mp3",
    96: "mp3/public_audio_C7v10.mp3",
  };
  const sampleBuffers = {}; // midi -> AudioBuffer
  let samplesLoaded = false;
  let samplesReady = null; // Promise, resolved once all samples are decoded

  // Pre-fetch mp3 data immediately on page load (no AudioContext needed)
  const rawSampleData = {};
  for (const midi of SAMPLE_MIDS) {
    rawSampleData[midi] = fetch(SAMPLE_FILES[midi]).then(r => r.arrayBuffer());
  }

  async function decodeSamples() {
    await Promise.all(SAMPLE_MIDS.map(async (midi) => {
      const buf = await rawSampleData[midi];
      sampleBuffers[midi] = await audioCtx.decodeAudioData(buf);
    }));
    samplesLoaded = true;
  }

  function ensureAudioCtx() {
    if (!audioCtx) {
      audioCtx = new AudioContext();
      samplesReady = decodeSamples();
    }
    return audioCtx;
  }

  function nearestSample(midi) {
    let best = SAMPLE_MIDS[0];
    let bestDist = Math.abs(midi - best);
    for (const s of SAMPLE_MIDS) {
      const d = Math.abs(midi - s);
      if (d < bestDist) { best = s; bestDist = d; }
    }
    return best;
  }

  function playSample(ctx, midi, count) {
    const sampleMidi = nearestSample(midi);
    const detune = (midi - sampleMidi) * 100; // cents

    const source = ctx.createBufferSource();
    source.buffer = sampleBuffers[sampleMidi];
    source.detune.value = detune;

    const gain = ctx.createGain();
    const vol = count > 1 ? 0.2 / Math.sqrt(count) : 0.3;
    gain.gain.setValueAtTime(vol, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 2.0);

    source.connect(gain);
    gain.connect(ctx.destination);
    source.start();
  }

  function playTone(midi, count) {
    count = count || 1;
    const ctx = ensureAudioCtx();

    if (samplesLoaded) {
      playSample(ctx, midi, count);
    } else {
      samplesReady.then(() => playSample(ctx, midi, count));
    }
  }

  // --- Key toggle ---
  function toggleKey(midi, el) {
    if (selectedMidi.has(midi)) {
      selectedMidi.delete(midi);
      el.classList.remove("active");
    } else {
      selectedMidi.add(midi);
      el.classList.add("active");
      // Play all selected notes together so you hear the chord
      const count = selectedMidi.size;
      selectedMidi.forEach(m => playTone(m, count));
    }
    updateSelectedDisplay();
  }

  function clearSelection() {
    selectedMidi.clear();
    pianoEl.querySelectorAll(".key.active").forEach(el => el.classList.remove("active"));
    updateSelectedDisplay();
  }

  const chordNameEl = document.getElementById("chordName");
  const btnAddChord = document.getElementById("btnAddChord");
  const btnClearKeys = document.getElementById("btnClearKeys");

  function syncAddButton() {
    btnAddChord.disabled = selectedMidi.size === 0 || editingTokenIndex !== null;
    btnClearKeys.disabled = selectedMidi.size === 0;
  }

  const selectedLabelEl = document.getElementById("selectedLabel");

  function updateSelectedDisplay() {
    syncAddButton();
    if (selectedMidi.size === 0) {
      selectedLabelEl.textContent = "Click a key to build your chord";
      selectedNotesEl.textContent = "";
      chordNameEl.textContent = "";
      return;
    }
    selectedLabelEl.textContent = "Selected: ";
    const sorted = Array.from(selectedMidi).sort((a, b) => a - b);
    selectedNotesEl.textContent = sorted.map(m => {
      const k = keys.find(k => k.midi === m);
      return (PREFERRED_LABEL[k.name] || k.name) + k.octave;
    }).join("  ");

    const chord = identifyChord(sorted);
    chordNameEl.textContent = chord ? chord.display : "";
  }

  // Spacebar to replay the current chord
  document.addEventListener("keydown", (e) => {
    if (e.code === "Space" && document.activeElement !== abcOutput) {
      e.preventDefault();
      if (selectedMidi.size > 0) {
        const count = selectedMidi.size;
        selectedMidi.forEach(m => playTone(m, count));
      }
    }
  });

  // --- ABC / notation helpers ---
  const LETTERS = ["C", "D", "E", "F", "G", "A", "B"];
  const NATURAL_SEMI = [0, 2, 4, 5, 7, 9, 11]; // semitone of each natural note
  const PITCH_TO_NATURAL = { 0:"C", 2:"D", 4:"E", 5:"F", 7:"G", 9:"A", 11:"B" };

  // Enharmonic equivalents: sharp -> flat, with musician-preferred spelling
  const ENHARMONIC = {
    "C#": { flat: "Db", preferred: "Db" },
    "D#": { flat: "Eb", preferred: "Eb" },
    "F#": { flat: "Gb", preferred: "F#" },
    "G#": { flat: "Ab", preferred: "Ab" },
    "A#": { flat: "Bb", preferred: "Bb" },
  };

  function noteSpelling(pitchClass, letter) {
    // Given a pitch class and the expected letter name, return { letter, accidental }
    const letterIdx = LETTERS.indexOf(letter);
    const naturalPitch = NATURAL_SEMI[letterIdx];
    const diff = ((pitchClass - naturalPitch) % 12 + 12) % 12;
    if (diff === 0) return { letter, acc: "" };
    if (diff === 1) return { letter, acc: "sharp" };
    if (diff === 11) return { letter, acc: "flat" };
    // Double sharp/flat -- fall back to natural if this pitch is a white key
    if (PITCH_TO_NATURAL[pitchClass]) return { letter: PITCH_TO_NATURAL[pitchClass], acc: "" };
    return { letter, acc: "" };
  }

  function spellingToABC(sp, octave) {
    let prefix = sp.acc === "sharp" ? "^" : sp.acc === "flat" ? "_" : "";
    let abc = prefix;
    if (octave <= 3) {
      abc += sp.letter;
      if (octave === 1) abc += ",,,";
      else if (octave === 2) abc += ",,";
      else if (octave === 3) abc += ",";
    } else if (octave === 4) {
      abc += sp.letter;
    } else {
      abc += sp.letter.toLowerCase();
    }
    return abc;
  }

  function spellingToReadable(sp, octave) {
    let name = sp.letter;
    if (sp.acc === "sharp") name += "#";
    else if (sp.acc === "flat") name += "b";
    return name + octave;
  }

  // Default ABC (no chord context): use musician-preferred spelling
  function midiToABC(midi) {
    const k = keys.find(k => k.midi === midi);
    if (!k) return "?";
    const en = ENHARMONIC[k.name];
    if (en) {
      const pref = en.preferred;
      const letter = pref.charAt(0);
      const acc = pref.length > 1 ? (pref.charAt(1) === "b" ? "flat" : "sharp") : "";
      return spellingToABC({ letter, acc }, k.octave);
    }
    return spellingToABC({ letter: k.name, acc: "" }, k.octave);
  }

  // Default readable (no chord context): use musician-preferred spelling
  function midiToNotation(midi) {
    const k = keys.find(k => k.midi === midi);
    if (!k) return "?";
    const en = ENHARMONIC[k.name];
    if (en) return en.preferred + k.octave;
    return k.name + k.octave;
  }

  // --- Chord identification ---
  // Each pattern has letterOffsets: the scale-degree offset from the root letter
  // e.g. root=0, 3rd=2, 5th=4, 7th=6, 9th=1 (octave up)
  const CHORD_PATTERNS = [
    { intervals: [0, 4, 7],         name: "maj",  lo: [0, 2, 4] },
    { intervals: [0, 3, 7],         name: "min",  lo: [0, 2, 4] },
    { intervals: [0, 4, 7, 11],     name: "maj7", lo: [0, 2, 4, 6] },
    { intervals: [0, 3, 7, 10],     name: "min7", lo: [0, 2, 4, 6] },
    { intervals: [0, 4, 7, 10],     name: "7",    lo: [0, 2, 4, 6] },
    { intervals: [0, 3, 6],         name: "dim",  lo: [0, 2, 4] },
    { intervals: [0, 3, 6, 9],      name: "dim7", lo: [0, 2, 4, 6] },
    { intervals: [0, 4, 8],         name: "aug",  lo: [0, 2, 4] },
    { intervals: [0, 5, 7],         name: "sus4", lo: [0, 3, 4] },
    { intervals: [0, 2, 7],         name: "sus2", lo: [0, 1, 4] },
    { intervals: [0, 4, 7, 9],      name: "6",    lo: [0, 2, 4, 5] },
    { intervals: [0, 3, 7, 9],      name: "min6", lo: [0, 2, 4, 5] },
    { intervals: [0, 4, 7, 11, 14], name: "maj9", lo: [0, 2, 4, 6, 1] },
    { intervals: [0, 4, 7, 10, 14], name: "9",    lo: [0, 2, 4, 6, 1] },
    { intervals: [0, 3, 7, 10, 14], name: "min9", lo: [0, 2, 4, 6, 1] },
  ];

  function identifyChord(midiNotes) {
    if (midiNotes.length < 2) return null;
    const sorted = [...midiNotes].sort((a, b) => a - b);
    for (const root of sorted) {
      const rootPC = root % 12;
      const intervals = sorted.map(m => ((m - root) % 12 + 12) % 12).sort((a, b) => a - b);
      const unique = [...new Set(intervals)];
      for (const p of CHORD_PATTERNS) {
        const pReduced = [...new Set(p.intervals.map(v => v % 12))].sort((a, b) => a - b);
        if (unique.length === pReduced.length &&
            unique.every((v, i) => v === pReduced[i])) {

          // Determine root letter
          const rootKey = keys.find(k => k.midi === root);
          const sharpName = rootKey.name;
          const en = ENHARMONIC[sharpName];
          let rootLetter, preferred, alt, display;

          if (en) {
            rootLetter = en.preferred.charAt(0);
            preferred = en.preferred + p.name;
            const other = (en.preferred === sharpName ? en.flat : sharpName);
            alt = other + p.name;
            display = preferred + " / " + alt;
          } else {
            rootLetter = sharpName;
            preferred = sharpName + p.name;
            alt = null;
            display = sharpName + p.name;
          }

          // Build spellings map: pitchClass -> { letter, acc }
          const rootLetterIdx = LETTERS.indexOf(rootLetter);
          const spellings = {};
          for (let i = 0; i < p.intervals.length; i++) {
            const pc = (rootPC + p.intervals[i]) % 12;
            const expectedLetter = LETTERS[(rootLetterIdx + p.lo[i]) % 7];
            const sp = noteSpelling(pc, expectedLetter);
            // Avoid unusual enharmonics (Cb, E#, Fb, B#): if the accidental
            // lands on a white key, use the natural name instead
            if (sp.acc !== "" && PITCH_TO_NATURAL[pc] !== undefined) {
              spellings[pc] = { letter: PITCH_TO_NATURAL[pc], acc: "" };
            } else {
              spellings[pc] = sp;
            }
          }

          return { preferred, alt, display, spellings };
        }
      }
    }
    return null;
  }

  // --- Token management ---
  let HEADER = "X:1\nT:Untitled\nM:4/4\nL:1/4\nK:C\n";
  let tokens = [];
  let loadedFilename = null;

  // Parse an ABC file string into header + body tokens.
  // Returns { header, tokens } on success, or null on parse error.
  function parseAbcFile(content) {
    var lines = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");

    // Strip trailing empty lines
    while (lines.length > 0 && lines[lines.length - 1] === "") {
      lines.pop();
    }

    if (lines.length === 0) return null;

    // First line must be X: (tune number)
    if (!/^X:\s*\d/.test(lines[0])) return null;

    // Find K: line (key -- always last header field in ABC)
    var kLineIdx = -1;
    for (var i = 0; i < lines.length; i++) {
      if (/^K:/.test(lines[i])) {
        kLineIdx = i;
        break;
      }
    }
    if (kLineIdx === -1) return null;

    // Every line before and including K: must be a header field
    for (var j = 0; j <= kLineIdx; j++) {
      if (!/^[A-Za-z]:/.test(lines[j])) return null;
    }

    var header = lines.slice(0, kLineIdx + 1).join("\n") + "\n";
    var bodyLines = lines.slice(kLineIdx + 1);

    // Strip trailing empty lines from body
    while (bodyLines.length > 0 && bodyLines[bodyLines.length - 1] === "") {
      bodyLines.pop();
    }

    return { header: header, tokens: bodyLines };
  }

  function renderStaff() {
    if (typeof ABCJS !== "undefined") {
      ABCJS.renderAbc("staffRender", abcOutput.value, { responsive: "resize" });
    }
  }

  const highlightEl = document.getElementById("abcHighlight");

  function renderHighlight() {
    const text = abcOutput.value;
    const lines = text.split("\n");
    const headerLineCount = (HEADER.match(/\n/g) || []).length;
    // Determine which token indices are "bright" (selected chord + its trailing lyrics)
    const brightSet = new Set();
    if (editingTokenIndex !== null) {
      brightSet.add(editingTokenIndex);
      for (let i = editingTokenIndex + 1; i < tokens.length && !isChordToken(i); i++) {
        brightSet.add(i);
      }
    }

    const html = lines.map((line, i) => {
      const escaped = line.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      let cls;
      if (i < headerLineCount) {
        cls = "hl-header";
      } else {
        const tokenIdx = i - headerLineCount;
        if (tokenIdx >= 0 && tokenIdx < tokens.length) {
          const dimmed = editingTokenIndex !== null && !brightSet.has(tokenIdx);
          if (/^w:/i.test(tokens[tokenIdx])) {
            cls = "hl-lyrics" + (dimmed ? " dimmed" : "");
          } else if (tokens[tokenIdx].indexOf("%") !== -1) {
            cls = "hl-chord" + (dimmed ? " dimmed" : "");
          } else {
            cls = "hl-other" + (dimmed ? " dimmed" : "");
          }
        } else {
          cls = "hl-header";
        }
      }
      return '<span class="' + cls + '">' + escaped + '</span>';
    }).join("\n");
    highlightEl.innerHTML = html;
    highlightEl.scrollTop = abcOutput.scrollTop;
    updateNavArrows();
  }

  const btnUndo = document.getElementById("btnUndo");

  function syncOutput() {
    abcOutput.value = HEADER + tokens.join("\n");
    btnUndo.disabled = tokens.length === 0;
    renderStaff();
    renderHighlight();
  }

  // Build a token string from an array of MIDI note numbers
  function buildTokenFromMidi(midiArray) {
    const sorted = [...midiArray].sort((a, b) => a - b);
    const chord = sorted.length >= 2 ? identifyChord(sorted) : null;
    const spellings = chord ? chord.spellings : null;

    const abcNotes = sorted.map(m => {
      if (spellings) {
        const k = keys.find(k => k.midi === m);
        const sp = spellings[m % 12];
        if (sp) return spellingToABC(sp, k.octave);
      }
      return midiToABC(m);
    });

    const readable = sorted.map(m => {
      if (spellings) {
        const k = keys.find(k => k.midi === m);
        const sp = spellings[m % 12];
        if (sp) return spellingToReadable(sp, k.octave);
      }
      return midiToNotation(m);
    }).join(" ");

    let token;
    if (abcNotes.length === 1) {
      token = abcNotes[0];
    } else {
      const prefix = chord ? '"' + chord.preferred + '"' : "";
      token = prefix + "[" + abcNotes.join("") + "]";
    }
    token += " % " + readable;
    return token;
  }

  // Edit a previewed chord by toggling a MIDI note in/out
  function editChord(midi) {
    if (editingMidi.has(midi)) {
      editingMidi.delete(midi);
    } else {
      editingMidi.add(midi);
    }

    if (editingMidi.size === 0) {
      tokens.splice(editingTokenIndex, 1);
      editingTokenIndex = null;
      pianoEl.querySelectorAll(".key.preview").forEach(el => el.classList.remove("preview"));
      syncOutput();
      syncAddButton();
      return;
    }

    tokens[editingTokenIndex] = buildTokenFromMidi(Array.from(editingMidi));
    syncOutput();

    // Update preview highlights
    pianoEl.querySelectorAll(".key.preview").forEach(el => el.classList.remove("preview"));
    editingMidi.forEach(m => {
      const el = pianoEl.querySelector('.key[data-midi="' + m + '"]');
      if (el) el.classList.add("preview");
    });

    // Play the updated chord
    const count = editingMidi.size;
    editingMidi.forEach(m => playTone(m, count));
  }

  // --- Button handlers ---
  btnAddChord.addEventListener("click", () => {
    if (selectedMidi.size === 0 || editingTokenIndex !== null) return;
    tokens.push(buildTokenFromMidi(Array.from(selectedMidi)));
    syncOutput();
    clearSelection();
  });

  btnClearKeys.addEventListener("click", () => {
    clearSelection();
  });

  document.getElementById("btnUndo").addEventListener("click", () => {
    if (tokens.length > 0) {
      const removed = tokens.pop();
      syncOutput();
      clearPreview();
      clearSelection();
      // Restore notes from the removed token onto the keyboard
      const commentIdx = removed.indexOf("%");
      if (commentIdx !== -1) {
        const noteStrs = removed.slice(commentIdx + 1).trim().split(/\s+/);
        for (const ns of noteStrs) {
          const midi = readableToMidi(ns);
          if (midi === null) continue;
          selectedMidi.add(midi);
          const el = pianoEl.querySelector('.key[data-midi="' + midi + '"]');
          if (el) el.classList.add("active");
        }
        updateSelectedDisplay();
      }
    }
  });

  document.getElementById("btnClear").addEventListener("click", () => {
    HEADER = "X:1\nT:Untitled\nM:4/4\nL:1/4\nK:C\n";
    tokens = [];
    loadedFilename = null;
    syncOutput();
    clearSelection();
    clearPreview();
  });

  document.getElementById("btnDownload").addEventListener("click", () => {
    const blob = new Blob([abcOutput.value], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = loadedFilename || "chords.abc";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  });

  const fileInput = document.getElementById("fileInput");

  document.getElementById("btnLoad").addEventListener("click", () => {
    fileInput.click();
  });

  fileInput.addEventListener("change", () => {
    const file = fileInput.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const result = parseAbcFile(e.target.result);
      if (!result) {
        alert("Could not load file: invalid ABC format.");
        return;
      }
      HEADER = result.header;
      tokens = result.tokens;
      loadedFilename = file.name;
      clearSelection();
      clearPreview();
      syncOutput();
    };
    reader.readAsText(file);
    fileInput.value = "";
  });

  // --- Textarea line preview ---
  const NOTE_NAME_TO_SEMI = { C:0, D:2, E:4, F:5, G:7, A:9, B:11 };

  function readableToMidi(str) {
    // Parse "C4", "F#3", "Ab5", "Bb2" etc. -> MIDI number
    const m = str.match(/^([A-G])(#|b)?(\d)$/);
    if (!m) return null;
    const letter = m[1];
    const acc = m[2] || "";
    const octave = parseInt(m[3]);
    let semi = NOTE_NAME_TO_SEMI[letter];
    if (semi === undefined) return null;
    if (acc === "#") semi += 1;
    else if (acc === "b") semi -= 1;
    return (octave + 1) * 12 + ((semi % 12 + 12) % 12);
  }

  function isChordToken(idx) {
    return idx >= 0 && idx < tokens.length && tokens[idx].indexOf("%") !== -1;
  }

  function clearPreview(skipRender) {
    pianoEl.querySelectorAll(".key.preview").forEach(el => el.classList.remove("preview"));
    editingTokenIndex = null;
    editingMidi.clear();
    syncAddButton();
    if (!skipRender) renderHighlight();
  }

  function getTokenIndexAtCursor() {
    const text = abcOutput.value;
    const pos = abcOutput.selectionStart;
    const lineNum = (text.slice(0, pos).match(/\n/g) || []).length;
    const headerLineCount = (HEADER.match(/\n/g) || []).length;
    const idx = lineNum - headerLineCount;
    return (idx >= 0 && idx < tokens.length) ? idx : null;
  }

  function previewLine(line, tokenIdx) {
    clearPreview(true);
    // Extract notes from the comment part (after %)
    const commentIdx = line.indexOf("%");
    if (commentIdx === -1) { renderHighlight(); return; }
    const comment = line.slice(commentIdx + 1).trim();
    const noteStrs = comment.split(/\s+/);
    const midiNotes = [];
    for (const ns of noteStrs) {
      const midi = readableToMidi(ns);
      if (midi === null) continue;
      midiNotes.push(midi);
      const el = pianoEl.querySelector('.key[data-midi="' + midi + '"]');
      if (el) el.classList.add("preview");
    }
    if (midiNotes.length > 0) {
      // Enter edit mode for this token
      if (tokenIdx !== null && tokenIdx !== undefined) {
        editingTokenIndex = tokenIdx;
        midiNotes.forEach(m => editingMidi.add(m));
      }
      const count = midiNotes.length;
      midiNotes.forEach(m => playTone(m, count));
    }
    syncAddButton();
    renderHighlight();
  }

  function getLineAtCursor() {
    const text = abcOutput.value;
    const pos = abcOutput.selectionStart;
    const lineStart = text.lastIndexOf("\n", pos - 1) + 1;
    let lineEnd = text.indexOf("\n", pos);
    if (lineEnd === -1) lineEnd = text.length;
    return text.slice(lineStart, lineEnd);
  }

  function moveCursorToToken(tokenIdx) {
    const headerLineCount = (HEADER.match(/\n/g) || []).length;
    const targetLine = headerLineCount + tokenIdx;
    const lines = abcOutput.value.split("\n");
    let charPos = 0;
    for (let i = 0; i < targetLine && i < lines.length; i++) {
      charPos += lines[i].length + 1;
    }
    abcOutput.selectionStart = charPos;
    abcOutput.selectionEnd = charPos + (lines[targetLine] || "").length;

    // Count trailing non-chord tokens (e.g. lyrics) so we scroll far enough to show them
    let extraLines = 0;
    for (let i = tokenIdx + 1; i < tokens.length && !isChordToken(i); i++) {
      extraLines++;
    }

    // Scroll to keep the selected line (plus trailing non-chord lines) visible
    const lineHeight = parseFloat(getComputedStyle(abcOutput).lineHeight) || 20;
    const pad = parseFloat(getComputedStyle(abcOutput).paddingTop) || 0;
    const lineTop = pad + targetLine * lineHeight;
    const bottomEdge = lineTop + (2 + extraLines) * lineHeight;
    const visibleTop = abcOutput.scrollTop;
    const visibleBottom = visibleTop + abcOutput.clientHeight;
    if (lineTop < visibleTop) {
      abcOutput.scrollTop = Math.max(0, lineTop - lineHeight - pad);
    } else if (bottomEdge > visibleBottom) {
      abcOutput.scrollTop = bottomEdge - abcOutput.clientHeight + pad;
    }
  }

  abcOutput.addEventListener("click", () => {
    const tokenIdx = getTokenIndexAtCursor();
    if (tokenIdx !== null && !isChordToken(tokenIdx)) {
      clearPreview();
      return;
    }
    previewLine(getLineAtCursor(), tokenIdx);
    if (tokenIdx !== null) moveCursorToToken(tokenIdx);
  });

  abcOutput.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    e.preventDefault();
    if (tokens.length === 0) return;

    const current = getTokenIndexAtCursor();
    const dir = e.key === "ArrowDown" ? 1 : -1;
    let target;

    if (current === null) {
      target = dir === 1 ? 0 : tokens.length - 1;
    } else {
      target = current + dir;
    }

    // Skip non-chord tokens (lyrics, bar lines, empty lines)
    while (target >= 0 && target < tokens.length && !isChordToken(target)) {
      target += dir;
    }

    if (target < 0 || target >= tokens.length) return;

    moveCursorToToken(target);
    previewLine(tokens[target], target);
  });

  // --- Line hover highlight ---
  const lineHoverEl = document.createElement("div");
  lineHoverEl.className = "line-hover";
  abcOutput.parentElement.appendChild(lineHoverEl);

  // --- Navigation arrows ---
  const arrowUp = document.createElement("div");
  arrowUp.className = "nav-arrow";
  arrowUp.textContent = "\u25B2";
  const arrowDown = document.createElement("div");
  arrowDown.className = "nav-arrow";
  arrowDown.textContent = "\u25BC";
  abcOutput.parentElement.appendChild(arrowUp);
  abcOutput.parentElement.appendChild(arrowDown);

  function navigateChord(dir) {
    if (editingTokenIndex === null) return;
    let target = editingTokenIndex + dir;
    while (target >= 0 && target < tokens.length && !isChordToken(target)) {
      target += dir;
    }
    if (target < 0 || target >= tokens.length) return;
    moveCursorToToken(target);
    previewLine(tokens[target], target);
  }

  function updateNavArrows() {
    if (editingTokenIndex === null) {
      arrowUp.style.display = "none";
      arrowDown.style.display = "none";
      return;
    }

    const cs = getComputedStyle(abcOutput);
    const lineHeight = parseFloat(cs.lineHeight) || 20;
    const padTop = parseFloat(cs.paddingTop) || 0;
    const borderTop = parseFloat(cs.borderTopWidth) || 0;
    const headerLineCount = (HEADER.match(/\n/g) || []).length;
    const selectedLineNum = headerLineCount + editingTokenIndex;

    let hasPrev = false;
    for (let i = editingTokenIndex - 1; i >= 0; i--) {
      if (isChordToken(i)) { hasPrev = true; break; }
    }
    let hasNext = false;
    for (let i = editingTokenIndex + 1; i < tokens.length; i++) {
      if (isChordToken(i)) { hasNext = true; break; }
    }

    // Up arrow -- line above selected
    if (hasPrev) {
      const y = padTop + (selectedLineNum - 1) * lineHeight - abcOutput.scrollTop;
      if (y >= 0 && y + lineHeight <= abcOutput.clientHeight) {
        arrowUp.style.display = "flex";
        arrowUp.style.top = (borderTop + y) + "px";
        arrowUp.style.height = lineHeight + "px";
      } else {
        arrowUp.style.display = "none";
      }
    } else {
      arrowUp.style.display = "none";
    }

    // Down arrow -- line below selected
    if (hasNext) {
      const y = padTop + (selectedLineNum + 1) * lineHeight - abcOutput.scrollTop;
      if (y >= 0 && y + lineHeight <= abcOutput.clientHeight) {
        arrowDown.style.display = "flex";
        arrowDown.style.top = (borderTop + y) + "px";
        arrowDown.style.height = lineHeight + "px";
      } else {
        arrowDown.style.display = "none";
      }
    } else {
      arrowDown.style.display = "none";
    }
  }

  arrowUp.addEventListener("mousedown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    navigateChord(-1);
  });

  arrowDown.addEventListener("mousedown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    navigateChord(1);
  });

  abcOutput.addEventListener("mousemove", (e) => {
    const cs = getComputedStyle(abcOutput);
    const lineHeight = parseFloat(cs.lineHeight) || 20;
    const padTop = parseFloat(cs.paddingTop) || 0;
    const borderTop = parseFloat(cs.borderTopWidth) || 0;
    const borderLeft = parseFloat(cs.borderLeftWidth) || 0;

    const rect = abcOutput.getBoundingClientRect();
    const mouseY = e.clientY - rect.top - borderTop - padTop + abcOutput.scrollTop;
    const lineIdx = Math.floor(mouseY / lineHeight);

    const headerLineCount = (HEADER.match(/\n/g) || []).length;
    const tokenIdx = lineIdx - headerLineCount;
    const totalLines = headerLineCount + tokens.length;

    // Only highlight chord lines; skip header, out-of-bounds, non-chord tokens, and currently selected line
    if (lineIdx < headerLineCount || lineIdx >= totalLines || !isChordToken(tokenIdx) || tokenIdx === editingTokenIndex) {
      lineHoverEl.style.display = "none";
      return;
    }

    // Check if line is visible within the textarea
    const visibleY = padTop + lineIdx * lineHeight - abcOutput.scrollTop;
    if (visibleY + lineHeight < 0 || visibleY > abcOutput.clientHeight) {
      lineHoverEl.style.display = "none";
      return;
    }

    lineHoverEl.style.display = "block";
    lineHoverEl.style.top = (abcOutput.offsetTop + borderTop + visibleY) + "px";
    lineHoverEl.style.left = borderLeft + "px";
    lineHoverEl.style.width = abcOutput.clientWidth + "px";
    lineHoverEl.style.height = lineHeight + "px";
  });

  abcOutput.addEventListener("mouseleave", () => {
    lineHoverEl.style.display = "none";
  });

  abcOutput.addEventListener("scroll", () => {
    lineHoverEl.style.display = "none";
    highlightEl.scrollTop = abcOutput.scrollTop;
    updateNavArrows();
  });

  // Clear preview when clicking anywhere outside the textarea
  document.addEventListener("mousedown", (e) => {
    if (!abcOutput.contains(e.target)) clearPreview();
  });

  // Initialize output and render staff
  syncOutput();
})();
