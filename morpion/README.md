# Morpion

Extracted from `morpion.zip`. "Morpion" is the French name for this kind of game: here a **five-in-a-row** game (gomoku-like) on a grid, played against the computer. Several board sizes (the help mentions a 10x10 board).

## Files

| File | Size | Role |
|---|---|---|
| `MORPION.EXE` | 114 KB | The game (16-bit Windows 3.0 executable, Borland Pascal). It reuses Awélé's code base: its error message still says "imawpal.bmp non trouvé" even though it loads `immorpal.bmp`. |
| `IMMORP.LIO` | 207 KB | Compressed graphics bank (RLE, 163 840 bytes once decompressed; this one is bigger compressed than raw, the RLE is inefficient on this picture). |
| `IMMORPAL.bmp` | 1 KB | 2x2 BMP carrying the 256-colour palette for `IMMORP.LIO`. |
| `Lisez-moi.txt` | 443 B | French readme: the exe, the `.lio` (named `immorpion.lio` in the readme, `IMMORP.LIO` in reality) and the palette must stay together. |
| `WAVEMIX.INI`, `WAVMIX16.DLL`, `WING.DLL` | | Shared support files (see below). |

## Rules (summarised from the in-game help)

- Each player in turn puts a marble on a square of the board (mouse click).
- A player scores a point each time they line up **5 marbles** of their colour horizontally, vertically or diagonally.
- The game stops automatically when neither player can progress any more; the winner has the most points.
- You choose who starts. You cannot give up while the computer is thinking.

## Shared support files

`WING.DLL`, `WAVMIX16.DLL` and `WAVEMIX.INI` are the Microsoft WinG graphics library, the Microsoft WaveMix sound mixing library and its configuration file. They are identical in every game; see the [root README](../README.md#files-common-to-every-game).
