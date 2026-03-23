const fs = require('fs');
const path = require('path');

// Read fretboard.js manually or mock the relevant functions
const baseNotes = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const scaleFormulas = {
    major: [0, 2, 4, 5, 7, 9, 11],
    minor: [0, 2, 3, 5, 7, 8, 10],
    major_pentatonic: [0, 2, 4, 7, 9],
    minor_pentatonic: [0, 3, 5, 7, 10]
};

function getNoteIndex(note) {
    return baseNotes.indexOf(note);
}

function getScaleNotes(rootNote, scaleType) {
    const rootIndex = getNoteIndex(rootNote);
    const formula = scaleFormulas[scaleType];
    if (!formula) return [];
    return formula.map(interval => baseNotes[(rootIndex + interval) % 12]);
}

console.log("--- TEST SCALE NOTES ---");
console.log("B Minor Pentatonic:", getScaleNotes("B", "minor_pentatonic"));
console.log("B Major Pentatonic:", getScaleNotes("B", "major_pentatonic"));
