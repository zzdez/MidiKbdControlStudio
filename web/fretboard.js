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

// Dictionnaire d'ajustements (offset et largeur) pour coller aux boîtes standards
const positionModifiers = {
    "minor_pentatonic": [
        { offset: 0, span: 3 },  // Pos 1 (ex: 7-10)
        { offset: -1, span: 3 }, // Pos 2 (ex: 9-12)
        { offset: -1, span: 4 }, // Pos 3 (ex: 11-15)
        { offset: 0, span: 3 },  // Pos 4 (ex: 14-17)
        { offset: -1, span: 3 }  // Pos 5 (ex: 16-19)
    ],
    "major_pentatonic": [
        { offset: -1, span: 3 }, // Pos 1 (équivalent Pos 2 mineure)
        { offset: -1, span: 4 }, // Pos 2 (équivalent Pos 3 mineure)
        { offset: 0, span: 3 },  // Pos 3 (équivalent Pos 4 mineure)
        { offset: -1, span: 3 }, // Pos 4 (équivalent Pos 5 mineure)
        { offset: 0, span: 3 }   // Pos 5 (équivalent Pos 1 mineure)
    ]
};

// Aliases mapping for "sharp/flat" parsing from key inputs like "Am" or "Eb"
const noteAliases = {
    "Db": "C#", "Eb": "D#", "Gb": "F#", "Ab": "G#", "Bb": "A#"
};

let fretboardState = {
    visible: false,
    instrument: "guitar_6",
    key: "C",
    scale: "minor_pentatonic",
    tuning: "standard",
    isLefty: false,
    skin: "flat",
    fretsCount: 15
};

const instruments = {
    "guitar_6": {
        name: "Guitare (6)",
        icon: "ph-guitar",
        tunings: ["standard", "drop_d", "drop_c", "eb", "d", "open_g", "open_d"]
    },
    "guitar_7": {
        name: "Guitare (7)",
        icon: "ph-guitar",
        tunings: ["standard_7", "drop_a_7"]
    },
    "bass_4": {
        name: "Basse (4)",
        icon: "ph-speaker-hifi",
        tunings: ["standard_bass_4", "drop_d_bass_4", "eb_bass_4"]
    },
    "bass_5": {
        name: "Basse (5)",
        icon: "ph-speaker-hifi",
        tunings: ["standard_bass_5"]
    }
};

const tuningPresets = {
    // Guitar 6
    "standard": ["E", "A", "D", "G", "B", "E"],
    "drop_d": ["D", "A", "D", "G", "B", "E"],
    "drop_c": ["C", "G", "C", "F", "A", "D"],
    "eb": ["D#", "G#", "C#", "F#", "A#", "D#"],
    "d": ["D", "G", "C", "F", "A", "D"],
    "open_g": ["D", "G", "D", "G", "B", "D"],
    "open_d": ["D", "A", "D", "F#", "A", "D"],
    // Guitar 7
    "standard_7": ["B", "E", "A", "D", "G", "B", "E"],
    "drop_a_7": ["A", "E", "A", "D", "G", "B", "E"],
    // Bass 4
    "standard_bass_4": ["E", "A", "D", "G"],
    "drop_d_bass_4": ["D", "A", "D", "G"],
    "eb_bass_4": ["D#", "G#", "C#", "F#"],
    // Bass 5
    "standard_bass_5": ["B", "E", "A", "D", "G"]
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
        
        let newTop = overlay.offsetTop - pos2;
        let newLeft = overlay.offsetLeft - pos1;
        
        overlay.style.top = newTop + "px";
        overlay.style.left = newLeft + "px";
    }

    function closeDragElement() {
        document.onmouseup = null;
        document.onmousemove = null;
    }
}

