# Colours-MIX

Extrait de `coloursmix.zip` (le dossier s'appelle `colorsmix`). Course de couleurs en temps réel entre un « globule » **rouge** et un globule **jaune**. Version 2 : elle ajoute un mode 1 joueur où l'ordinateur dirige le globule rouge (la version 1 se jouait seulement à 2). Conception : Lehcim Noil, musique : Nivek.

## Fichiers

| Fichier | Taille | Rôle |
|---|---|---|
| `Colours_MIX.exe` | 654 Ko | Le jeu (exécutable Windows 3.x 16 bits, Borland Delphi 1). Il contient les sons. |
| `IMCOL.LIO` | 213 Ko | Banque d'images compressée (RLE, 385 152 octets une fois décompressée). |
| `IMCOLPAL.bmp` | 1 Ko | BMP de 2x2 pixels qui porte la palette de 256 couleurs de `IMCOL.LIO`. |
| `Lisez-moi.txt` | 540 o | Mode d'emploi en français : `colours-MIX.exe`, `imcol.lio` et `imcolpal.bmp` doivent rester ensemble ; il précise que la version 2 permet de jouer seul. |
| `WAVEMIX.INI`, `WAVMIX16.DLL`, `WING.DLL` | | Fichiers de support partagés (voir plus bas). |

## Règles (résumé de l'aide du jeu)

- La partie se joue en 2 manches : le jaune commence la première, le rouge la seconde. Si chacun gagne une manche, le plus rapide remporte la partie.
- Un **globule gris** se promène au hasard. Il ne peut passer que sur une case de la même couleur que la sienne, ou sur une case noire.
- Le rouge doit amener le globule gris dans la zone noire du haut ou du bas ; le jaune dans celle de gauche ou de droite.
- Chacun leur tour, les joueurs traversent la zone centrale ; les cases traversées changent de couleur selon la « couleur d'application » choisie. Les cases occupées par un globule ou une pyramide sont interdites.
- **Commandes** : rouge `Q` / `Z` / `S` / `D` pour se déplacer, `2` pour changer de couleur, `1` pour traverser ; jaune : flèches, `Entrée` pour la couleur, `Espace` pour traverser.

## Version navigateur

- Jouer : [`docs/colorsmix/`](../docs/colorsmix/) (en ligne : `https://kados.github.io/LehcimGames/colorsmix/` une fois GitHub Pages activé)
- Comment fonctionne l'algorithme, pourquoi, et comment l'améliorer : [`docs/colorsmix/algorithme.html`](../docs/colorsmix/algorithme.html)

## Fichiers de support partagés

`WING.DLL`, `WAVMIX16.DLL` et `WAVEMIX.INI` sont la bibliothèque graphique WinG de Microsoft, la bibliothèque de mixage sonore WaveMix de Microsoft et son fichier de configuration. Ils sont identiques dans tous les jeux ; voir le [README principal](../README.md#fichiers-communs-à-tous-les-jeux).
