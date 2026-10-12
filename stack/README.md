# Stack

Extrait de `stack.zip`. Jeu d'arcade pour 1 joueur : des billes de couleur tombent à travers un triangle de picots où 6 petites barres (les « portes ») décident de leur chemin ; il faut protéger la « chose » qui traverse le milieu de l'écran et marquer le plus de points possible. Avec un tableau des meilleurs scores.

## Fichiers

| Fichier | Taille | Rôle |
|---|---|---|
| `STACK.EXE` | 291 Ko | Le jeu (exécutable Windows 3.0 16 bits, Borland Pascal). |
| `IMSTACK.LIO` | 205 Ko | Banque d'images compressée (RLE, 345 600 octets une fois décompressée). |
| `IMSTPAL.bmp` | 1 Ko | BMP de 2x2 pixels qui porte la palette de 256 couleurs de `IMSTACK.LIO`. |
| `StackMus.mid` | 10 Ko | Musique de fond (MIDI format 0) ; elle peut être coupée (« Sans Musique »). |
| `Stacks.tut` | 160 o | **Tableau des meilleurs scores** (5 entrées, noms de 14 lettres au plus). Même brouillage que LabRaph (XOR `0xFF` et octets de remplissage). Scores d'origine : Pro 350, Expert 300, Amateur 250, Junior 150, Gros Mauvais 100. |
| `Lisez-moi.txt` | 463 o | Mode d'emploi en français : `stack.exe`, `imstack.lio`, `imstpal.bmp`, `stackmus.mid` et `stacks.tut` doivent rester ensemble. |
| `WAVEMIX.INI`, `WAVMIX16.DLL`, `WING.DLL` | | Fichiers de support partagés (voir plus bas). |

## Règles (résumé de l'aide du jeu)

- **But** : obtenir le maximum de points ; on marque un point chaque fois qu'une nouvelle bille apparaît.
- Les billes sont générées automatiquement tant que la « chose » qui se déplace de droite à gauche est intacte ; elle est détruite dès qu'elle heurte une bille et n'a que **3 vies**. La barre d'espacement la fait accélérer.
- Un clic gauche à droite ou à gauche d'une « porte » la fait glisser vers la souris ; bien placer les portes permet d'orienter le rebond des billes.
- Une bille qui tombe sur une bille de même couleur disparaît avec elle, ce qui libère une place vitale pour la chose.
- Au départ, le score, la fréquence d'apparition des billes et leur variété sont proportionnels au niveau choisi.
- Fonctionnement mesuré dans le jeu d'origine : 7 colonnes en bas ; une colonne de 7 billes atteint le couloir et détruit la chose ; tous les 10 points, la « Vitesse » augmente (les billes arrivent plus souvent, elles ne tombent pas plus vite) et une couleur de plus apparaît, jusqu'à 7.

## Version navigateur

- Jouer : [`docs/stack/`](../docs/stack/) (en ligne : `https://kados.github.io/LehcimGames/stack/` une fois GitHub Pages activé)
- Comment fonctionne l'algorithme, pourquoi, et comment l'améliorer : [`docs/stack/algorithme.html`](../docs/stack/algorithme.html)

## Fichiers de support partagés

`WING.DLL`, `WAVMIX16.DLL` et `WAVEMIX.INI` sont la bibliothèque graphique WinG de Microsoft, la bibliothèque de mixage sonore WaveMix de Microsoft et son fichier de configuration. Ils sont identiques dans tous les jeux ; voir le [README principal](../README.md#fichiers-communs-à-tous-les-jeux).
