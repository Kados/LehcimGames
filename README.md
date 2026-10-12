# LehcimGames

Une collection de sept jeux gratuits pour Windows écrits par **Lehcim Noil** (certains avec une musique de **Nivek**), distribués à l'origine entre 2000 et 2006 sur le site `http://lehcim.flashyland.com`.

Chaque jeu était distribué sous forme d'archive `.zip`. Les archives sont conservées à la racine du dépôt, et leur contenu extrait se trouve dans un dossier par jeu.

| Archive | Dossier | Jeu | Genre | Détails |
|---|---|---|---|---|
| `agora.zip` | `agora/` | Agora | Jeu de stratégie à piles, contre l'ordinateur | [agora/README.md](agora/README.md) |
| `awele.zip` | `awele/` | Awélé | Jeu de semailles africain (mancala), contre l'ordinateur | [awele/README.md](awele/README.md) |
| `coloursmix.zip` | `colorsmix/` | Colours-MIX | Course de couleurs en temps réel, 2 joueurs ou contre l'ordinateur | [colorsmix/README.md](colorsmix/README.md) |
| `kevgame.zip` | `kevgame/` | KevGame | Course-poursuite « poisson contre ver » en temps réel, 1 ou 2 joueurs | [kevgame/README.md](kevgame/README.md) |
| `labraph.zip` | `labraph/` | LabRaph | Action et tir dans un labyrinthe, 1 joueur, meilleurs scores | [labraph/README.md](labraph/README.md) |
| `morpion.zip` | `morpion/` | Morpion | Alignement de 5 billes (type gomoku), contre l'ordinateur | [morpion/README.md](morpion/README.md) |
| `stack.zip` | `stack/` | Stack | Arcade avec des billes qui tombent, 1 joueur, meilleurs scores | [stack/README.md](stack/README.md) |

> Remarque : l'archive `coloursmix.zip` s'extrait dans un dossier nommé `colorsmix/` (sans le « u »). C'est ainsi que l'archive d'origine a été construite.

## Jouer dans le navigateur

Les sept jeux ont été réécrits en HTML5/JavaScript dans le dossier [`docs/`](docs/), avec les graphismes, les sons et les musiques d'origine extraits des archives. Il n'y a aucune étape de compilation : les fichiers sont servis tels quels.

- **En ligne (GitHub Pages)** : dans les **paramètres du dépôt** (onglet **Settings** de la page du dépôt, pas les paramètres du compte), ouvrir **Pages**, choisir **Source** = « Deploy from a branch », sélectionner la branche `main` et le dossier **`/docs`**, puis enregistrer. Les jeux sont alors à l'adresse `https://kados.github.io/LehcimGames/`. Avec un compte GitHub gratuit, Pages ne fonctionne que pour un dépôt public.
- **En local** : lancer `python3 -m http.server -d docs` puis ouvrir `http://localhost:8000`. (Ouvrir directement les fichiers HTML depuis le disque fonctionne aussi, mais la transparence des sprites nécessite un serveur web.)

| Dossier | Contenu |
|---|---|
| `docs/index.html` | Page d'accueil : présentation détaillée des 7 jeux, avec un lien pour jouer et un lien vers l'explication de l'algorithme |
| `docs/common/` | Fonctions partagées (`lehcim.js` : sprites avec couleur de transparence, sons, petit lecteur MIDI, boîtes de dialogue, meilleurs scores) et feuille de style façon Windows 3.1 |
| `docs/<jeu>/` | La **version d'origine** d'un jeu, fidèle au programme Windows : `index.html`, `game.js` (et `engine.js` / `rules.js` pour les règles et l'adversaire de l'ordinateur), `algorithme.html` (ce que fait l'algorithme, pourquoi, comment l'améliorer et ce qui change dans la nouvelle version), `assets/` avec les planches de sprites et les sons d'origine décodés |
| `docs/<jeu>/nouveau/` | La **nouvelle version** du jeu : mêmes règles et mêmes graphismes, interface moderne adaptée aux téléphones, aides (annuler, indices, aperçus...) et adversaires améliorés |
| `docs/thumbs/` | Vignettes de la page d'accueil |
| `tools/` | Scripts Python qui décodent les formats d'origine (banques `.LIO`, ressources des exécutables NE, images FCOD, textes intégrés). `sh tools/extract_all.sh DOSSIER` régénère tout |

