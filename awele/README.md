# Awélé

Extracted from `awele.zip`. Computer version of **Awélé** (also called Oware / Awalé), the traditional African mancala "sowing" game. You play the 6 bottom pits against the computer, with several difficulty levels and a normal or **tournament** mode.

## Files

| File | Size | Role |
|---|---|---|
| `AWELE.EXE` | 156 KB | The game (16-bit Windows 3.0 executable, Borland Pascal). |
| `IMAWELE.LIO` | 202 KB | Compressed graphics bank (RLE, 332 800 bytes once decompressed): board, seeds, buttons. |
| `IMAWPAL.bmp` | 1 KB | 2x2 BMP carrying the 256-colour palette for `IMAWELE.LIO`. The game stops with "imawpal.bmp non trouvé" if it is missing. |
| `Awele.tut` | 3 B | Saved settings of the last session (bytes `00 03 01`, which matches the last game played: tournament mode, level 3). |
| `AWPARTIE.TXT` | 419 B | **Game log**: the games played during the last session are recorded here and erased at the next session. Moves are written as letters: `A B C D E F` for the player's pits, `f e d c b a` for the computer's pits. The included file contains one tournament game at level 3, signed "par Lehcim Noil". |
| `Lisez-moi.txt` | 559 B | French readme: `awele.exe`, `awele.tut`, `imawele.lio` and `imawpal.bmp` must stay in the same folder; mentions the game log. |
| `WAVEMIX.INI`, `WAVMIX16.DLL`, `WING.DLL` | | Shared support files (see below). |

> The readme names the log `AwParties.txt`, the shipped file is `AWPARTIE.TXT` (8.3 short name of the same file).

## Rules (summarised from the in-game help)

- The computer owns the 6 top pits, you own the 6 bottom pits. The big left pit stores the computer's seeds, the big right pit stores yours. Mouse only.
- On your turn, take all seeds of one of your pits and sow them one by one counter-clockwise, skipping the starting pit.
- If the last seed lands on the opponent's side in a pit that now has 2 or 3 seeds, you capture them, then continue checking the previous pits (clockwise) while they hold 2 or 3 seeds on the opponent's side.
- If the opponent has no seeds, you must feed them if you can. The game ends when a player has more than 24 seeds. With fewer than 7 seeds left on the board, the game is a draw.
- **Tournament mode**: total capture is allowed, and if a player has no seeds on their turn, the opponent collects all the seeds on their own side and the game ends.

## Shared support files

`WING.DLL`, `WAVMIX16.DLL` and `WAVEMIX.INI` are the Microsoft WinG graphics library, the Microsoft WaveMix sound mixing library and its configuration file. They are identical in every game; see the [root README](../README.md#files-common-to-every-game).
