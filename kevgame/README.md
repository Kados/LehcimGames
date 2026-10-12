# KevGame

Extracted from `kevgame.zip`. Real-time underwater chase for 2 players on the same keyboard, or 1 player against the computer (with a difficulty level). Designed by Lehcim Noil and Nivek.

## Files

| File | Size | Role |
|---|---|---|
| `KevGame.exe` | 718 KB | The game (16-bit Windows 3.x executable, Borland Delphi 1). Includes the sound effects (some taken from Windows 98 sound schemes). |
| `IMKEV3.LIO` | 285 KB | Compressed graphics bank (RLE, 499 392 bytes once decompressed). |
| `IMKEVPAL.bmp` | 1 KB | 2x2 BMP carrying the 256-colour palette for `IMKEV3.LIO`. |
| `KevMus.mid` | 12 KB | Background music (MIDI format 1, 18 tracks). |
| `Lisez-moi.txt` | 453 B | French readme: `kevgame.exe`, `imkev3.lio`, `imkevpal.bmp` and `kevmus.mid` must stay together. |
| `WAVEMIX.INI`, `WAVMIX16.DLL`, `WING.DLL` | | Shared support files (see below). |

## Rules (summarised from the in-game help)

- Played in 2 rounds; each player is the **fish** once and the **worm** once. If each wins a round, the fastest winner takes the match.
- The fish must catch the worm in less than 90 seconds.
- Both must regularly breathe by reaching the bubble zones before running out of air.
- Each player can build a wall of buoys and balloons by picking up a blinking buoy, and can destroy walls after passing over a special square.
- **Controls**: left player Z / D / S / Q (up / right / down / left) and `1` for the wall; right player uses the arrow keys.

## Shared support files

`WING.DLL`, `WAVMIX16.DLL` and `WAVEMIX.INI` are the Microsoft WinG graphics library, the Microsoft WaveMix sound mixing library and its configuration file. They are identical in every game; see the [root README](../README.md#files-common-to-every-game).
