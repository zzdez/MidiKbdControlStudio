# Guide Complet de Synchronisation Cloud (V9.6.40)

Ce document détaille le fonctionnement, la configuration et l'utilisation du système de synchronisation multi-cloud d'**Airstep Studio**.

---

## 1. Concepts Fondamentaux

Le système de synchronisation d'Airstep Studio repose sur une architecture **hybride** capable de gérer aussi bien des fichiers binaires (EXE, Assets) que des données structurées (Bases JSON, Profils MIDI).

### Architecture Sidecar
Contrairement à d'autres systèmes, Airstep Studio utilise des fichiers **sidecars** (`.json`) pour chaque média. Le moteur de synchronisation analyse ces fichiers pour détecter les changements de métadonnées (BPM, Tonalité, Boucles) sans avoir à analyser l'intégralité des fichiers binaires massifs, optimisant ainsi les transferts.

### Suivi d'État (`sync_state.json`)
Pour garantir une sécurité maximale, le système mémorise l'état de votre bibliothèque locale après chaque synchronisation réussie. Cela permet de distinguer :
*   Un **nouveau fichier** sur le cloud (à télécharger).
*   Un **fichier supprimé localement** (à supprimer sur le cloud lors de la prochaine synchro).

### Intelligence de Partage (V9.6.40) ✨
La version 9.6.40 introduit une intelligence accrue pour protéger vos données :
*   **Validation Croisée (Trust-the-Cloud)** : Si un fichier est présent sur le Cloud mais que son flag de partage local est manquant (metadata incomplète), le système le considère automatiquement comme partagé. Cela élimine les faux-positifs de suppression.
*   **Héritage des Sidecars** : Les images de pochettes (`folder.jpg`, `.png`) et les sous-titres héritent désormais intelligemment du statut de partage de leur fichier maître, garantissant qu'une pochette suit toujours son morceau lors de la synchronisation.

---

## 2. Configuration

Accédez à l'onglet **Synchronisation** dans les réglages de l'application native.

### Types de Stockage (Providers)
1.  **SFTP** : Idéal pour les serveurs NAS (Synology, QNAP) ou les serveurs dédiés.
2.  **WebDAV** : Compatible avec Nextcloud, OwnCloud, ou les lecteurs réseau IIS.
3.  **Local** : Pour synchroniser avec un dossier géré par un service tiers (Dropbox, Google Drive, OneDrive).

### Catégories de Synchronisation
Vous pouvez choisir précisément ce que vous souhaitez partager :
*   **Exécutables** : Synchronise l'application elle-même (permet les mises à jour auto).
*   **Médias** : Vos fichiers Audio, Vidéo et Multipistes. Supporte MP3, MP4, WAV, AAC, M4A, FLAC, JPG, PNG, etc.
*   **Données** : La base de données de la bibliothèque et des liens web.
*   **Profils** : Vos configurations MIDI personnalisées.
*   **Définitions** : Les fichiers de configuration de vos pédaliers.
*   **Système** : Les langues et les assets visuels.

---

## 3. Modes de Synchronisation (Autorité)

Une nouveauté majeure est la gestion de l'**autorité de flux** :

*   **Bidirectionnel (Neutre)** : Propose toutes les actions. Les ajouts et modifications sont sélectionnés par défaut, les suppressions sont proposées mais décochées par défaut pour votre sécurité.
*   **Réception (Esclave / Pull Only)** : Seul le flux **Cloud ➔ PC** est actif. Les nouveaux fichiers du cloud sont téléchargés. Les fichiers manquants sur le cloud sont proposés à la suppression locale (décochés par défaut).
*   **Envoi (Maître / Push Only)** : Seul le flux **PC ➔ Cloud** est actif. Vos nouveaux fichiers locaux sont envoyés vers le cloud. Les fichiers manquants localement sont proposés à la suppression sur le cloud (décochés par défaut).

---

## 4. Workflow d'Utilisation (Cockpit Sécurisé)

Le processus se déroule en 3 étapes sécurisées :

### Étape 1 : Analyse
Cliquez sur **Analyser**. Le système scanne le cloud et votre machine locale. Le moteur utilise un cache éphémère pour comparer instantanément des milliers de fichiers sans ralentir votre connexion.

### Étape 2 : Cockpit de Validation
Une modale interactive s'ouvre. Elle affiche la liste exacte avec des indicateurs de direction clairs :
*   📥 **Cloud ➔ PC** : Fichiers arrivant du cloud.
*   📤 **PC ➔ Cloud** : Fichiers envoyés vers le cloud.
*   🗑️ **Cloud ❌** : Suppression sur le cloud.
*   🗑️ **PC ❌** : Suppression sur ce PC.

**Gestion de Masse** : Utilisez les cases à cocher **"Tout sélectionner"** en haut de chaque catégorie pour gagner du temps sur les gros volumes de fichiers.

---

## 5. Résolution de Problèmes (Troubleshooting)

*   **Recursion Depth Error** : Correction majeure en V9.6.40. Si vous aviez cette erreur lors du scan, elle est désormais résolue grâce au bouclier anti-récursion sur les fichiers JSON.
*   **Fichiers non détectés** : Assurez-vous d'avoir sélectionné les bonnes **Catégories** (Médias, Profils, etc.) avant de lancer l'analyse.
*   **Conflit de Casse (Casing)** : Le système normalise les noms de fichiers pour éviter les doublons causés par les différences entre Windows et Linux (ex: `image.JPG` vs `image.jpg`).
*   **Précision Temporelle** : Le système tolère un décalage allant jusqu'à 2 secondes pour compenser les arrondis de certains serveurs SFTP/WebDAV.