// Ensure init after DOM
document.addEventListener("DOMContentLoaded", () => {
    makeDraggable("fretboard-overlay", "fretboard-header");

    // Close instrument menu when clicking outside
    document.addEventListener("click", (e) => {
        const menu = document.getElementById("fretboard-instrument-menu");
        const btn = document.getElementById("btn-instrument-select");
        if (menu && menu.style.display === "block" && !menu.contains(e.target) && !btn.contains(e.target)) {
            menu.style.display = "none";
        }
    });
});

function toggleInstrumentMenu(e) {
    if (e) e.preventDefault();
    const menu = document.getElementById("fretboard-instrument-menu");
    if (menu) {
        menu.style.display = menu.style.display === "none" ? "block" : "none";
    }
}

function changeInstrument(instKey) {
    if (!instruments[instKey]) return;

    fretboardState.instrument = instKey;
    const inst = instruments[instKey];

    // Update Header UI
    document.getElementById("fretboard-instrument-icon").className = "ph " + inst.icon;
    document.getElementById("fretboard-instrument-label").innerText = inst.name;
    document.getElementById("fretboard-instrument-menu").style.display = "none";

    // Update Tunings Dropdown
    const tuningSelect = document.getElementById("fretboard-tuning");
    tuningSelect.innerHTML = "";

    inst.tunings.forEach(t => {
        const opt = document.createElement("option");
        opt.value = t;
        opt.setAttribute("data-i18n", `web.tuning_${t}`);
        opt.innerText = t; // Will be localized
        tuningSelect.appendChild(opt);
    });

    // Default to the first tuning of the new instrument
    fretboardState.tuning = inst.tunings[0];
    tuningSelect.value = fretboardState.tuning;

    if (typeof applyTranslations === "function") {
        applyTranslations();
    }

    renderFretboard(true);
}

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

        // Restore Instrument (if saved), else default to guitar_6
        let savedInst = item.instrument || "guitar_6";
        if (instruments[savedInst]) {
            // Only update UI, changeInstrument will trigger a render, we don't want that here
            fretboardState.instrument = savedInst;
            const inst = instruments[savedInst];
            document.getElementById("fretboard-instrument-icon").className = "ph " + inst.icon;
            document.getElementById("fretboard-instrument-label").innerText = inst.name;

            // Re-populate tunings for this instrument
            const tuningSelect = document.getElementById("fretboard-tuning");
            tuningSelect.innerHTML = "";
            inst.tunings.forEach(t => {
                const opt = document.createElement("option");
                opt.value = t;
                opt.setAttribute("data-i18n", `web.tuning_${t}`);
                opt.innerText = t;
                tuningSelect.appendChild(opt);
            });
        }

        if (item.tuning && instruments[fretboardState.instrument].tunings.includes(item.tuning)) {
            fretboardState.tuning = item.tuning;
            document.getElementById("fretboard-tuning").value = fretboardState.tuning;
        } else {
             // Fallback to instrument default if tuning is invalid for this instrument
             fretboardState.tuning = instruments[fretboardState.instrument].tunings[0];
             document.getElementById("fretboard-tuning").value = fretboardState.tuning;
        }

        if (typeof applyTranslations === "function") {
            applyTranslations();
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
    let posStartFret = (rootFretOnE + intervalFromRoot);

    // --- AJUSTEMENT DES BOÎTES ---
    let offset = 0;
    let span = 4; // Valeur par défaut

    if (typeof positionModifiers !== 'undefined') {
        const mods = positionModifiers[scaleType];
        if (mods && mods[posIndex]) {
            offset = mods[posIndex].offset;
            span = mods[posIndex].span;
        }
    }

    // Appliquer le décalage (garde la valeur absolue sur le manche)
    posStartFret = (posStartFret + offset);
    if (posStartFret < 0) posStartFret += 12; // Gérer offsets négatifs d'ancrage

    return {
        start: posStartFret,
        span: span 
    };
}

