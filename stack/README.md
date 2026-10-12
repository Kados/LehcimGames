# Stack

Extracted from `stack.zip`. Single-player arcade game: coloured marbles fall and bounce off movable "doors"; protect the "thing" moving at the bottom and score as many points as possible. Keeps a high-score table.

## Files

| File | Size | Role |
|---|---|---|
| `STACK.EXE` | 291 KB | The game (16-bit Windows 3.0 executable, Borland Pascal). |
| `IMSTACK.LIO` | 205 KB | Compressed graphics bank (RLE, 345 600 bytes once decompressed). |
| `IMSTPAL.bmp` | 1 KB | 2x2 BMP carrying the 256-colour palette for `IMSTACK.LIO`. |
| `StackMus.mid` | 10 KB | Background music (MIDI format 0); can be turned off ("Sans Musique"). |
| `Stacks.tut` | 160 B | **High-score table** (5 entries, names up to 14 letters). Same obfuscation as LabRaph (XOR `0xFF` + filler bytes). Default scores: 350, 300, 250, 150, 100 (Pro, Expert, Amateur, Junior, ...). |
| `Lisez-moi.txt` | 463 B | French readme: `stack.exe`, `imstack.lio`, `imstpal.bmp`, `stackmus.mid` and `stacks.tut` must stay together. |
| `WAVEMIX.INI`, `WAVMIX16.DLL`, `WING.DLL` | | Shared support files (see below). |

## Rules (summarised from the in-game help)

- **Goal**: get the maximum number of points; you score each time a new marble appears.
- Marbles are handled automatically as long as the "thing" moving from right to left is intact; it is damaged when hit by a marble and only has **3 lives**.
- Click to the right or left of a "door" to move it toward the mouse; placing doors cleverly steers the marbles' bounces.
- A marble falling on a marble of the same colour disappears along with it, freeing vital space.
- The frequency and variety of the marbles increase with the chosen starting level.

## Shared support files

`WING.DLL`, `WAVMIX16.DLL` and `WAVEMIX.INI` are the Microsoft WinG graphics library, the Microsoft WaveMix sound mixing library and its configuration file. They are identical in every game; see the [root README](../README.md#files-common-to-every-game).
