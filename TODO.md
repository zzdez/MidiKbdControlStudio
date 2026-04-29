# TODO List : Gestion Intelligente & Organisation des Médias

Objectif : Transformer la bibliothèque en un système auto-organisé par artiste et fournir des outils de gestion de fichiers granulaires.

### 🎨 1. Système de Classement & Nommage (Artist-Driven)
- [ ] Détecter automatiquement le champ `artiste` (ou `groupe`) dans la bibliothèque.
- [ ] Créer une logique de création automatique de sous-dossiers (`Medias/Videos/ACDC/`, `Medias/Audios/Metallica/`, etc.).
- [ ] Fallback intelligent si l'artiste n'est pas renseigné (demande création dossier ou sélection).

### 📝 2. Édition Unitaire avec Déplacement/Copie
- [ ] Intégrer les fonctions de gestion de fichiers directement dans la modale d'édition.
- [ ] Afficher le chemin interactif (`#mt-path-display`) sous les pochettes.
- [ ] Permettre à l'utilisateur de "Déplacer" physiquement le média s'il s'est trompé de dossier lors du chargement.

### 📂 3. Gestionnaire de Médias Dédié (Gestion de Masse)
- [ ] Créer une nouvelle modale pour l'organisation globale des dossiers.
- [ ] Sélection multiple pour déplacer/copier des blocs de médias vers de nouvelles arborescences.
- [ ] Intégrer les sécurités anti-conflit (WinError 183) développées dans la session précédente.

---
*Fin de Session V9.6.40 : Moteur de synchronisation stabilisé (Protection Cloud & Anti-récursion).*
