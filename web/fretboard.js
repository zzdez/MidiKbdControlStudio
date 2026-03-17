// Fretboard Logic
const stringTunes = ["E", "A", "D", "G", "B", "E"];
const baseNotes = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const scaleFormulas = {
    major: [0, 2, 4, 5, 7, 9, 11],
    minor: [0, 2, 3, 5, 7, 8, 10],
    major_pentatonic: [0, 2, 4, 7, 9],
    minor_pentatonic: [0, 3, 5, 7, 10],
    blues: [0, 3, 5, 6, 7, 10],
    dorian: [0, 2, 3, 5, 7, 9, 10],
    mixolydian: [0, 2, 4, 5, 7, 9, 10],
    phrygian: [0, 1, 3, 5, 7, 8, 10],
    lydian: [0, 2, 4, 6, 7, 9, 11],
    locrian: [0, 1, 3, 5, 6, 8, 10]
};

// Aliases mapping for "sharp/flat" parsing from key inputs like "Am" or "Eb"
const noteAliases = {
    "Db": "C#", "Eb": "D#", "Gb": "F#", "Ab": "G#", "Bb": "A#"
};

let fretboardState = {
    visible: false,
    key: "C",
    scale: "minor_pentatonic",
    tuning: "standard",
    isLefty: false,
    skin: "flat",
    fretsCount: 15
};

const tuningPresets = {
    "standard": ["E", "A", "D", "G", "B", "E"],
    "drop_d": ["D", "A", "D", "G", "B", "E"],
    "drop_c": ["C", "G", "C", "F", "A", "D"],
    "eb": ["D#", "G#", "C#", "F#", "A#", "D#"],
    "d": ["D", "G", "C", "F", "A", "D"],
    "open_g": ["D", "G", "D", "G", "B", "D"],
    "open_d": ["D", "A", "D", "F#", "A", "D"]
};

// --- DRAG LOGIC ---
function makeDraggable(overlayId, headerId) {
    const overlay = document.getElementById(overlayId);
    const header = document.getElementById(headerId);
    if (!overlay || !header) return;

    let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;

    header.onmousedown = dragMouseDown;

    function dragMouseDown(e) {
        if (e.target.tagName.toLowerCase() === 'select' || e.target.tagName.toLowerCase() === 'button' || e.target.closest('button')) {
            return; // let buttons/selects work normally
        }
        e.preventDefault();
        pos3 = e.clientX;
        pos4 = e.clientY;
        document.onmouseup = closeDragElement;
        document.onmousemove = elementDrag;
    }

    function elementDrag(e) {
        e.preventDefault();
        pos1 = pos3 - e.clientX;
        pos2 = pos4 - e.clientY;
        pos3 = e.clientX;
        pos4 = e.clientY;
        overlay.style.top = (overlay.offsetTop - pos2) + "px";
        overlay.style.left = (overlay.offsetLeft - pos1) + "px";
    }

    function closeDragElement() {
        document.onmouseup = null;
        document.onmousemove = null;
    }
}

// Ensure init after DOM
document.addEventListener("DOMContentLoaded", () => {
    makeDraggable("fretboard-overlay", "fretboard-header");
});

function toggleFretboard() {
    const fb = document.getElementById("fretboard-overlay");
    if (!fb) return;

    fretboardState.visible = !fretboardState.visible;
    fb.style.display = fretboardState.visible ? "block" : "none";

    if (fretboardState.visible) {
        // Auto-detect currently playing item's key/scale if we just opened it
        detectCurrentScale();
        renderFretboard();
    }
}

function detectCurrentScale() {
    if (window.currentPlayingIndex === undefined) return;
    let item = null;
    if (currentActivePlayer === 'local' || currentActivePlayer === 'multitrack' || currentActivePlayer === 'waveform') {
        item = localFiles[window.currentPlayingIndex];
    } else if (currentActivePlayer === 'youtube') {
        item = currentTrackList.find(t => t.originalIndex === window.currentPlayingIndex);
    }
    if (!item) return;

    let rawKey = item.media_key || item.key || "";
    if (rawKey) {
        // Basic parser: "Am" -> "A", minor. "C#m" -> "C#", minor. "Eb" -> "D#", major.
        let isMin = rawKey.toLowerCase().includes("m");
        let parsedRoot = rawKey.replace(/m/ig, '').trim(); // Remove 'm'

        // Handle Flats
        if (noteAliases[parsedRoot]) parsedRoot = noteAliases[parsedRoot];

        // Ensure it's valid
        if (baseNotes.includes(parsedRoot)) {
            fretboardState.key = parsedRoot;
            document.getElementById("fretboard-key").value = parsedRoot;
        }

        // Apply scale if provided, else guess from 'm'
        if (item.scale && scaleFormulas[item.scale]) {
            fretboardState.scale = item.scale;
        } else {
            fretboardState.scale = isMin ? "minor_pentatonic" : "major_pentatonic";
        }
        document.getElementById("fretboard-scale").value = fretboardState.scale;

    if (item.tuning) {
        fretboardState.tuning = item.tuning;
        document.getElementById("fretboard-tuning").value = fretboardState.tuning;
    }
    } else {
        // Fallback or read from UI if no metadata
        fretboardState.key = document.getElementById("fretboard-key").value;
        fretboardState.scale = document.getElementById("fretboard-scale").value;
        fretboardState.tuning = document.getElementById("fretboard-tuning").value;
    }
    updateFretboardButtonDisplays();
}