function isNoteInPosition(fretNum, isNut, posRange, octaveMode = "all", strictAbsolute = false) {
    if (!posRange) return true;

    if (strictAbsolute) {
        const absStart = posRange.start;
        const absEnd = posRange.start + posRange.span;
        if (isNut) {
            return (0 >= absStart && 0 <= absEnd);
        }
        return (fretNum >= absStart && fretNum <= absEnd);
    }

    if (octaveMode === "low" && fretNum > 12) return false;
    if (octaveMode === "high" && fretNum < 12) return false;

    if (!isNut) {
        const modFret = fretNum % 12;
        const startMod = posRange.start % 12;
        const endMod = (posRange.start + posRange.span) % 12;

        if (startMod <= endMod) {
            return (modFret >= startMod && modFret <= endMod);
        } else {
            return (modFret >= startMod || modFret <= endMod);
        }
    } else {
        if (octaveMode === "high") return false;
        const startMod = posRange.start % 12;
        const endMod = (posRange.start + posRange.span) % 12;
        if (startMod <= endMod) {
            return (0 >= startMod && 0 <= endMod);
        } else {
            return (0 >= startMod || 0 <= endMod);
        }
    }
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
            item.instrument = fretboardState.instrument;

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

    const startPosContainer = document.getElementById("fret-all-start-container");
    if (startPosContainer) {
        startPosContainer.style.display = activePosition === "all" ? "flex" : "none";
    }

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
        const inlayColor = fretboardState.skin === "wood" ? "rgba(255,255,255,0.7)" : "#d4c4a8";

        if (inlays.includes(visualFretNum)) {
            const dot = document.createElement("div");
            dot.style.width = "12px"; dot.style.height = "12px";
            dot.style.borderRadius = "50%";
            dot.style.background = inlayColor;

            // For flat skin, maybe make them slightly less opaque so they don't overpower the notes,
            // but keep the d4c4a8 color base.
            if (fretboardState.skin !== "wood") dot.style.opacity = "0.4";

            fretDiv.appendChild(dot);
        } else if (doubleInlays.includes(visualFretNum)) {
            const dot1 = document.createElement("div");
            dot1.style.width = "12px"; dot1.style.height = "12px";
            dot1.style.borderRadius = "50%";
            dot1.style.background = inlayColor;
            if (fretboardState.skin !== "wood") dot1.style.opacity = "0.4";
            dot1.style.position = "absolute"; dot1.style.top = "25%";

            const dot2 = document.createElement("div");
            dot2.style.width = "12px"; dot2.style.height = "12px";
            dot2.style.borderRadius = "50%";
            dot2.style.background = inlayColor;
            if (fretboardState.skin !== "wood") dot2.style.opacity = "0.4";
            dot2.style.position = "absolute"; dot2.style.bottom = "25%";

            fretDiv.appendChild(dot1);
            fretDiv.appendChild(dot2);
        }

        fretsContainer.appendChild(fretDiv);
    }

    // 2. Draw Strings & Notes
    const currentTuning = tuningPresets[fretboardState.tuning] || tuningPresets["standard"];
    const displayStrings = [...currentTuning].reverse(); // (Top to Bottom visually)
    const numStrings = displayStrings.length;

    displayStrings.forEach((stringNote, stringIndex) => {
        // Draw the physical string line
        const strLine = document.createElement("div");
        strLine.style.width = "100%";

        // Bass strings are naturally thicker
        const isBass = fretboardState.instrument.startsWith("bass_");
        const baseThickness = isBass ? 2 : 1;
        strLine.style.height = (baseThickness + (stringIndex * (isBass ? 0.8 : 0.5))) + "px";

        strLine.style.background = fretboardState.skin === "wood" ? "linear-gradient(to bottom, #eee, #999)" : "#444";
        strLine.style.boxShadow = "0 1px 2px rgba(0,0,0,0.5)";
        strLine.style.position = "absolute";

        // Calculate vertical position dynamically based on number of strings
        // We use a safe margin on top and bottom (e.g. 8px) to space out the strings naturally
        const strMargin = 8;
        // The denominator is (numStrings - 1) to distribute across the available space
        const topPct = numStrings > 1 ? (stringIndex / (numStrings - 1)) : 0.5;

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
            const octaveSelect = document.getElementById("fretboard-octave");
            const octaveMode = octaveSelect ? octaveSelect.value : "all";
            let inPosition = isNoteInPosition(fretNum, isNut, posRange, octaveMode);

            // Style logic based on Display Mode
            const displayModeSelect = document.getElementById("fretboard-display-mode");
            const displayMode = displayModeSelect ? displayModeSelect.value : "intervals";

            let bgColor = "#555";
            let textColor = "#fff";

            if (isRoot) {
                bgColor = "var(--accent)";
                textColor = "#000";
            } else if (displayMode === "intervals") {
                // Calculate Interval
                const rootIndex = getNoteIndex(fretboardState.key);
                const noteIndex = getNoteIndex(noteName);
                let interval = (noteIndex - rootIndex) % 12;
                if (interval < 0) interval += 12;

                if (interval === 3 || interval === 4 || interval === 7) {
                    // Minor 3rd, Major 3rd, Perfect 5th
                    bgColor = "#e0e0e0";
                    textColor = "#000";
                } else if (interval === 6) {
                    // Flat 5 (Blue note)
                    bgColor = "#1e88e5"; // Bleu
                    textColor = "#fff";
                }
            } else if (displayMode === "classic") {
                // Classic: All other notes are the nut color (d4c4a8 for flat, or 555 for wood)
                bgColor = fretboardState.skin === "wood" ? "#555" : "#d4c4a8";
                textColor = fretboardState.skin === "wood" ? "#fff" : "#000";
            } else if (displayMode === "minimal") {
                // Minimal: All other notes are dark gray (already default: #555, #fff)
                bgColor = "#555";
                textColor = "#fff";
            }

            const noteDot = document.createElement("div");
            noteDot.style.position = "absolute";
            noteDot.style.width = "18px";
            noteDot.style.height = "18px";
            noteDot.style.borderRadius = "50%";
            noteDot.style.background = bgColor;
            noteDot.style.color = textColor;
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

            // Save original styles for restoration during animation clearing
            noteDot.className = "note-dot-element";
            noteDot.dataset.note = noteName;
            noteDot.dataset.fret = fretNum;
            noteDot.dataset.string = stringIndex;
            noteDot.dataset.origBg = bgColor;
            noteDot.dataset.origTransform = noteDot.style.transform;
            noteDot.dataset.origZ = noteDot.style.zIndex;

            stringsContainer.appendChild(noteDot);
        };

        // Draw Nut Note (0)
        drawNote(0, true);

        // Draw Fretted Notes
        for (let f = 1; f <= fretboardState.fretsCount; f++) {
            drawNote(f, false);
        }
    });

    if (typeof applyTranslations === "function") applyTranslations();

    if (fretboardTrainerActive) {
        generateExerciseNotes();
    }
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

