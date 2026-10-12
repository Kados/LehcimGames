# Colours-MIX

Extracted from `coloursmix.zip` (the folder is named `colorsmix`). Real-time colour puzzle race between a **red** and a **yellow** "globule" (blob). Version 2: adds a 1-player mode where the computer controls the red globule (version 1 was 2 players only). Design: Lehcim Noil, music: Nivek.

## Files

| File | Size | Role |
|---|---|---|
| `Colours_MIX.exe` | 654 KB | The game (16-bit Windows 3.x executable, Borland Delphi 1). Includes the sounds. |
| `IMCOL.LIO` | 213 KB | Compressed graphics bank (RLE, 385 152 bytes once decompressed). |
| `IMCOLPAL.bmp` | 1 KB | 2x2 BMP carrying the 256-colour palette for `IMCOL.LIO`. |
| `Lisez-moi.txt` | 540 B | French readme: `colours-MIX.exe`, `imcol.lio` and `imcolpal.bmp` must stay together; notes that version 2 allows solo play. |
| `WAVEMIX.INI`, `WAVMIX16.DLL`, `WING.DLL` | | Shared support files (see below). |

## Rules (summarised from the in-game help)

- Played in 2 rounds: yellow starts the first, red the second. If each wins one round, the fastest winner takes the match.
- A **grey globule** wanders randomly. It can only move to a square of the same colour as its current square, or to a black square.
- Red must bring the grey globule into the top or bottom black zone; yellow must bring it into the left or right black zone.
- In turn, each player moves through the central zone; the colours of the squares they cross change according to their chosen "application colour". Squares occupied by a globule or a pyramid are forbidden.
- **Controls** (one player): Q / Z / S / D to move, `2` to change colour, `1` and Space for the other actions.

## Shared support files

`WING.DLL`, `WAVMIX16.DLL` and `WAVEMIX.INI` are the Microsoft WinG graphics library, the Microsoft WaveMix sound mixing library and its configuration file. They are identical in every game; see the [root README](../README.md#files-common-to-every-game).