function updateFretboardButtonDisplays() {
    // Updates the tiny text next to the guitar icon on the playbars
    const ids = ["mt-scale-display", "audio-scale-display", "video-scale-display"];
    const text = `${fretboardState.key} ${document.getElementById("fretboard-scale").options[document.getElementById("fretboard-scale").selectedIndex].text}`;

    ids.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.innerText = text;
    });
}

function toggleFretboardHand() {
    fretboardState.isLefty = !fretboardState.isLefty;
    renderFretboard();
}

// Logic Utils
function getNoteIndex(note) {
    return baseNotes.indexOf(note);
}

function getNoteAtFret(stringNote, fret) {
    const startIndex = getNoteIndex(stringNote);
    const index = (startIndex + fret) % 12;
    return baseNotes[index];
}

function getScaleNotes(rootNote, scaleType) {
    const rootIndex = getNoteIndex(rootNote);
    const formula = scaleFormulas[scaleType];
    return formula.map(interval => baseNotes[(rootIndex + interval) % 12]);
}

function getPositionFretRange(rootNote, scaleType, position, tuning) {
    if (position === "all") return null;

    const scaleNotes = getScaleNotes(rootNote, scaleType);
    const formula = scaleFormulas[scaleType];
    const numNotesInScale = formula.length;

    // Convert 1-based position to 0-based index
    let posIndex = parseInt(position) - 1;

    // Safety check, but we map invalid higher positions back to a logical lower position using modulo
    if (posIndex >= numNotesInScale) {
        // Pentatonics only have 5 positions, diatonic scales have 7.
        // If a user has a pentatonic selected and chooses position 6, map it to pos 1.
        posIndex = posIndex % numNotesInScale;
    }

    // Find where the root note is on the lowest string
    const currentTuning = tuningPresets[tuning] || tuningPresets["standard"];
    const lowestStringNote = currentTuning[0]; // Usually E

    // Find the first fret of the root note on the lowest string
    let rootFretOnE = -1;
    for (let f = 0; f < 12; f++) {
        if (getNoteAtFret(lowestStringNote, f) === rootNote) {
            rootFretOnE = f;
            break;
        }
    }

    // Calculate the fret of the target note for the requested position on the lowest string
    // The positions start from the root note.
    const intervalFromRoot = formula[posIndex];
    let posStartFret = (rootFretOnE + intervalFromRoot) % 12;

    // We want the position block to generally span ~4-5 frets.
    // Allow a small offset (e.g., -1 to +4) for visual highlighting
    // to capture notes just behind the position start (often used in scale boxes).

    // Special handling to map it logically across the fretboard up to fret 24.
    // We will highlight all occurrences of this "block" of frets across octaves.
    return {
        start: posStartFret,
        span: 4 // Highlight 4 frets from the start note
    };
}


function updatePositionDropdown() {
    const positionSelect = document.getElementById("fretboard-position");
    if (!positionSelect) return;

    const scaleType = document.getElementById("fretboard-scale").value;
    const formula = scaleFormulas[scaleType];
    const numPositions = formula.length; // e.g. 5 for pentatonic, 7 for diatonic

    // Remember currently selected position
    let currentVal = positionSelect.value;

    // Clear current options except "All"
    positionSelect.innerHTML = `<option value="all" data-i18n="web.fretboard_pos_all">All Pos</option>`;

    for (let i = 1; i <= numPositions; i++) {
        const opt = document.createElement("option");
        opt.value = i;
        opt.innerText = "Pos " + i;
        positionSelect.appendChild(opt);
    }

    // Re-apply localization immediately
    if (typeof applyTranslations === "function") {
        applyTranslations();
    }

    // Restore previous selection if valid
    if (currentVal !== "all" && parseInt(currentVal) <= numPositions) {
        positionSelect.value = currentVal;
    } else {
        positionSelect.value = "all";
    }
}