// ==========================================
// FRETBOARD TRAINING LOGIC
// ==========================================

let fretboardTrainerActive = false;
let fretboardExerciseNotes = [];
let currentExerciseIndex = -1;

function toggleFretTrainer() {
    const body = document.getElementById("fret-trainer-body");
    const icon = document.getElementById("fret-trainer-toggle-icon");
    if (!body || !icon) return;
    
    if (body.style.display === "none") {
        body.style.display = "flex";
        icon.className = "ph ph-caret-down";
    } else {
        body.style.display = "none";
        icon.className = "ph ph-caret-right";
    }
}

function toggleFretboardTrainer(enabled) {
    fretboardTrainerActive = enabled;
    if (window.metronome) {
        window.metronome.isTraining = enabled;
        if (enabled) {
            window.metronome.trainTargetBPM = parseInt(document.getElementById("fret-train-target").value) || 160;
            window.metronome.trainIncrement = parseInt(document.getElementById("fret-train-inc").value) || 5;
            window.metronome.trainMeasures = parseInt(document.getElementById("fret-train-meas").value) || 4;
            generateExerciseNotes();
        } else {
            clearNoteHighlights();
        }
    }
}

function generateExerciseNotes() {
    const dots = Array.from(document.querySelectorAll("#fretboard-strings .note-dot-element"));
    if (dots.length === 0) return;

    const positionSelect = document.getElementById("fretboard-position");
    const activePosition = positionSelect ? positionSelect.value : "all";
    
    let activeDots = [];
    const exercise = document.getElementById("fret-exercise").value;

    if (activePosition === "all") {
        const scaleType = document.getElementById("fretboard-scale").value;
        const keyNode = document.getElementById("fretboard-key").value;
        const tuning = document.getElementById("fretboard-tuning").value;
        const octaveSelect = document.getElementById("fretboard-octave");
        const octaveMode = octaveSelect ? octaveSelect.value : "all";

        const mods = typeof positionModifiers !== 'undefined' ? positionModifiers[scaleType] : null;
        const formula = typeof scaleFormulas !== 'undefined' ? scaleFormulas[scaleType] : null;
        const maxPos = mods ? Object.keys(mods).length : (formula ? formula.length : 5);

        const startPosSelect = document.getElementById("fret-all-start-pos");
        const startPos = startPosSelect ? parseInt(startPosSelect.value) || 1 : 1;

        let chainDots = [];
        let direction = "asc"; // Départ standard montant

        let i = 0;
        const totalFretsOnNeck = fretboardState.fretsCount;

        while (true) {
            // Pos standard (1 à 5)
            const currentPos = ((startPos - 1 + i) % maxPos) + 1;
            // Octave (0 pour 1ère octave, 12 pour 2ème...)
            const octaveOffset = Math.floor((startPos - 1 + i) / maxPos) * 12;

            const range = getPositionFretRange(keyNode, scaleType, currentPos, tuning);
            if (!range) break;

            // Appliquer le décalage d'octave
            const absStart = range.start + octaveOffset;
            const currentPosRange = {
                start: absStart,
                span: range.span
            };

            // Sortir si la boîte déborde de la fin du manche
            const absEnd = absStart + range.span;
            if (absEnd > totalFretsOnNeck) {
                break; 
            }

            let posDots = dots.filter(d => {
                const fret = parseInt(d.dataset.fret);
                return isNoteInPosition(fret, fret === 0, currentPosRange, octaveMode, true);
            });

            // S'assurer que les notes récupérées sont bien sur le manche disponible
            posDots = posDots.filter(d => parseInt(d.dataset.fret) <= totalFretsOnNeck);

            if (posDots.length > 0) {
                // Tri par pitch (Corde Grave -> Aiguë)
                posDots.sort((a, b) => {
                    const strA = parseInt(a.dataset.string);
                    const strB = parseInt(b.dataset.string);
                    const fretA = parseInt(a.dataset.fret);
                    const fretB = parseInt(b.dataset.fret);
                    if (strA !== strB) return strB - strA;
                    return fretA - fretB;
                });

                if (direction === "desc") {
                    posDots.reverse();
                }

                chainDots = chainDots.concat(posDots);

                // Alterner la direction
                direction = (direction === "asc") ? "desc" : "asc";
            }
            
            i++;
            if (i > 15) break; 
        }
        activeDots = chainDots;
    } else {
        activeDots = dots.filter(d => d.style.opacity === "1");
    }

    // 1. BASE SORT: Ascending Pitch (uniquement si une seule position sélectionnée)
    if (activePosition !== "all") {
        activeDots.sort((a, b) => {
            const strA = parseInt(a.dataset.string);
            const strB = parseInt(b.dataset.string);
            const fretA = parseInt(a.dataset.fret);
            const fretB = parseInt(b.dataset.fret);

            if (strA !== strB) {
                return strB - strA; // Low string (index 5) to High string (index 0)
            }
            return fretA - fretB;
        });
    }

    if (exercise === "desc") {
        activeDots.reverse();
    } else if (exercise === "loop") {
        const asc = [...activeDots];
        const desc = [...activeDots].reverse().slice(1, -1);
        activeDots = asc.concat(desc);
    } else if (exercise === "third") {
        let sequence = [];
        for (let i = 0; i < activeDots.length - 2; i++) {
            sequence.push(activeDots[i]);
            sequence.push(activeDots[i + 2]);
        }
        activeDots = sequence;
    } else if (exercise === "group3") {
        let sequence = [];
        for (let i = 0; i < activeDots.length - 2; i++) {
            sequence.push(activeDots[i]);
            sequence.push(activeDots[i + 1]);
            sequence.push(activeDots[i + 2]);
        }
        activeDots = sequence;
    } else if (exercise === "group4") {
        let sequence = [];
        for (let i = 0; i < activeDots.length - 3; i++) {
            sequence.push(activeDots[i]);
            sequence.push(activeDots[i + 1]);
            sequence.push(activeDots[i + 2]);
            sequence.push(activeDots[i + 3]);
        }
        activeDots = sequence;
    } else if (exercise === "zigzag") {
        // Group by blocks of 4 frets
        let groups = {};
        activeDots.forEach(dot => {
            const fret = parseInt(dot.dataset.fret);
            const groupIndex = Math.floor(fret / 4);
            if (!groups[groupIndex]) groups[groupIndex] = [];
            groups[groupIndex].push(dot);
        });

        let ordered = [];
        const sortedGroups = Object.keys(groups).sort((a,b) => a-b);
        sortedGroups.forEach((key, index) => {
            let grpDots = groups[key];
            grpDots.sort((a,b) => {
                const strA = parseInt(a.dataset.string);
                const strB = parseInt(b.dataset.string);
                const fretA = parseInt(a.dataset.fret);
                const fretB = parseInt(b.dataset.fret);
                if (strA !== strB) return strB - strA;
                return fretA - fretB;
            });
            if (index % 2 === 1) {
                grpDots.reverse();
            }
            ordered = ordered.concat(grpDots);
        });
        activeDots = ordered;
    }

    fretboardExerciseNotes = activeDots;
    currentExerciseIndex = -1;
}

