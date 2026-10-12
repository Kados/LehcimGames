# KevGame

Extrait de `kevgame.zip`. Course-poursuite sous l'eau en temps réel, pour 2 joueurs sur le même clavier ou 1 joueur contre l'ordinateur (2 niveaux : débutant et confirmé). Conçu par Lehcim Noil et Nivek.

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
- Chacun peut construire un mur de bouées et de ballons et détruire les murs avec des pétards. Le mur se construit derrière l'animal, la destruction se fait devant.
- Fonctionnement mesuré dans le jeu d'origine : grille de 21 x 13 cases, le poisson et le ver vont à la même vitesse (une case en 0,3 s) ; l'air dure 30 s et se recharge d'un coup dans l'une des 2 zones à bulles, qui se déplacent ; le ver commence avec 4 bouées et le poisson avec 7, chacun a 3 pétards ; une bouée clignotante (à 0, 30 et 60 s) ou un pétard (à 15, 45 et 75 s) ramassés rechargent ces réserves ; à la première manche, le joueur de gauche est le ver.
- **Commandes** : joueur de gauche `Z` / `D` / `S` / `Q` (haut / droite / bas / gauche), `1` pour le mur, `2` pour la démolition ; joueur de droite : flèches, `Espace` pour le mur, `Alt Gr` pour la démolition.

## Version navigateur

- Jouer : [`docs/kevgame/`](../docs/kevgame/) (en ligne : `https://kados.github.io/LehcimGames/kevgame/` une fois GitHub Pages activé)
- Comment fonctionne l'algorithme, pourquoi, et comment l'améliorer : [`docs/kevgame/algorithme.html`](../docs/kevgame/algorithme.html)

## Fichiers de support partagés

`WING.DLL`, `WAVMIX16.DLL` et `WAVEMIX.INI` sont la bibliothèque graphique WinG de Microsoft, la bibliothèque de mixage sonore WaveMix de Microsoft et son fichier de configuration. Ils sont identiques dans tous les jeux ; voir le [README principal](../README.md#fichiers-communs-à-tous-les-jeux).
