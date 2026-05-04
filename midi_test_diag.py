import mido
import time
import sys

def test_midi():
    print("--- Diagnostic MIDI Airstep Studio ---")
    
    try:
        # 1. Lister les ports de sortie disponibles
        outputs = mido.get_output_names()
        print(f"\nPorts de sortie detectes :")
        for i, name in enumerate(outputs):
            print(f" [{i}] {name}")
        
        if not outputs:
            print("ERREUR : Aucun port MIDI de sortie detecte !")
            return

        # 2. Chercher le Tone Master Pro
        target_port = None
        for name in outputs:
            if "Tone Master Pro" in name or "TMP" in name or "USB MIDI" in name:
                target_port = name
                break
        
        if not target_port:
            print("\nCible 'Tone Master Pro' non trouvee par nom.")
            print("Veuillez choisir un index dans la liste ci-dessus ou verifiez le branchement.")
            if len(outputs) > 0:
                target_port = outputs[0]
                print(f"Essai par defaut sur : {target_port}")
        else:
            print(f"\nCible trouvee : {target_port}")

        # 3. Tentative d'envoi
        print(f"\n--- TENTATIVE D'ENVOI SUR : {target_port} ---")
        with mido.open_output(target_port) as outport:
            # Test 1: Switch 5 ON
            print("1. Envoi CC:25 (Switch 5) VAL:127 sur Canal 1...")
            msg = mido.Message('control_change', control=25, value=127, channel=0)
            outport.send(msg)
            
            time.sleep(1)
            
            # Test 2: Preset 1
            print("2. Envoi Program Change (Preset 1) sur Canal 1...")
            msg_pc = mido.Message('program_change', program=0, channel=0)
            outport.send(msg_pc)
            
            print("\nMessages envoyes ! Verifiez votre Tone Master Pro.")
            print("Si rien ne se passe :")
            print(" - Verifiez que le canal de reception du TMP est bien sur 1 ou OMNI.")
            print(" - Verifiez que 'Receive MIDI PC' et 'CC' sont sur ON dans le TMP.")
            print(" - Fermez toute autre application MIDI (Fender Control, DAW, etc.)")

    except Exception as e:
        print(f"\nERREUR CRITIQUE : {e}")

if __name__ == "__main__":
    test_midi()
