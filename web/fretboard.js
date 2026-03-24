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
    window.fretboardVisible = fretboardState.visible; // Pour metronome.js
    fb.style.display = fretboardState.visible ? "block" : "none";

    if (fretboardState.visible) {
        // --- EXCLUSIVITE ---
        // Fermer le Dock Metronome s'il est ouvert
        const metroOverlay = document.getElementById("metronome-overlay");
        if (metroOverlay && metroOverlay.style.display !== "none") {
            if (typeof toggleMetronomeUI === 'function') toggleMetronomeUI();
        }

        // Auto-detect currently playing item's key/scale if we just opened it
        detectCurrentScale();
        renderFretboard();
    } else {
        // --- DE-ACTIVATION ---
        // Désactiver le trainer si on ferme la grille pour éviter les clics fantômes
        const fretboardEnableCheck = document.getElementById("fret-train-enable");
        if (fretboardEnableCheck && fretboardEnableCheck.checked) {
             fretboardEnableCheck.checked = false;
             if (typeof toggleFretboardTrainer === 'function') toggleFretboardTrainer(false);
        }
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
    let anchorStringNote = currentTuning[0]; // Par défaut, la corde la plus grave

    // --- CORRECTION ALTERNATE TUNINGS & EXTENDED RANGE ---
    // Les positions CAGED/Penta sont physiquement ancrées sur l'accordage standard (intervalles fixes).
    // Drop D : la corde grave est détunée, mais les 5 autres sont standards, la boîte ne doit pas bouger.
    // Basse 5C / Guitare 7C : La corde grave (B) est une extension. L'ancrage structurel reste le Mi (E).
    if (tuning === "drop_d" || tuning === "bass_5" || tuning === "guitar_7") {
        anchorStringNote = "E";
    }

    // Find the first fret of the root note on the structural anchor string
    let rootFretOnE = -1;
    for (let f = 0; f < 12; f++) {
        if (getNoteAtFret(anchorStringNote, f) === rootNote) {
            rootFretOnE = f;
            break;
        }
    }

    // Calculate the fret of the target note for the requested position on the lowest string
    // The positions start from the root note.
    const intervalFromRoot = formula[posIndex];
    let posStartFret = (rootFretOnE + intervalFromRoot);

    // --- AJUSTEMENT DES BOÎTES (Canonical Shapes) ---
    let offset = 0;
    let span = 5; // Valeur par défaut pour Diatoniques (3 Notes Per String)

    if (typeof positionModifiers !== 'undefined') {
        const mods = positionModifiers[scaleType];
        if (mods && mods[posIndex]) {
            offset = mods[posIndex].offset;
            span = mods[posIndex].span;
        } else if (scaleType.includes("pentatonic")) {
            // Sécurité fallback pour pentatoniques
            span = 4;
        }
    }

    // Appliquer le décalage (garde la valeur absolue sur le manche)
    let finalStartFret = posStartFret + offset;
    if (finalStartFret < 0 && finalStartFret > -10) finalStartFret += 12; // Gérer offsets négatifs d'ancrage

    return {
        start: finalStartFret,
        span: span,
        rootAnchor: posStartFret
    };
}