function highlightNextNote() {
    if (!fretboardTrainerActive || fretboardExerciseNotes.length === 0) return;

    clearNoteHighlights();
    currentExerciseIndex = (currentExerciseIndex + 1) % fretboardExerciseNotes.length;
    const activeDot = fretboardExerciseNotes[currentExerciseIndex];

    if (activeDot) {
        activeDot.style.background = "var(--success)";
        activeDot.style.boxShadow = "0 0 10px 4px var(--success)";
        activeDot.style.transform = activeDot.style.transform + " scale(1.3)";
        activeDot.style.zIndex = "100";
    }
}

function clearNoteHighlights() {
    if (fretboardExerciseNotes) {
        fretboardExerciseNotes.forEach(dot => {
            if (dot.dataset.origBg) {
                dot.style.background = dot.dataset.origBg;
                dot.style.boxShadow = "0 2px 4px rgba(0,0,0,0.5)";
                dot.style.transform = dot.dataset.origTransform || "none";
                dot.style.zIndex = dot.dataset.origZ || "20";
            }
        });
    }
}

function fretboardTogglePlay() {
    if (!window.metronome) return;
    const isPlaying = window.metronome.toggle();
    const btn = document.getElementById("fret-train-play");
    if (!btn) return;

    if (isPlaying) {
        btn.innerHTML = '<i class="ph ph-stop-circle" style="color:#cf6679;"></i>';
        if (fretboardTrainerActive) {
            generateExerciseNotes();
        }
    } else {
        btn.innerHTML = '<i class="ph ph-play-circle"></i>';
        clearNoteHighlights();
    }
}