Ce sont des réécritures, pas des émulations : le code source n'existe plus. Le fonctionnement a d'abord été reconstruit à partir des règles intégrées aux jeux, puis vérifié et corrigé en faisant tourner les programmes d'origine sous Wine (et, pour certains, en les désassemblant). Quand ces règles ne disaient rien (disposition des plateaux, durées, détails du score, son joué à tel moment), des choix ont été faits ; ils sont indiqués dans la fenêtre « Règles » de chaque jeu. Les adversaires de l'ordinateur, les niveaux, les modes 1 ou 2 joueurs et les meilleurs scores (enregistrés dans le navigateur) ont été conservés quand l'original les avait.

## Contexte technique

- **Plate-forme** : tous les exécutables sont des programmes 16 bits **Windows 3.x « NE » (New Executable)**, compilés avec **Borland Pascal / Delphi 1** (les messages de l'environnement Borland y sont intégrés). Ils ne fonctionnent **pas** directement sur un Windows 64 bits ; il faut un émulateur comme **DOSBox-X avec Windows 3.1**, **Windows 98 dans une machine virtuelle**, ou **otvdm/winevdm** (une couche de compatibilité Windows 16 bits pour les Windows récents).
- **Affichage** : les jeux demandent **256 couleurs en 640x480**.
- **Langue** : tous les textes des jeux, les règles et les fichiers `Lisez-moi.txt` sont en **français**, encodés en Windows-1252 (Latin-1).

## Fichiers communs à tous les jeux

Chaque archive contient les trois mêmes fichiers de support. Ils sont identiques octet pour octet dans les sept dossiers (même empreinte MD5).

| Fichier | Taille | Rôle |
|---|---|---|
| `WING.DLL` | 92 208 o | Bibliothèque **WinG** de Microsoft (1994-1995). Une interface graphique rapide pour Windows 3.1 qui permet aux jeux de copier des images 8 bits directement à l'écran. Utilisée pour tous les graphismes. |
| `WAVMIX16.DLL` | 27 136 o | Bibliothèque **WaveMix** 16 bits de Microsoft. Elle mélange plusieurs effets sonores `.wav` en même temps sur une seule voie de la carte son. Utilisée pour les bruitages. |
| `WAVEMIX.INI` | 2 552 o | Fichier de configuration de WaveMix (périphérique de sortie, code de mixage 286/386, taille des tampons selon la carte son). |
| `Lisez-moi.txt` | ~300-560 o | Mode d'emploi en français. Il liste les fichiers qui doivent rester ensemble et les instructions d'installation (voir ci-dessous). Chaque jeu a le sien. |

### Instructions d'installation d'origine (extraites de `Lisez-moi.txt`)

> Si ce n'est déjà fait, placer wavemix.ini dans le répertoire Windows, wavmix16.dll et wing.dll dans le répertoire Windows\System.
> Ne pas laisser ces 3 fichiers dans le répertoire du jeu, sinon vous risquez d'avoir des problèmes (pas de musique ou pas d'image !)
> Amusez-vous bien.

## Types de fichiers

| Extension | Signification |
|---|---|
| `.EXE` / `.exe` | Le jeu lui-même (exécutable Windows NE 16 bits). Il contient le code, les menus, les boîtes de dialogue, le texte des règles (« Comment jouer ? » / « Règles du jeu ») et généralement les sons `.wav`. |
| `.LIO` | **Banque d'images** compressée (planche de sprites, décors) dans un format propre aux jeux. Format, vérifié sur les cinq fichiers `.LIO` : un en-tête de 8 octets formé de deux entiers 32 bits petit-boutistes (taille décompressée, taille compressée), suivi de **données RLE** en paires d'octets `(valeur du pixel, nombre de répétitions)`. Une fois décompressé, c'est un tableau brut de pixels 8 bits (256 couleurs), stocké de bas en haut comme un BMP. |
| `*PAL.bmp` | Une minuscule image BMP 8 bits de 2x2 pixels dont le seul rôle est de porter la **palette de 256 couleurs** utilisée pour afficher le `.LIO` correspondant. |
| `.mid` | **Musique MIDI** de fond, jouée par le lecteur MCI de Windows. |
| `.tut` | Petit fichier de données écrit par le jeu : un **tableau des meilleurs scores** (LabRaph, Stack) ou les **réglages enregistrés** (Awélé). Les fichiers de scores sont légèrement brouillés (noms stockés avec des octets combinés par XOR avec `0xFF` et entrecoupés d'octets de remplissage). |
| `.TXT` | Texte simple (mode d'emploi, ou journal des parties d'Awélé). |
