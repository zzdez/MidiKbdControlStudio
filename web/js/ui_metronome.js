// LOGIQUE INTERFACE (UI) DU METRONOME
let metronomeDraggable = false;
let isSyncMedia = false; // "Sync Média" toggle state

function toggleMetronomeUI() {
    const dock = document.getElementById("metronome-overlay");
    if (!dock) return;
    
    if (dock.style.display === "none" || dock.style.display === "") {
        dock.style.display = "flex";
        
        // --- EXCLUSIVITE ---
        // Fermer le Fretboard s'il est ouvert
        if (typeof fretboardState !== 'undefined' && fretboardState.visible) {
            if (typeof toggleFretboard === 'function') toggleFretboard();
        }
        
        // Initialize Engine & Load sounds
        if (window.metronome) {
            window.metronome.init();
        }

        // Initialize dragging if not done yet
        if (!metronomeDraggable) {
            dragMetronomeElement(dock);
            metronomeDraggable = true;
        }
    } else {
        dock.style.display = "none";
    }
}

function metronomeTogglePlay() {
    const isPlaying = window.metronome.toggle();
    const btn = document.getElementById("btn-metro-play");
    const drumBtn = document.getElementById("btn-drum-play");

    if (isPlaying) {
        if (btn) btn.innerHTML = '<i class="ph ph-stop-circle ph-fill" style="color:#cf6679;"></i>';
        if (drumBtn) drumBtn.innerHTML = '<i class="ph ph-stop-circle ph-fill" style="color:#cf6679;"></i>';
        
        // --- EXCLUSIVITE ---
        // Décocher et Stopper le Fretboard Trainer s'il est actif
        const fretboardEnableCheck = document.getElementById("fret-train-enable");
        if (fretboardEnableCheck && fretboardEnableCheck.checked) {
            fretboardEnableCheck.checked = false;
            if (typeof toggleFretboardTrainer === 'function') {
                toggleFretboardTrainer(false);
            }
        }
    } else {
        if (btn) btn.innerHTML = '<i class="ph ph-play-circle ph-fill"></i>';
        if (drumBtn) drumBtn.innerHTML = '<i class="ph ph-play-circle ph-fill"></i>';
        resetBeatVisualizer();
    }
}

function metronomeSetBpm(value) {
    let bpm = parseInt(value);
    if (isNaN(bpm)) return;
    bpm = Math.max(30, Math.min(300, bpm));
    
    document.getElementById("metro-bpm-input").value = bpm;
    document.getElementById("metro-bpm-slider").value = bpm;
    
    window.metronome.setBpm(bpm);

    // If sync is enabled, should we alter the media speed? 
    // Usually it's Media Speed altering Metronome BPM, not the inverse.
}

function metronomeTap() {
    const newBpm = window.metronome.tap();
    if (newBpm) {
        document.getElementById("metro-bpm-input").value = newBpm;
        document.getElementById("metro-bpm-slider").value = newBpm;
    }
}

function metronomeSetSignature(val) {
    const beats = parseInt(val);
    window.metronome.setSignature(beats);
    
    // Update visualizer dots count
    const container = document.getElementById("metro-visualizer");
    container.innerHTML = "";
    for (let i = 0; i < beats; i++) {
        container.innerHTML += `<div class="metro-dot" id="metro-dot-${i}" style="width:12px; height:12px; border-radius:50%; background:#333;"></div>`;
    }
}

function metronomeToggleSync(enabled) {
    window.isSyncMedia = enabled;
    isSyncMedia = enabled;
    
    // Auto-fetch Global BPM if possible (from DOM elements setup by playTrack)
    if (enabled) {
        const globalBpmSpan = document.getElementById("global-video-bpm");
        if (globalBpmSpan && globalBpmSpan.style.display !== "none") {
            const bpmTxt = globalBpmSpan.querySelector(".val").innerText;
            const bpmNum = parseInt(bpmTxt);
            if (!isNaN(bpmNum)) {
                metronomeSetBpm(bpmNum);
            }
        }
        document.getElementById("metro-sync-options").style.display = "flex";
    } else {
        document.getElementById("metro-sync-options").style.display = "none";
    }
}

function metronomeSetOffset(val) {
    // Handled dynamically on play
}

function metronomeToggleTrainer(enabled) {
    window.metronome.isTraining = enabled;
    window.metronome.trainTargetBPM = parseInt(document.getElementById("metro-train-target").value) || 160;
    window.metronome.trainIncrement = parseInt(document.getElementById("metro-train-inc").value) || 5;
    window.metronome.trainMeasures = parseInt(document.getElementById("metro-train-meas").value) || 4;
}