// Chain metronome callback
document.addEventListener("DOMContentLoaded", () => {
    // Charger le volume sauvegardé
    const savedVol = localStorage.getItem('metronome_volume');
    if (savedVol !== null) {
        if (window.metronome) {
            window.metronome.setVolume(savedVol / 100);
        }
        // Attendre que le DOM soit complètement câblé pour mettre à jour les éléments graphiques
        setTimeout(() => {
            const fSlider = document.getElementById("fretboard-metro-volume");
            const mSlider = document.getElementById("metro-volume");
            const fLabel = document.getElementById("fretboard-metro-vol-label");
            const mLabel = document.getElementById("metro-vol-label");
            
            if (fSlider) fSlider.value = savedVol;
            if (mSlider) mSlider.value = savedVol;
            if (fLabel) fLabel.innerText = savedVol + "%";
            if (mLabel) mLabel.innerText = savedVol + "%";
        }, 150);
    }

    if (window.metronome) {
        window.metronome.onCountInVisual = (number) => {
            if (typeof triggerCueHud === 'function') triggerCueHud(number);
        };

        const originalOnBeat = window.metronome.onBeat;
        window.metronome.onBeat = (currentBeat) => {
            if (originalOnBeat) originalOnBeat(currentBeat);
            if (fretboardTrainerActive) {
                highlightNextNote();
            }
        };
    }
});

