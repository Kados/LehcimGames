# KevGame

Extrait de `kevgame.zip`. Course-poursuite sous l'eau en temps réel, pour 2 joueurs sur le même clavier ou 1 joueur contre l'ordinateur (avec un niveau). Conçu par Lehcim Noil et Nivek.

## Fichiers

| Fichier | Taille | Rôle |
|---|---|---|
| `KevGame.exe` | 718 Ko | Le jeu (exécutable Windows 3.x 16 bits, Borland Delphi 1). Il contient les bruitages (certains viennent des thèmes sonores de Windows 98). |
| `IMKEV3.LIO` | 285 Ko | Banque d'images compressée (RLE, 499 392 octets une fois décompressée). |
| `IMKEVPAL.bmp` | 1 Ko | BMP de 2x2 pixels qui porte la palette de 256 couleurs de `IMKEV3.LIO`. |
| `KevMus.mid` | 12 Ko | Musique de fond (MIDI format 1, 18 pistes). |
| `Lisez-moi.txt` | 453 o | Mode d'emploi en français : `kevgame.exe`, `imkev3.lio`, `imkevpal.bmp` et `kevmus.mid` doivent rester ensemble. |
| `WAVEMIX.INI`, `WAVMIX16.DLL`, `WING.DLL` | | Fichiers de support partagés (voir plus bas). |

## Règles (résumé de l'aide du jeu)

- La partie se joue en 2 manches ; chaque joueur est une fois le **poisson** et une fois le **ver**. Si chacun gagne une manche, le plus rapide remporte la partie.
- Le poisson doit attraper le ver en moins de 90 secondes.
- Les deux doivent respirer régulièrement en rejoignant les zones à bulles avant d'avoir épuisé leur air.
- Chacun peut construire un mur de bouées et de ballons s'il en a la capacité, acquise en passant sur une bouée clignotante, et peut détruire les murs s'il est passé récemment sur un pétard. Le mur se construit derrière l'animal, la destruction se fait devant.
- **Commandes** : joueur de gauche `Z` / `D` / `S` / `Q` (haut / droite / bas / gauche), `1` pour le mur, `2` pour la démolition ; joueur de droite : flèches, `Espace` pour le mur, `Alt Gr` pour la démolition.

## Version navigateur

- Jouer : [`docs/kevgame/`](../docs/kevgame/) (en ligne : `https://kados.github.io/LehcimGames/kevgame/` une fois GitHub Pages activé)
- Comment fonctionne l'algorithme, pourquoi, et comment l'améliorer : [`docs/kevgame/algorithme.html`](../docs/kevgame/algorithme.html)

## Fichiers de support partagés

`WING.DLL`, `WAVMIX16.DLL` et `WAVEMIX.INI` sont la bibliothèque graphique WinG de Microsoft, la bibliothèque de mixage sonore WaveMix de Microsoft et son fichier de configuration. Ils sont identiques dans tous les jeux ; voir le [README principal](../README.md#fichiers-communs-à-tous-les-jeux).