function setMetronomeSubdivision(div) {
    if (window.metronome) {
        window.metronome.subdivision = div;
    }
    
    // Synchroniser l'état actif des boutons ".subdivision-btn" partout
    document.querySelectorAll(".subdivision-btn").forEach(btn => {
        const val = parseInt(btn.getAttribute("data-value"));
        if (val === div) {
            btn.style.background = "var(--accent)";
            btn.style.color = "#000";
            btn.style.borderColor = "var(--accent)";
            btn.style.fontWeight = "bold";
        } else {
            btn.style.background = "#222";
            btn.style.color = "#fff";
            btn.style.borderColor = "#444";
            btn.style.fontWeight = "normal";
        }
    });
}

// Attach UI Callbacks to Engine
window.metronome.onBeat = (currentBeat) => {
    // Light up correct dot
    const dots = document.querySelectorAll(".metro-dot");
    dots.forEach((dot, index) => {
        if (index === currentBeat) {
            dot.style.background = (index === 0) ? "var(--success)" : "var(--accent)";
            dot.style.transform = "scale(1.2)";
        } else {
            dot.style.background = "#333";
            dot.style.transform = "scale(1)";
        }
    });

    // Automatically remove highlight slightly after beat for snap 
    setTimeout(() => {
        if (!window.metronome.isPlaying) return;
        const dot = document.getElementById(`metro-dot-${currentBeat}`);
        if (dot) {
            // Keep it slightly colored if it's beat 0? No, just return to base or dim color
            dot.style.background = (currentBeat === 0) ? "#1a3a3a" : "#333";
            dot.style.transform = "scale(1)";
        }
    }, 150);
};

window.metronome.onTrainProgress = (newBpm) => {
    if (document.getElementById("metro-bpm-input")) document.getElementById("metro-bpm-input").value = newBpm;
    if (document.getElementById("metro-bpm-slider")) document.getElementById("metro-bpm-slider").value = newBpm;
    
    // Mettre à jour l'affichage dans le Fretboard Trainer
    const display = document.getElementById("fret-train-bpm-display");
    if (display) {
        display.innerText = `(BPM: ${newBpm})`;
        display.style.display = "inline";
    }
};

// Populate Sound List Callback
if (window.metronome) {
    window.metronome.onSoundsListLoaded = (soundsList) => {
        const selectMetro = document.getElementById("metro-sound-set");
        const selectFret = document.getElementById("fret-train-sound-set");
        
        const populate = (sel, current) => {
            if (!sel) return;
            sel.innerHTML = "";
            for (const setName in soundsList) {
                const option = document.createElement("option");
                option.value = setName;
                option.innerText = setName.charAt(0).toUpperCase() + setName.slice(1);
                if (setName === current) option.selected = true;
                sel.appendChild(option);
            }
        };

        populate(selectMetro, window.metronome.currentSoundSet);
        populate(selectFret, window.metronome.fretboardSoundSet || 'digital1');
    };
}

function resetBeatVisualizer() {
    document.querySelectorAll(".metro-dot").forEach(dot => {
        dot.style.background = "#333";
        dot.style.transform = "scale(1)";
    });
}

// Drag logic
function dragMetronomeElement(elmnt) {
    let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;
    if (document.getElementById("metronome-header")) {
        document.getElementById("metronome-header").onmousedown = dragMouseDown;
    } else {
        elmnt.onmousedown = dragMouseDown;
    }

    function dragMouseDown(e) {
        e = e || window.event;
        e.preventDefault();
        pos3 = e.clientX;
        pos4 = e.clientY;
        document.onmouseup = closeDragElement;
        document.onmousemove = elementDrag;
    }

    function elementDrag(e) {
        e = e || window.event;
        e.preventDefault();
        pos1 = pos3 - e.clientX;
        pos2 = pos4 - e.clientY;
        pos3 = e.clientX;
        pos4 = e.clientY;
        
        let newTop = elmnt.offsetTop - pos2;
        let newLeft = elmnt.offsetLeft - pos1;
        
        if (newTop < 0) newTop = 0;
        
        elmnt.style.top = newTop + "px";
        elmnt.style.left = newLeft + "px";
    }

    function closeDragElement() {
        document.onmouseup = null;
        document.onmousemove = null;
    }
}

// Initialiser au chargement pour peupler les listes de sons (Métronome et Fretboard)
document.addEventListener("DOMContentLoaded", () => {
    if (window.metronome) {
        window.metronome.init();
    }
});