function updateMetronomeVolume(val) {
    const volume = val / 100;
    if (window.metronome) {
        window.metronome.setVolume(volume);
    }
    
    // Sauvegarder dans localStorage
    localStorage.setItem('metronome_volume', val);
    
    // Synchroniser la vue Fretboard
    const fLabel = document.getElementById("fretboard-metro-vol-label");
    if (fLabel) fLabel.innerText = val + "%";
    const fSlider = document.getElementById("fretboard-metro-volume");
    if (fSlider && fSlider.value != val) fSlider.value = val;

    // Synchroniser la vue Modale Métronome
    const mLabel = document.getElementById("metro-vol-label");
    if (mLabel) mLabel.innerText = val + "%";
    const mSlider = document.getElementById("metro-volume");
    if (mSlider && mSlider.value != val) mSlider.value = val;
}

function toggleCountInOptions(checked) {
    if (window.metronome) {
        window.metronome.isCountInActive = checked;
    }
    const nodes = {
        mOptions: document.getElementById('metro-count-in-options'),
        fOptions: document.getElementById('fret-count-in-options'),
        mActive: document.getElementById('metro-count-in-active'),
        fActive: document.getElementById('fret-count-in-active')
    };

    if (nodes.mOptions) nodes.mOptions.style.display = checked ? 'flex' : 'none';
    if (nodes.fOptions) nodes.fOptions.style.display = checked ? 'flex' : 'none';
    if (nodes.mActive && nodes.mActive.checked !== checked) nodes.mActive.checked = checked;
    if (nodes.fActive && nodes.fActive.checked !== checked) nodes.fActive.checked = checked;
}

function syncCountInSubOptions(property, value) {
    if (window.metronome) {
        window.metronome[property] = value;
    }
    
    setTimeout(() => {
        // Sound Checkboxes
        const mSound = document.getElementById("metro-count-in-sound");
        const fSound = document.getElementById("fret-count-in-sound");
        if (mSound) mSound.checked = window.metronome.countInSound;
        if (fSound) fSound.checked = window.metronome.countInSound;

        // Visual Checkboxes
        const mVisual = document.getElementById("metro-count-in-visual");
        const fVisual = document.getElementById("fret-count-in-visual");
        if (mVisual) mVisual.checked = window.metronome.countInVisual;
        if (fVisual) fVisual.checked = window.metronome.countInVisual;

        // Measures Selects
        const mMeas = document.getElementById("metro-count-in-measures");
        const fMeas = document.getElementById("fret-count-in-measures");
        if (mMeas) mMeas.value = window.metronome.countInMeasures;
        if (fMeas) fMeas.value = window.metronome.countInMeasures;
    }, 10);
}
