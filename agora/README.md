# Agora

Extrait de `agora.zip`. Jeu de stratégie abstrait pour 2 joueurs avec des pièces empilables, adapté du jeu de société *Agora* (la fenêtre « A propos » du jeu indique que l'édition en boîte, avec plateau et pièces en hêtre rose et tilleul, est publiée par la société **Strate J**, Paris). On joue contre l'ordinateur, avec un niveau réglable.

## Fichiers

| Fichier | Taille | Rôle |
|---|---|---|
| `Agora.exe` | 1,5 Mo | Le jeu (exécutable Windows 3.x 16 bits, Borland). Contrairement aux autres jeux, il n'y a pas de banque d'images `.LIO` séparée : tous les graphismes (dont la vue 3D du plateau, que l'on peut faire tourner) et les sons sont intégrés à l'exécutable, d'où sa taille. |
| `Lisez-moi.txt` | 308 o | Mode d'emploi en français : seulement les instructions d'installation des 3 fichiers partagés. |
| `WAVEMIX.INI`, `WAVMIX16.DLL`, `WING.DLL` | | Fichiers de support partagés (voir plus bas). |

## Règles (résumé de l'aide du jeu)

- **But** : un joueur gagne quand son adversaire ne peut plus jouer, c'est-à-dire quand il n'a plus de pion ou que tous ses pions sont prisonniers.
- Les blancs commencent. À chaque tour, un joueur doit déplacer un de ses pions. Dans une pile, seul le pion du dessus peut bouger. Trois sortes de coups :
  - **Déplacement simple** : sur une case vide voisine (8 voisines au plus).
  - **Prise** : si ta pile est plus haute que celle de l'adversaire ou de même hauteur, tu peux poser ton pion dessus ; les pièces prises sont retournées et changent de couleur. La prise n'est jamais obligatoire.
  - **Prisonnier** : si ta pile est plus basse ou de même hauteur, tu peux glisser ton pion sous la pile adverse.
- **Révolution** : si les prisonniers deviennent majoritaires dans une pile, les pièces adverses sont prises et retournées.
- **Commandes** : glisser avec le bouton gauche pour un déplacement ou une prise, avec le bouton droit pour se constituer prisonnier. Les flèches tournent et inclinent la vue du plateau.
- Fonctionnement vérifié dans le jeu d'origine : le plateau de 6x6 est en gradins (tour extérieur, anneau du milieu, carré central de 2x2 de plus en plus bas) et la hauteur comparée pour une prise ou un prisonnier est celle de la case plus celle de la pile. Au départ, chaque camp occupe toute sa dernière rangée plus les deux cases devant ses coins. Un pion est isolé s'il ne touche qu'une seule pièce de sa couleur parmi ses 8 voisines (prisonniers compris).
- Menu **Nouvelle Position** : placer soi-même la position de départ (clic gauche = pièce blanche, clic droit = pièce noire ; la partie commence quand 16 pièces sont posées). Choisir qui commence avant de cliquer.

## Version navigateur

- Jouer : [`docs/agora/`](../docs/agora/) (en ligne : `https://kados.github.io/LehcimGames/agora/` une fois GitHub Pages activé)
- Comment fonctionne l'algorithme, pourquoi, et comment l'améliorer : [`docs/agora/algorithme.html`](../docs/agora/algorithme.html)

## Fichiers de support partagés

`WING.DLL`, `WAVMIX16.DLL` et `WAVEMIX.INI` sont la bibliothèque graphique WinG de Microsoft, la bibliothèque de mixage sonore WaveMix de Microsoft et son fichier de configuration. Ils sont identiques dans tous les jeux ; voir le [README principal](../README.md#fichiers-communs-à-tous-les-jeux).
