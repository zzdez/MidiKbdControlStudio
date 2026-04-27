# Guide Complet de Synchronisation Cloud (V9.2)

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
*   **Médias** : Vos fichiers Audio, Vidéo et Multipistes.
*   **Données** : La base de données de la bibliothèque et des liens web.
*   **Profils** : Vos configurations MIDI personnalisées.
*   **Définitions** : Les fichiers de configuration de vos pédaliers.
*   **Système** : Les langues et les assets visuels.

---

## 3. Modes de Synchronisation (Autorité)

Une nouveauté de la V9.3 est la gestion de l'**autorité de flux** :

*   **Bidirectionnel (Neutre)** : Propose toutes les actions. Les ajouts et modifications sont sélectionnés par défaut, les suppressions sont proposées mais décochées par défaut pour votre sécurité.
*   **Réception (Esclave / Pull Only)** : Seul le flux **Cloud ➔ PC** est actif. Les nouveaux fichiers du cloud sont téléchargés. Les fichiers manquants sur le cloud sont proposés à la suppression locale (décochés par défaut).
*   **Envoi (Maître / Push Only)** : Seul le flux **PC ➔ Cloud** est actif. Vos nouveaux fichiers locaux sont envoyés vers le cloud. Les fichiers manquants localement sont proposés à la suppression sur le cloud (décochés par défaut).

---

## 4. Workflow d'Utilisation (Cockpit V9.3)

Le processus se déroule en 3 étapes sécurisées :

### Étape 1 : Analyse
Cliquez sur **Analyser**. Le système scanne le cloud et votre machine locale. **Nouveauté V9.3** : Les nouveaux médias locaux sont désormais détectés et proposés même s'ils n'ont pas encore de marquage "partagé" explicite.

### Étape 2 : Cockpit de Validation
Une modale interactive s'ouvre. Elle affiche la liste exacte avec des indicateurs de direction clairs :
*   📥 **Cloud ➔ PC** : Fichiers arrivant du cloud.
*   📤 **PC ➔ Cloud** : Fichiers envoyés vers le cloud.
*   🗑️ **Cloud ❌** : Suppression sur le cloud.
*   🗑️ **PC ❌** : Suppression sur ce PC.

**Gestion de Masse** : Utilisez les cases à cocher **"Tout sélectionner"** en haut de chaque catégorie pour gagner du temps sur les gros volumes de fichiers.

---

## 5. Résolution de Problèmes (Troubleshooting)

*   **Bouton Analyser grisé** : Si vous fermez la modale via la croix (X), l'interface se réinitialise désormais proprement (**Fix V9.3**).
*   **Fichiers non détectés** : Assurez-vous d'avoir sélectionné les bonnes **Catégories** (Médias, Profils, etc.) avant de lancer l'analyse.

*   **Conflit de Casse (Casing)** : Windows est insensible à la casse (`Photo.jpg` = `photo.jpg`), mais les serveurs Linux (SFTP/WebDAV) ne le sont pas. Le `SyncManager` intègre un "Bouclier de Casse" qui normalise les comparaisons pour éviter les boucles de transfert infinies.
*   **Précision SFTP** : Certains serveurs SFTP tronquent les millisecondes des dates de fichiers. Le provider SFTP utilise un forçage `utime` pour garantir que les dates correspondent à 1 seconde près, évitant les faux-positifs de modification.
*   **Erreur 413 (WebDAV)** : Si vous utilisez IIS, assurez-vous que la limite `maxAllowedContentLength` est augmentée pour supporter vos fichiers médias.
