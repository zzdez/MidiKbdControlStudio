import os
import shutil

base_path = r"x:\AirstepStudio\assets\drums"
kits = ["tr909", "tr505"]
source_kit = "tr808"

# 11 instruments list
instruments = ['kick', 'snare', 'hihat', 'openhat', 'tom1', 'tom2', 'tom3', 'clap', 'cymbal', 'cowbell', 'rim']

for kit in kits:
    kit_path = os.path.join(base_path, kit)
    if not os.path.exists(kit_path):
        print(f"Kit {kit} not found at {kit_path}")
        continue
        
    for inst in instruments:
        target_file = os.path.join(kit_path, f"{inst}.mp3")
        if not os.path.exists(target_file):
            # Try to copy from TR808
            source_file = os.path.join(base_path, source_kit, f"{inst}.mp3")
            if os.path.exists(source_file):
                print(f"Copying {source_file} to {target_file}")
                shutil.copy2(source_file, target_file)
            else:
                # Fallback to hihat if it's openhat/tom
                if inst == 'openhat':
                    fallback_source = os.path.join(kit_path, "hihat.mp3")
                    if os.path.exists(fallback_source):
                        print(f"Fallback: Copying {fallback_source} to {target_file}")
                        shutil.copy2(fallback_source, target_file)
                print(f"Warning: {inst}.mp3 missing and no source found for {kit}")

print("Verification:")
for kit in ["tr808", "tr909", "tr505"]:
    kit_path = os.path.join(base_path, kit)
    if os.path.exists(kit_path):
        files = os.listdir(kit_path)
        print(f"Kit {kit}: {len(files)} files found.")