function renderFretboard(silentSave = false) {
    fretboardState.key = document.getElementById("fretboard-key").value;
    fretboardState.scale = document.getElementById("fretboard-scale").value;
    fretboardState.tuning = document.getElementById("fretboard-tuning").value;
    updatePositionDropdown();
    updateFretboardButtonDisplays();

    if (silentSave && window.currentPlayingIndex !== undefined) {
        let item = null;
        let isLocal = false;

        // Find the active item based on the active player type
        if (currentActivePlayer === 'local' || currentActivePlayer === 'multitrack' || currentActivePlayer === 'waveform') {
            item = localFiles[window.currentPlayingIndex];
            isLocal = true;
        } else if (currentActivePlayer === 'youtube') {
            item = currentTrackList.find(t => t.originalIndex === window.currentPlayingIndex);
        }

        if (item) {
            item.key = fretboardState.key;
            item.scale = fretboardState.scale;
            item.tuning = fretboardState.tuning;

            // Sync with Global UI if currently playing track
            const globalKey = document.getElementById("global-video-key");
            const globalScale = document.getElementById("global-video-scale");
            if (globalKey) {
                globalKey.style.display = "inline";
                globalKey.querySelector(".val").innerText = item.key;
            }
            if (globalScale) {
                globalScale.style.display = "inline";
                globalScale.querySelector(".val").innerText = document.getElementById("fretboard-scale").options[document.getElementById("fretboard-scale").selectedIndex].text;
            }

            // Save to backend
            if (isLocal) {
                 saveLocalItemQuiet(window.currentPlayingIndex, item);
            } else {
                 saveItemQuiet(window.currentPlayingIndex, item);
            }
        }
    }

    const fretsContainer = document.getElementById("fretboard-frets");
    const stringsContainer = document.getElementById("fretboard-strings");
    const nut = document.getElementById("fretboard-nut");
    const wrapper = document.getElementById("fretboard-neck-wrapper");
    const numbersContainer = document.getElementById("fretboard-numbers");

    // Apply Skin (future proofing for wood theme)
    if (fretboardState.skin === "wood") {
        wrapper.style.background = "linear-gradient(to bottom, #5c4033, #3e2723, #5c4033)";
        nut.style.background = "#fffdd0";
    } else {
        wrapper.style.background = "#1a1a1a";
        nut.style.background = "#d4c4a8";
    }

    // Handle Lefty
    const isLefty = fretboardState.isLefty;
    if (isLefty) {
        nut.style.order = 2;
        fretsContainer.style.order = 1;
        nut.style.borderRight = "none";
        nut.style.borderLeft = "1px solid #8c7b64";
        // Also reverse padding logic on the numbers container based on layout structure
        numbersContainer.style.paddingLeft = "0";
        numbersContainer.style.paddingRight = "8px";
    } else {
        nut.style.order = 1;
        fretsContainer.style.order = 2;
        nut.style.borderLeft = "none";
        nut.style.borderRight = "1px solid #8c7b64";
        numbersContainer.style.paddingLeft = "8px";
        numbersContainer.style.paddingRight = "0";
    }

    fretsContainer.innerHTML = "";
    stringsContainer.innerHTML = "";
    numbersContainer.innerHTML = "";

    const activeScaleNotes = getScaleNotes(fretboardState.key, fretboardState.scale);

    // Position handling
    const positionSelect = document.getElementById("fretboard-position");
    const activePosition = positionSelect ? positionSelect.value : "all";
    const posRange = getPositionFretRange(fretboardState.key, fretboardState.scale, activePosition, fretboardState.tuning);

    // 1. Draw Frets (Background vertical dividers & inlays) & Numbers
    const inlays = [3, 5, 7, 9, 15, 17, 19, 21];
    const doubleInlays = [12, 24];

    for (let f = 1; f <= fretboardState.fretsCount; f++) {
        const visualFretNum = isLefty ? (fretboardState.fretsCount - f + 1) : f;

        const fretDiv = document.createElement("div");
        fretDiv.style.flex = "1";
        fretDiv.style.borderRight = isLefty ? "none" : "2px solid #555";
        fretDiv.style.borderLeft = isLefty ? "2px solid #555" : "none";
        fretDiv.style.position = "relative";
        fretDiv.style.display = "flex";
        fretDiv.style.justifyContent = "center";
        fretDiv.style.alignItems = "center";

        const numDiv = document.createElement("div");
        numDiv.style.flex = "1";
        numDiv.style.display = "flex";
        numDiv.style.justifyContent = "center";
        numDiv.style.alignItems = "center";
        numDiv.style.color = "#999";
        numDiv.style.fontSize = "12px";
        numDiv.style.fontWeight = "bold";

        // Show numbers mostly on inlay frets to reduce clutter
        if (inlays.includes(visualFretNum) || doubleInlays.includes(visualFretNum)) {
            numDiv.innerText = visualFretNum;
        }

        // When frets > 15, the numbers may get squished if text is too large
        if (fretboardState.fretsCount > 15) {
            numDiv.style.fontSize = "10px";
        }

        numbersContainer.appendChild(numDiv);

        // Inlays
        if (inlays.includes(visualFretNum)) {
            const dot = document.createElement("div");
            dot.style.width = "12px"; dot.style.height = "12px";
            dot.style.borderRadius = "50%";
            dot.style.background = fretboardState.skin === "wood" ? "rgba(255,255,255,0.7)" : "rgba(255,255,255,0.15)";
            fretDiv.appendChild(dot);
        } else if (doubleInlays.includes(visualFretNum)) {
            const dot1 = document.createElement("div");
            dot1.style.width = "12px"; dot1.style.height = "12px";
            dot1.style.borderRadius = "50%";
            dot1.style.background = fretboardState.skin === "wood" ? "rgba(255,255,255,0.7)" : "rgba(255,255,255,0.15)";
            dot1.style.position = "absolute"; dot1.style.top = "25%";

            const dot2 = document.createElement("div");
            dot2.style.width = "12px"; dot2.style.height = "12px";
            dot2.style.borderRadius = "50%";
            dot2.style.background = fretboardState.skin === "wood" ? "rgba(255,255,255,0.7)" : "rgba(255,255,255,0.15)";
            dot2.style.position = "absolute"; dot2.style.bottom = "25%";

            fretDiv.appendChild(dot1);
            fretDiv.appendChild(dot2);
        }

        fretsContainer.appendChild(fretDiv);
    }

    // 2. Draw Strings & Notes
    const currentTuning = tuningPresets[fretboardState.tuning] || tuningPresets["standard"];
    const displayStrings = [...currentTuning].reverse(); // (Top to Bottom visually)

    displayStrings.forEach((stringNote, stringIndex) => {
        // Draw the physical string line
        const strLine = document.createElement("div");
        strLine.style.width = "100%";
        strLine.style.height = (1 + (stringIndex * 0.5)) + "px"; // Thicker for lower strings
        strLine.style.background = fretboardState.skin === "wood" ? "linear-gradient(to bottom, #eee, #999)" : "#444";
        strLine.style.boxShadow = "0 1px 2px rgba(0,0,0,0.5)";
        strLine.style.position = "absolute";
        // Calculate vertical position to distribute evenly with margins using calc
        // We use a safe margin on top and bottom (e.g. 5px) to space out the strings naturally
        // Total usable area: 100% - 10px.
        // We add 5px base offset.
        // So string 0 is at 5px down (from top edge)
        // String 5 is at 100% - 5px (from top edge)
        const strMargin = 5;
        const topPct = (stringIndex / 5);
        strLine.style.top = `calc(${strMargin}px + ${topPct} * (100% - ${strMargin * 2}px))`;
        strLine.style.transform = "translateY(-50%)"; // Center vertically on its own coordinate

        stringsContainer.appendChild(strLine);

        // Draw Notes for this string
        // Fret 0 (Nut) is rendered specially, hovering over the nut area.
        // But for simplicity, we map 0 to the absolute left (or right if lefty).
        const drawNote = (fretNum, isNut) => {
            const noteName = getNoteAtFret(stringNote, fretNum);
            if (!activeScaleNotes.includes(noteName)) return; // Not in scale

            const isRoot = (noteName === fretboardState.key);

            // Position Highlight Logic
            let inPosition = true;
            if (posRange && !isNut) {
                // Check if the current fret falls within the position block across any octave
                // We use modulo 12 to check against the base octave shape
                const modFret = fretNum % 12;

                // The span might cross the octave boundary (e.g., frets 10, 11, 0, 1, 2)
                let startMod = posRange.start;
                let endMod = (posRange.start + posRange.span) % 12;

                if (startMod <= endMod) {
                    inPosition = (modFret >= startMod && modFret <= endMod);
                } else {
                    // Span crosses the 12th fret
                    inPosition = (modFret >= startMod || modFret <= endMod);
                }
            } else if (posRange && isNut) {
                // For nut (open strings), check if open string note is in the position block
                let startMod = posRange.start;
                let endMod = (posRange.start + posRange.span) % 12;
                if (startMod <= endMod) {
                    inPosition = (0 >= startMod && 0 <= endMod);
                } else {
                    inPosition = (0 >= startMod || 0 <= endMod);
                }
            }

            const noteDot = document.createElement("div");
            noteDot.style.position = "absolute";
            noteDot.style.width = "18px";
            noteDot.style.height = "18px";
            noteDot.style.borderRadius = "50%";
            noteDot.style.background = isRoot ? "var(--accent)" : "#555";
            noteDot.style.color = isRoot ? "#000" : "#fff";
            noteDot.style.display = "flex";
            noteDot.style.justifyContent = "center";
            noteDot.style.alignItems = "center";
            noteDot.style.fontSize = noteName.length > 1 ? "8.5px" : "10px"; // Adjust for sharps/flats
            noteDot.style.fontWeight = "bold";
            noteDot.style.lineHeight = "1";
            noteDot.style.letterSpacing = "-0.5px";
            noteDot.style.pointerEvents = "auto"; // Can hover if we want tooltips later
            noteDot.style.boxShadow = "0 2px 4px rgba(0,0,0,0.5)";

            // Dim notes outside the active position
            if (posRange && !inPosition) {
                noteDot.style.opacity = "0.2";
                noteDot.style.boxShadow = "none";
                noteDot.style.zIndex = "10";
            } else {
                noteDot.style.opacity = "1";
                noteDot.style.zIndex = "20";
                if (posRange) {
                     noteDot.style.transition = "all 0.2s ease";
                }
            }

            noteDot.innerText = noteName;

            // Positioning
            const yPosStr = `calc(${strMargin}px + ${topPct} * (100% - ${strMargin * 2}px))`;

            if (isNut) {
                if (isLefty) {
                    noteDot.style.right = "0";
                    noteDot.style.transform = posRange && inPosition ? "translate(50%, -50%) scale(1.15)" : "translate(50%, -50%)";
                    noteDot.style.top = yPosStr;
                } else {
                    noteDot.style.left = "0";
                    noteDot.style.transform = posRange && inPosition ? "translate(-50%, -50%) scale(1.15)" : "translate(-50%, -50%)";
                    noteDot.style.top = yPosStr;
                }
            } else {
                // Calculate percentage based on fret container
                const fretWidthPct = 100 / fretboardState.fretsCount;
                let xPosPct;
                if (isLefty) {
                    xPosPct = 100 - (fretNum * fretWidthPct) + (fretWidthPct / 2);
                } else {
                    xPosPct = (fretNum * fretWidthPct) - (fretWidthPct / 2);
                }

                // Adjust for the 8px nut offset by putting noteDot relative to frets container
                // Actually stringsContainer covers the whole width including nut.
                // It's easier to place relative to stringsContainer by adding/subtracting the nut width (8px).
                const nutOffsetPx = 8;
                if (isLefty) {
                    noteDot.style.right = `calc(${100 - xPosPct}% + ${nutOffsetPx}px)`;
                    noteDot.style.transform = posRange && inPosition ? "translate(50%, -50%) scale(1.15)" : "translate(50%, -50%)";
                    noteDot.style.top = yPosStr;
                } else {
                    noteDot.style.left = `calc(${xPosPct}% + ${nutOffsetPx}px)`;
                    noteDot.style.transform = posRange && inPosition ? "translate(-50%, -50%) scale(1.15)" : "translate(-50%, -50%)";
                    noteDot.style.top = yPosStr;
                }
            }

            stringsContainer.appendChild(noteDot);
        };

        // Draw Nut Note (0)
        drawNote(0, true);

        // Draw Fretted Notes
        for (let f = 1; f <= fretboardState.fretsCount; f++) {
            drawNote(f, false);
        }
    });
}

function cycleFretCount() {
    if (fretboardState.fretsCount === 15) {
        fretboardState.fretsCount = 22;
    } else if (fretboardState.fretsCount === 22) {
        fretboardState.fretsCount = 24;
    } else {
        fretboardState.fretsCount = 15;
    }

    const btn = document.getElementById("btn-fret-count");
    if (btn) btn.innerHTML = fretboardState.fretsCount;

    renderFretboard();
}
