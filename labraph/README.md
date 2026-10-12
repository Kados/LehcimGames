# LabRaph

Extrait de `labraph.zip`. Jeu d'action en labyrinthe pour 1 joueur : détruire tous les globules jaunes, éviter les serpents rouges, puis sortir. Avec un tableau des meilleurs scores.

## Fichiers

| Fichier | Taille | Rôle |
|---|---|---|
| `LabRaph.exe` | 1,4 Mo | Le jeu (exécutable Windows 3.x 16 bits, Borland Delphi 1). Les graphismes et les sons sont intégrés à l'exécutable (pas de fichier `.LIO`). |
| `LabRaph.tut` | 160 o | **Tableau des meilleurs scores** (5 entrées). Brouillé : les noms sont stockés avec des octets combinés par XOR avec `0xFF`, entrecoupés d'octets de remplissage ; les scores sont à la fin. Contenu d'origine : Pro 60, Expert 48, Amateur 36, Débutant 24, Gromové 12. Réécrit quand on entre dans les meilleurs scores. |
| `Lisez-moi.txt` | 425 o | Mode d'emploi en français : `LabRaph.exe` et `LabRaph.tut` doivent rester ensemble. |
| `WAVEMIX.INI`, `WAVMIX16.DLL`, `WING.DLL` | | Fichiers de support partagés (voir plus bas). |

> Le formulaire du jeu mentionne une musique `LABMUS.MID` (non fournie), mais la musique des niveaux vient des sons 10 et 11 intégrés à l'exécutable.

## Règles (résumé de l'aide du jeu)

- À chaque niveau, il faut détruire tous les globules jaunes, puis sortir du labyrinthe. Le temps est limité et aucun globule jaune ne doit sortir avant toi.
- On détruit les globules au contact (2 points) ou en leur tirant dessus (1 point).
- Les serpents rouges tuent au contact ; ils se déplacent dans les couloirs mais, à chaque carrefour, prennent la direction qui les rapproche du vaisseau en ligne droite sans tenir compte des murs (un mur peut donc les égarer). Tu peux leur tirer dessus s'il te reste des balles. On commence avec 2 balles, on en gagne au moins une par niveau, 5 au maximum.
- Les oeufs s'ouvrent quand tu t'approches ; un oeuf de serpent te détecte de plus loin qu'un oeuf de globule.
- Pendant les 20 dernières secondes d'un niveau, les murs s'effacent petit à petit.
- Une fois par niveau, tu peux poser une barrière provisoire de 3 secondes pour bloquer la sortie.
- **Commandes** : flèches pour se déplacer, `Espace` pour tirer, `Entrée` pour la barrière, `W` pour rester sur place (avec les flèches pour pivoter).

## Version navigateur

- Jouer : [`docs/labraph/`](../docs/labraph/) (en ligne : `https://kados.github.io/LehcimGames/labraph/` une fois GitHub Pages activé)
- Comment fonctionne l'algorithme, pourquoi, et comment l'améliorer : [`docs/labraph/algorithme.html`](../docs/labraph/algorithme.html)

## Fichiers de support partagés

`WING.DLL`, `WAVMIX16.DLL` et `WAVEMIX.INI` sont la bibliothèque graphique WinG de Microsoft, la bibliothèque de mixage sonore WaveMix de Microsoft et son fichier de configuration. Ils sont identiques dans tous les jeux ; voir le [README principal](../README.md#fichiers-communs-à-tous-les-jeux).
