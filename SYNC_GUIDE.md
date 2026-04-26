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

## 3. Modes de Synchronisation

Une nouveauté de la V9.2 est le **bridage de flux** :

*   **Bidirectionnel (Auto)** : Le mode standard. Les modifications locales sont envoyées, les modifications distantes sont reçues, et les suppressions sont propagées des deux côtés.
*   **Réception (Pull Only)** : Mode sécurisé. L'application ne fera que télécharger les nouveautés du cloud. Rien ne sera jamais envoyé ou supprimé sur le cloud depuis cette machine.
*   **Envoi (Push Only)** : Mode maître. L'application envoie ses modifications vers le cloud mais ignore les changements distants. Utile pour une machine de "production" principale.

---

## 4. Workflow d'Utilisation

Le processus se déroule en 3 étapes sécurisées :

### Étape 1 : Analyse
Cliquez sur **Analyser**. Le système scanne le cloud et votre machine locale (en ignorant les fichiers identiques pour économiser la bande passante).

### Étape 2 : Récapitulatif & Confirmation
Une modale interactive s'ouvre. Elle affiche la liste exacte de ce qui va se passer :
*   📥 **Pull** : Fichiers arrivant du cloud.
*   📤 **Push** : Fichiers envoyés vers le cloud.
*   🗑️ **Delete Remote** : Fichiers qui seront supprimés sur le cloud car vous les avez supprimés ici.
*   🗑️ **Delete Local** : Fichiers qui seront supprimés ici car ils n'existent plus sur le cloud.

**Sécurité** : Vous pouvez décocher n'importe quel élément que vous ne souhaitez pas synchroniser à ce moment-là.

### Étape 3 : Exécution
Cliquez sur **Lancer la Synchronisation**. La progression et les logs détaillés s'affichent directement dans la modale. Une fois terminé, la bibliothèque se rafraîchit automatiquement.

---

## 5. Résolution de Problèmes (Troubleshooting)

*   **Conflit de Casse (Casing)** : Windows est insensible à la casse (`Photo.jpg` = `photo.jpg`), mais les serveurs Linux (SFTP/WebDAV) ne le sont pas. Le `SyncManager` intègre un "Bouclier de Casse" qui normalise les comparaisons pour éviter les boucles de transfert infinies.
*   **Précision SFTP** : Certains serveurs SFTP tronquent les millisecondes des dates de fichiers. Le provider SFTP utilise un forçage `utime` pour garantir que les dates correspondent à 1 seconde près, évitant les faux-positifs de modification.
*   **Erreur 413 (WebDAV)** : Si vous utilisez IIS, assurez-vous que la limite `maxAllowedContentLength` est augmentée pour supporter vos fichiers médias.
