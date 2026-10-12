# Awélé

Extrait de `awele.zip`. Version pour ordinateur de l'**Awélé** (aussi appelé Oware ou Awalé), le jeu de semailles africain de la famille des mancalas. On joue les 6 cases du bas contre l'ordinateur, avec plusieurs niveaux et un mode normal ou **tournoi**.

## Fichiers

| Fichier | Taille | Rôle |
|---|---|---|
| `AWELE.EXE` | 156 Ko | Le jeu (exécutable Windows 3.0 16 bits, Borland Pascal). |
| `IMAWELE.LIO` | 202 Ko | Banque d'images compressée (RLE, 332 800 octets une fois décompressée) : plateau, graines, boutons. |
| `IMAWPAL.bmp` | 1 Ko | BMP de 2x2 pixels qui porte la palette de 256 couleurs de `IMAWELE.LIO`. Sans lui, le jeu s'arrête avec « imawpal.bmp non trouvé ». |
| `Awele.tut` | 3 o | Réglages de la dernière session (octets `00 03 01`, ce qui correspond à la dernière partie jouée : mode tournoi, niveau 3). |
| `AWPARTIE.TXT` | 419 o | **Journal des parties** : les parties jouées pendant la dernière session y sont enregistrées, puis effacées à la session suivante. Les coups sont notés par des lettres : `A B C D E F` pour les cases du joueur, `f e d c b a` pour celles de l'ordinateur. Le fichier fourni contient une partie en mode tournoi au niveau 3, signée « par Lehcim Noil ». |
| `Lisez-moi.txt` | 559 o | Mode d'emploi en français : `awele.exe`, `awele.tut`, `imawele.lio` et `imawpal.bmp` doivent rester dans le même dossier ; il mentionne le journal des parties. |
| `WAVEMIX.INI`, `WAVMIX16.DLL`, `WING.DLL` | | Fichiers de support partagés (voir plus bas). |

> Le mode d'emploi appelle le journal `AwParties.txt` ; le fichier fourni s'appelle `AWPARTIE.TXT` (nom court 8.3 du même fichier).

## Règles (résumé de l'aide du jeu)

- L'ordinateur possède les 6 cases du haut, le joueur les 6 cases du bas. La grande case de gauche reçoit les graines gagnées par l'ordinateur, celle de droite les tiennes. Le jeu se joue uniquement à la souris.
- À ton tour, tu prends toutes les graines d'une de tes cases et tu les sèmes une à une dans le sens inverse des aiguilles d'une montre, en sautant la case de départ.
- Si la dernière graine tombe chez l'adversaire dans une case qui contient alors 2 ou 3 graines, tu les prends, puis tu continues avec les cases précédentes (dans le sens des aiguilles d'une montre) tant qu'elles contiennent 2 ou 3 graines du côté adverse.
- Si l'adversaire n'a plus de graines, tu dois le nourrir si c'est possible. La partie s'arrête dès qu'un joueur a plus de 24 graines. S'il reste moins de 7 graines sur le plateau, la partie est nulle.
- **Mode tournoi** : la prise totale est autorisée, et si un joueur n'a plus de graines au moment de jouer, son adversaire ramasse toutes les graines de son côté et la partie s'arrête.

## Version navigateur

- Jouer : [`docs/awele/`](../docs/awele/) (en ligne : `https://kados.github.io/LehcimGames/awele/` une fois GitHub Pages activé)
- Comment fonctionne l'algorithme, pourquoi, et comment l'améliorer : [`docs/awele/algorithme.html`](../docs/awele/algorithme.html)

## Fichiers de support partagés

`WING.DLL`, `WAVMIX16.DLL` et `WAVEMIX.INI` sont la bibliothèque graphique WinG de Microsoft, la bibliothèque de mixage sonore WaveMix de Microsoft et son fichier de configuration. Ils sont identiques dans tous les jeux ; voir le [README principal](../README.md#fichiers-communs-à-tous-les-jeux).
