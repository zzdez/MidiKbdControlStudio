import json
import os
from typing import List, Optional
from pydantic import BaseModel
from google import genai
from google.genai import types

# Modèle pour les sous-titres
class SubtitleCue(BaseModel):
    id: str
    start_time: str
    end_time: str
    text: str
    settings: Optional[str] = ""

# Modèles pour la réponse structurée de Gemini
class TranslationItem(BaseModel):
    id: str
    translatedText: str

class TranslationResponse(BaseModel):
    translations: list[TranslationItem]

def translate_batch(
    cues: List[SubtitleCue],
    source_lang: str,
    target_lang: str,
    api_key: str,
    context: str = "",
    remove_duplicates: bool = True,
    remove_non_speech: bool = True
) -> List[SubtitleCue]:

    if not cues:
        return []

    client = genai.Client(api_key=api_key)

    # Préparation des données légères pour le prompt
    cue_text_list = [{"id": cue.id, "text": cue.text} for cue in cues]

    # --- CONSTRUCTION DU PROMPT (Identique à la version TypeScript) ---

    cleaning_instructions = ""
    if remove_non_speech:
        cleaning_instructions += "1. REMOVE NON-SPEECH TAGS: Delete all sound descriptions (e.g., '[Music]', '[Applause]', '(Silence)', '*gasps*').\n"

    if remove_duplicates:
        cleaning_instructions += "2. REMOVE REDUNDANCY: If a phrase is repeated exactly (stuttering) or constitutes a meaningless repetition, remove it.\n"

    if remove_non_speech or remove_duplicates:
        cleaning_instructions += "3. EMPTY CUES: If a cue becomes empty after cleaning, return an empty string \"\" for 'translatedText'.\n"

    prompt = f"""
    You are an expert professional subtitle translator and editor.
    Translate the following subtitle cues from {source_lang} to {target_lang}.

    {f'CONTEXT / DOMAIN: The content is about: "{context}". Use specific terminology.' if context else ''}

    {f'CLEANING RULES:\n{cleaning_instructions}' if cleaning_instructions else ''}

    TRANSLATION RULES:
    1. Maintain the original meaning and tone.
    2. Ensure the translation fits within standard subtitle reading speeds.
    3. Return the result strictly as a JSON object matching the requested schema.
    4. Ensure the 'id' in the response matches the 'id' provided in the input.

    Input Cues:
    {json.dumps(cue_text_list, indent=2)}
    """

    try:
        response = client.models.generate_content(
            model='gemini-2.5-flash',
            contents=prompt,
            config={
                'response_mime_type': 'application/json',
                'response_schema': TranslationResponse
            }
        )

        # Le SDK Python gère le parsing JSON automatiquement via Pydantic
        result = response.parsed

        # --- RECONSTRUCTION ---
        translated_cues = []
        # On crée un dictionnaire pour retrouver facilement la traduction par ID
        lookup = {t.id: t.translatedText for t in result.translations}

        for cue in cues:
            # On prend la traduction si elle existe, sinon on garde l'original (sécurité)
            new_text = lookup.get(cue.id, cue.text)

            # On crée une copie du cue avec le nouveau texte
            new_cue = cue.model_copy(update={"text": new_text})
            translated_cues.append(new_cue)

        return translated_cues

    except Exception as e:
        print(f"Erreur Gemini Batch: {e}")
        # En cas d'erreur, on renvoie le bloc original pour ne pas casser le fichier
        return cues

# --- PARSING VTT HELPER FUNCTIONS ---
import re

def parse_vtt(content: str) -> List[SubtitleCue]:
    lines = content.replace('\r\n', '\n').split('\n')
    cues = []
    current_cue = None
    buffer = []

    # Regex pour le timecode VTT: 00:00:00.000 --> 00:00:00.000
    time_pattern = re.compile(r'^((?:[0-9]{2}:)?[0-9]{2}:[0-9]{2}\.[0-9]{3})\s-->\s((?:[0-9]{2}:)?[0-9]{2}:[0-9]{2}\.[0-9]{3})(.*)$')

    is_header = True

    for i, line in enumerate(lines):
        line = line.strip()

        # Ignorer le header
        if is_header:
            if line == '' and i > 0: # Fin du header probable
                is_header = False
            continue

        match = time_pattern.match(line)

        if match:
            # Sauvegarder le cue précédent
            if current_cue and buffer:
                current_cue.text = '\n'.join(buffer).strip()
                cues.append(current_cue)

            buffer = []
            start, end, settings = match.groups()

            # Chercher l'ID sur la ligne d'avant
            prev_line = lines[i-1].strip() if i > 0 else ""
            cue_id = str(len(cues) + 1)
            if prev_line and "-->" not in prev_line and not is_header and prev_line != "":
                cue_id = prev_line

            current_cue = SubtitleCue(
                id=cue_id,
                start_time=start.replace(',', '.'), # Normaliser
                end_time=end.replace(',', '.'),
                text="",
                settings=settings.strip()
            )
        elif current_cue:
            if line:
                buffer.append(line)

    # Dernier cue
    if current_cue and buffer:
        current_cue.text = '\n'.join(buffer).strip()
        cues.append(current_cue)

    return cues

def generate_vtt(cues: List[SubtitleCue]) -> str:
    output = ["WEBVTT", ""]
    for cue in cues:
        if not cue.text.strip(): continue # Skip empty
        output.append(f"{cue.id}") # Optional in VTT but good for clarity
        output.append(f"{cue.start_time} --> {cue.end_time} {cue.settings}".strip())
        output.append(cue.text)
        output.append("")
    return "\n".join(output)