function isNoteInPosition(fretNum, isNut, posRange, octaveMode = "all", strictAbsolute = false) {
    // Slicer Universel : les octaves opèrent comme DEUX manches physiquement distincts.
    // Frette 12 agit comme une frontière dure (le sillet de la deuxième octave).
    if (octaveMode === "low" && fretNum > 12) return false;
    if (octaveMode === "high" && fretNum < 12) return false;

    if (!posRange) return true;
    
    const baseStart = posRange.start;
    const baseEnd = posRange.start + posRange.span;

    const totalFretsOnNeck = typeof fretboardState !== 'undefined' ? fretboardState.fretsCount : 12;

    if (strictAbsolute) {
        if (isNut && baseStart <= 0 && baseEnd >= 0) return true;
        return (fretNum >= baseStart && fretNum <= baseEnd);
    }

    // Affichage standard : on allume la boîte et toutes ses répétitions aux octaves (-2 à +3)
    if (isNut) {
        for (let k = -2; k <= 3; k++) {
            let octaveStart = baseStart + (k * 12);
            let octaveEnd = baseEnd + (k * 12);
            let octaveAnchor = posRange.rootAnchor + (k * 12);
            
            if (octaveMode === "low" && octaveAnchor >= 12) continue;
            if (octaveMode === "high" && octaveAnchor < 12) continue;

            if (octaveStart >= 0 && octaveEnd <= totalFretsOnNeck) {
                if (0 >= octaveStart && 0 <= octaveEnd) return true;
            }
        }
        return false;
    }

    for (let k = -2; k <= 3; k++) {
        let octaveStart = baseStart + (k * 12);
        let octaveEnd = baseEnd + (k * 12);
        let octaveAnchor = posRange.rootAnchor + (k * 12);
        
        if (octaveMode === "low" && octaveAnchor >= 12) continue;
        if (octaveMode === "high" && octaveAnchor < 12) continue;

        if (octaveStart >= 0 && octaveEnd <= totalFretsOnNeck) {
            if (fretNum >= octaveStart && fretNum <= octaveEnd) {
                 return true;
            }
        }
    }
    
    return false;
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

    const octaveSelect = document.getElementById("fretboard-octave");
    const octaveMode = octaveSelect ? octaveSelect.value : "all";

    // Si "All Positions", on calcule la carte exacte des boîtes valides asymétriques
    // pour garantir que l'affichage visuel correspond à 100% des notes jouées par l'exercice sans déborder.
    let globalValidBoxes = null;
    if (activePosition === "all") {
        globalValidBoxes = [];
        const scaleType = fretboardState.scale;
        const tuning = fretboardState.tuning;
        const keyNode = fretboardState.key;
        
        const mods = typeof positionModifiers !== 'undefined' ? positionModifiers[scaleType] : null;
        const formula = typeof scaleFormulas !== 'undefined' ? scaleFormulas[scaleType] : null;
        const maxPos = mods ? Object.keys(mods).length : (formula ? formula.length : 5);
        
        for (let k = -1; k <= 2; k++) {
            for (let p = 1; p <= maxPos; p++) {
                const range = getPositionFretRange(keyNode, scaleType, p, tuning);
                if (!range) continue;
                
                const absStart = range.start + k * 12;
                const absEnd = absStart + range.span;
                const absAnchor = range.rootAnchor + k * 12;

                // Règle de Symétrie Absolue :
                // Une boîte DOIT tenir entièrement sur le bois de l'instrument.
                // Si elle nécessite une frette -1, elle est incomplète et injouable formellement.
                // Si elle dépasse 22/24, elle est incomplète et injouable.
                if (absStart >= 0 && absEnd <= fretboardState.fretsCount) {
                     if (octaveMode === "low" && absAnchor >= 12) continue;
                     if (octaveMode === "high" && absAnchor < 12) continue;

                     globalValidBoxes.push({ start: absStart, end: absEnd });
                }
            }
        }
    }

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
            
            let inPosition = false;
            if (activePosition === "all" && globalValidBoxes) {
                // Étape 1 : S'assurer que la note relève d'une boîte physique complète (asymétrie fin de manche)
                for (let i = 0; i < globalValidBoxes.length; i++) {
                    const box = globalValidBoxes[i];
                    if (isNut && box.start <= 0 && box.end >= 0) {
                        inPosition = true; break;
                    }
                    if (fretNum >= box.start && fretNum <= box.end) {
                        inPosition = true; break;
                    }
                }
                // Étape 2 : SLICER Sillet Virtuel (Coupe aveugle aux confins des 12 frettes)
                if (octaveMode === "low" && fretNum > 12) inPosition = false;
                if (octaveMode === "high" && fretNum < 12) inPosition = false;
            } else {
                inPosition = isNoteInPosition(fretNum, isNut, posRange, octaveMode, false);
            }

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
            if (!inPosition) {
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

// --- SYNTHESIZER FOR NOTE PLAYBACK ---
const instrumentBaseMidi = {
    "guitar_6": [64, 59, 55, 50, 45, 40], // High E to Low E
    "guitar_7": [64, 59, 55, 50, 45, 40, 35], // + Low B
    "bass_4": [43, 38, 33, 28], // G2, D2, A1, E1
    "bass_5": [43, 38, 33, 28, 23] // + Low B
};

function getMidiNote(stringIndex, fretNum) {
    const inst = fretboardState.instrument;
    const basePitches = instrumentBaseMidi[inst] || instrumentBaseMidi["guitar_6"];
    
    if (stringIndex >= basePitches.length) return null;
    
    const openMidi = basePitches[stringIndex];
    
    // Adjust for current tuning if not standard
    const currentPreset = tuningPresets[fretboardState.tuning] || tuningPresets["standard"];
    const standardPreset = tuningPresets[instruments[inst].tunings[0]]; // First is standard
    
    if (!currentPreset || !standardPreset) return openMidi + fretNum;
    
    const currentReversed = [...currentPreset].reverse();
    const standardReversed = [...standardPreset].reverse();
    
    const currentNoteName = currentReversed[stringIndex];
    const standardNoteName = standardReversed[stringIndex];
    
    if (!currentNoteName || !standardNoteName) return openMidi + fretNum;
    
    // Parse Note Names (remove minor 'm' alias if any)
    const cleanCurrent = currentNoteName.replace("m", "");
    const cleanStandard = standardNoteName.replace("m", "");
    
    const currentIndex = baseNotes.indexOf(cleanCurrent);
    const standardIndex = baseNotes.indexOf(cleanStandard);
    
    if (currentIndex === -1 || standardIndex === -1) return openMidi + fretNum;
    
    let interval = currentIndex - standardIndex;
    if (interval > 6) interval -= 12;
    if (interval < -6) interval += 12;
    
    return openMidi + interval + fretNum;
}

function playNotePitch(dot) {
    if (!dot) return;
    const stringIndex = parseInt(dot.dataset.string);
    const fretNum = parseInt(dot.dataset.fret);
    
    const midiNote = getMidiNote(stringIndex, fretNum);
    if (!midiNote) return;
    
    const freq = 440 * Math.pow(2, (midiNote - 69) / 12);
    
    if (!window.metronome || !window.metronome.audioContext) return;
    const ctx = window.metronome.audioContext;
    
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    
    osc.connect(env);
    env.connect(window.metronome.masterGainNode || ctx.destination);
    
    osc.type = 'triangle'; 
    osc.frequency.value = freq;
    
    const now = ctx.currentTime;
    // Volume control from UI (fallback to 0.5)
    const savedVol = localStorage.getItem('fretboard_note_volume');
    const noteVolume = savedVol !== null ? parseFloat(savedVol) : 0.5;
    
    env.gain.setValueAtTime(0, now);
    env.gain.linearRampToValueAtTime(noteVolume, now + 0.005);
    env.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
    
    osc.start(now);
    osc.stop(now + 0.3);
}

let fretboardTrainerActive = false;
let fretboardExerciseNotes = [];
let currentExerciseIndex = -1;

function toggleFretTrainer() {
    const body = document.getElementById("fret-trainer-body");
    const icon = document.getElementById("fret-trainer-toggle-icon");
    if (!body || !icon) return;
    
    if (body.style.display === "none" || body.style.display === "") {
        body.style.display = "flex";
        if (icon) icon.className = "ph ph-caret-down";
        
        // Auto-activer si non coché
        const enableCheck = document.getElementById("fret-train-enable");
        if (enableCheck && !enableCheck.checked) {
            enableCheck.checked = true;
            if (typeof toggleFretboardTrainer === 'function') {
                toggleFretboardTrainer(true);
            }
        }
    } else {
        body.style.display = "none";
        if (icon) icon.className = "ph ph-caret-right";
    }
}

/* --- Training Controls Helpers --- */

function fretboardRestart() {
    currentExerciseIndex = -1;
    clearNoteHighlights();
    if (typeof generateExerciseNotes === 'function') generateExerciseNotes();
}

function fretboardNavPosition(direction) {
    const selector = document.getElementById("fretboard-position");
    if (!selector) return;
    
    const count = selector.options.length;
    let nextIndex = selector.selectedIndex + direction;
    
    if (nextIndex < 0) nextIndex = count - 1;
    if (nextIndex >= count) nextIndex = 0;
    
    selector.selectedIndex = nextIndex;
    selector.dispatchEvent(new Event('change'));
    
    if (typeof generateExerciseNotes === 'function') generateExerciseNotes();
}

function syncFretboardTrainer() {
    if (!window.metronome) return;
    
    // Si la gille de gammes n'est pas ouverte, on n'altère pas le métronome standard
    if (typeof fretboardState !== 'undefined' && !fretboardState.visible) return;
    
    // Valeur par défaut 'fixed'
    const mode = document.getElementById("fret-train-mode") ? document.getElementById("fret-train-mode").value : 'fixed';
    
    // L'accélération automatique ne s'applique que si le trainer est ACTIF
    window.metronome.isTraining = (mode === 'accel' && fretboardTrainerActive);
    
    const startBpm = parseInt(document.getElementById("fret-train-start") ? document.getElementById("fret-train-start").value : 60) || 60;
    
    // En mode fixe ou manuel, appliquer le BPM en direct
    if (mode === 'fixed' || mode === 'manual') {
        window.metronome.setBpm(startBpm);
        
        // Mettre à jour l'affichage direct
        const display = document.getElementById("fret-train-bpm-display");
        if (display) {
            display.innerText = `(BPM: ${startBpm})`;
        }
    }
    
    window.metronome.trainTargetBPM = parseInt(document.getElementById("fret-train-target") ? document.getElementById("fret-train-target").value : 160) || 160;
    window.metronome.trainIncrement = parseInt(document.getElementById("fret-train-inc") ? document.getElementById("fret-train-inc").value : 5) || 5;
    window.metronome.trainMeasures = parseInt(document.getElementById("fret-train-meas") ? document.getElementById("fret-train-meas").value : 4) || 4;
    window.metronome.trainTrigger = document.getElementById("fret-train-trigger") ? document.getElementById("fret-train-trigger").value : 'measures';
    
    window.metronome.isMetronomeSoundActive = document.getElementById("fret-train-metro-sound") ? document.getElementById("fret-train-metro-sound").checked : true;

    // --- Sauvegarde localStorage ---
    localStorage.setItem('fretboard_train_mode', mode);
    localStorage.setItem('fretboard_train_start_bpm', startBpm);
    localStorage.setItem('fretboard_train_target', window.metronome.trainTargetBPM);
    localStorage.setItem('fretboard_train_inc', window.metronome.trainIncrement);
    localStorage.setItem('fretboard_train_meas', window.metronome.trainMeasures);
    localStorage.setItem('fretboard_train_trigger', window.metronome.trainTrigger);

    // Griser les champs inutiles
    const incField = document.getElementById("fret-train-inc");
    const targetField = document.getElementById("fret-train-target");
    const measField = document.getElementById("fret-train-meas");
    const triggerField = document.getElementById("fret-train-trigger");

    const setFieldDisabled = (el, disabled) => {
        if (!el) return;
        el.disabled = disabled;
        el.style.opacity = disabled ? '0.35' : '1';
        el.style.cursor = disabled ? 'not-allowed' : 'auto';
    };

    if (mode === 'fixed') {
        setFieldDisabled(incField, true);
        setFieldDisabled(targetField, true);
        setFieldDisabled(measField, true);
        setFieldDisabled(triggerField, true);
    } else if (mode === 'manual') {
        setFieldDisabled(incField, false); // Nécessaire pour le pas d'incrément +/-
        setFieldDisabled(targetField, true);
        setFieldDisabled(measField, true);
        setFieldDisabled(triggerField, true);
    } else { // accel
        setFieldDisabled(incField, false);
        setFieldDisabled(targetField, false);
        setFieldDisabled(measField, false);
        setFieldDisabled(triggerField, false);
    }
}

function adjustFretBpm(direction) {
    const input = document.getElementById("fret-train-start");
    const incInput = document.getElementById("fret-train-inc");
    if (!input) return;
    
    let bpm = parseInt(input.value) || 60;
    const step = incInput ? (parseInt(incInput.value) || 5) : 5;
    
    bpm += direction * step;
    bpm = Math.max(30, Math.min(300, bpm)); // Clamp
    
    input.value = bpm;
    syncFretboardTrainer();
}

function toggleFretboardTrainer(enabled) {
    fretboardTrainerActive = enabled;
    window.fretboardTrainerActive = enabled; // Pour l'accès global dans metronome.js
    
    if (window.metronome) {
        if (enabled) {
            // --- EXCLUSIVITE ---
            // 1. Stopper le Métronome Classique s'il tourne
            if (window.metronome.isPlaying) {
                if (typeof metronomeTogglePlay === 'function') metronomeTogglePlay();
            }
            // 2. Fermer le Dock Métronome s'il est ouvert
            const metroOverlay = document.getElementById("metronome-overlay");
            if (metroOverlay && metroOverlay.style.display !== "none") {
                if (typeof toggleMetronomeUI === 'function') toggleMetronomeUI();
            }

            const startBpm = parseInt(document.getElementById("fret-train-start") ? document.getElementById("fret-train-start").value : 60) || 60;
            window.metronome.setBpm(startBpm); // Appliquer le BPM de départ
            
            syncFretboardTrainer(); // Appliquer le reste de la config
            
            const display = document.getElementById("fret-train-bpm-display");
            if (display) {
                display.innerText = `(BPM: ${startBpm})`;
                display.style.display = "inline";
            }
            
            generateExerciseNotes();
        } else {
            window.metronome.isTraining = false;
            
            const display = document.getElementById("fret-train-bpm-display");
            if (display) display.style.display = "none";
            
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

        let validBoxes = [];
        
        // 1. Collecter toutes les boîtes qui rentrent sur le manche
        for (let k = -1; k <= 2; k++) {
            for (let p = 1; p <= maxPos; p++) {
                const range = getPositionFretRange(keyNode, scaleType, p, tuning);
                if (!range) continue;

                const absStart = range.start + k * 12;
                const absEnd = absStart + range.span;
                const absAnchor = range.rootAnchor + k * 12;

                // L'exercice récupère toutes les boîtes jouables complètes
                if (octaveMode === "low" && absAnchor >= 12) continue;
                if (octaveMode === "high" && absAnchor < 12) continue;

                // Règle de Symétrie Absolue (Dogme de l'intégrité de position) :
                // La boîte doit commencer à 0 ou plus (pas de frettes négatives tolérées).
                // La boîte doit s'arrêter avant la fin du manche.
                if (absStart >= 0 && absEnd <= totalFretsOnNeck) {
                     validBoxes.push({
                          pos: p,
                          start: absStart,
                          span: range.span,
                          octaveOffset: k * 12
                     });
                }
            }
        }

        // 2. Trier par position de départ (Gauche vers la Droite)
        validBoxes.sort((a, b) => a.start - b.start);

        // 3. Trouver l'index de départ selon le choix utilisateur (première boîte qui matche la pos)
        let startIndex = validBoxes.findIndex(box => box.pos === startPos);
        if (startIndex === -1) startIndex = 0;

        chainDots = [];
        direction = "asc"; // Départ montant

        // 4. Parcourir les boîtes triées (en boucle)
        for (let i = 0; i < validBoxes.length; i++) {
            const box = validBoxes[(startIndex + i) % validBoxes.length];
            
            const currentPosRange = {
                start: box.start,
                span: box.span
            };

            let posDots = dots.filter(d => {
                const fret = parseInt(d.dataset.fret);
                return isNoteInPosition(fret, fret === 0, currentPosRange, octaveMode, true);
            });

            if (posDots.length > 0) {
                // Tri Pitch (Corde Grave -> Aiguë)
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

                // Alterner direction pour le flux continu (Zig-Zag)
                direction = (direction === "asc") ? "desc" : "asc";
            }
        }
        activeDots = chainDots;
    } else {
        activeDots = dots.filter(d => d.style.opacity === "1");
    }

    // 1. BASE SORT: Ascending Pitch
    // Si Single Position, il arrive que 2 octaves partagent le manche (Pos 1 basse et Pos 1 haute).
    // On doit trier par BLOC D'OCTAVE d'abord, pour éviter les aller-retours incessants 21 -> 1.
    if (activePosition !== "all") {
        activeDots.sort((a, b) => {
            const fretA = parseInt(a.dataset.fret);
            const fretB = parseInt(b.dataset.fret);
            
            // Regrouper en tranches de 12 frettes pour les octaves
            const blockA = Math.floor(fretA / 12);
            const blockB = Math.floor(fretB / 12);

            if (blockA !== blockB) {
                return blockA - blockB; // Jouer l'octave basse totalement, PUIS l'octave haute
            }

            // Dans la même octave de boîte, tri par Pitch (Corde -> Frette)
            const strA = parseInt(a.dataset.string);
            const strB = parseInt(b.dataset.string);
            
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

    if (currentExerciseIndex >= fretboardExerciseNotes.length - 1) {
        // --- FIN DE CYCLE ---
        if (window.metronome && window.metronome.isTraining && window.metronome.trainTrigger === 'cycle') {
             window.metronome.incrementTempo();
        }

        if (window.metronome && window.metronome.isCountInActive) {
            window.metronome.isCountingIn = true;
            window.metronome.countInBeatsRemaining = window.metronome.countInMeasures * window.metronome.beatsPerMeasure;
            currentExerciseIndex = -1;
            clearNoteHighlights();
            return;
        }
    }

    clearNoteHighlights();
    currentExerciseIndex = (currentExerciseIndex + 1) % fretboardExerciseNotes.length;
    const activeDot = fretboardExerciseNotes[currentExerciseIndex];

    if (activeDot) {
        activeDot.style.background = "var(--success)";
        activeDot.style.boxShadow = "0 0 10px 4px var(--success)";
        activeDot.style.transform = activeDot.style.transform + " scale(1.3)";
        activeDot.style.zIndex = "100";
        
        // --- PLAY SOUND ---
        const soundEnabled = document.getElementById("fret-train-note-sound") ? document.getElementById("fret-train-note-sound").checked : true;
        if (soundEnabled) {
             playNotePitch(activeDot);
        }
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

// --- INITIALISATION UI (Sons des Notes & Sauvegarde) ---
function loadFretboardTrainerSettings() {
    const modeField = document.getElementById("fret-train-mode");
    if (!modeField) return; // Pas sur la bonne vue
    
    modeField.value = localStorage.getItem('fretboard_train_mode') || 'fixed';
    document.getElementById("fret-train-start").value = localStorage.getItem('fretboard_train_start_bpm') || '60';
    document.getElementById("fret-train-inc").value = localStorage.getItem('fretboard_train_inc') || '5';
    document.getElementById("fret-train-target").value = localStorage.getItem('fretboard_train_target') || '160';
    document.getElementById("fret-train-meas").value = localStorage.getItem('fretboard_train_meas') || '4';
    document.getElementById("fret-train-trigger").value = localStorage.getItem('fretboard_train_trigger') || 'measures';
    
    // Pour que le metronome prenne en compte le BPM restauré si le trainer est déjà actif
    syncFretboardTrainer();
}

document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
        const noteSoundCheck = document.getElementById("fret-train-note-sound");
        const noteVolSlider = document.getElementById("fret-train-note-vol");
        
        if (noteSoundCheck) {
            const savedSound = localStorage.getItem('fretboard_note_sound');
            if (savedSound !== null) {
                noteSoundCheck.checked = savedSound === 'true';
            }
        }
        
        if (noteVolSlider) {
            const savedVol = localStorage.getItem('fretboard_note_volume');
            if (savedVol !== null) {
                noteVolSlider.value = parseFloat(savedVol) * 100;
            }
        }

        // Restauration des réglages de l'exercice
        loadFretboardTrainerSettings();
    }, 100);
});
