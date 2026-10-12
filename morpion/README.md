# Morpion

Extrait de `morpion.zip`. « Morpion » est le nom français de ce type de jeu : ici, un jeu d'**alignement de cinq billes** (proche du gomoku) sur un damier, contre l'ordinateur. Plusieurs tailles de damier (l'aide mentionne un damier 10x10).

## Fichiers

| Fichier | Taille | Rôle |
|---|---|---|
| `MORPION.EXE` | 114 Ko | Le jeu (exécutable Windows 3.0 16 bits, Borland Pascal). Il reprend le code d'Awélé : son message d'erreur parle encore de « imawpal.bmp non trouvé » alors qu'il charge `immorpal.bmp`. |
| `IMMORP.LIO` | 207 Ko | Banque d'images compressée (RLE, 163 840 octets une fois décompressée ; celle-ci est plus grosse compressée que brute, la compression RLE étant peu efficace sur cette image). |
| `IMMORPAL.bmp` | 1 Ko | BMP de 2x2 pixels qui porte la palette de 256 couleurs de `IMMORP.LIO`. |
| `Lisez-moi.txt` | 443 o | Mode d'emploi en français : l'exécutable, le `.lio` (appelé `immorpion.lio` dans le mode d'emploi, `IMMORP.LIO` en réalité) et la palette doivent rester ensemble. |
| `WAVEMIX.INI`, `WAVMIX16.DLL`, `WING.DLL` | | Fichiers de support partagés (voir plus bas). |

## Règles (résumé de l'aide du jeu)

- Chaque joueur dépose à son tour une bille sur une case du damier (clic de souris).
- Un joueur marque un point chaque fois qu'il aligne **5 billes** de sa couleur, horizontalement, verticalement ou en diagonale.
- Le jeu s'arrête automatiquement quand aucun des deux joueurs ne peut plus progresser ; le gagnant est celui qui a le plus de points.
- On choisit qui commence. Il est impossible d'abandonner pendant que l'ordinateur réfléchit.

## Version navigateur

- Jouer : [`docs/morpion/`](../docs/morpion/) (en ligne : `https://kados.github.io/LehcimGames/morpion/` une fois GitHub Pages activé)
- Comment fonctionne l'algorithme, pourquoi, et comment l'améliorer : [`docs/morpion/algorithme.html`](../docs/morpion/algorithme.html)

## Fichiers de support partagés

`WING.DLL`, `WAVMIX16.DLL` et `WAVEMIX.INI` sont la bibliothèque graphique WinG de Microsoft, la bibliothèque de mixage sonore WaveMix de Microsoft et son fichier de configuration. Ils sont identiques dans tous les jeux ; voir le [README principal](../README.md#fichiers-communs-à-tous-les-jeux).
