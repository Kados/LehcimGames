# LabRaph

Extracted from `labraph.zip`. Single-player maze action game: clear each labyrinth of yellow globules, avoid the red snakes, and get out. Keeps a high-score table.

## Files

| File | Size | Role |
|---|---|---|
| `LabRaph.exe` | 1.4 MB | The game (16-bit Windows 3.x executable, Borland Delphi 1). Graphics and sounds are embedded in the executable (no `.LIO` file). |
| `LabRaph.tut` | 160 B | **High-score table** (5 entries). Obfuscated: names are stored with bytes XOR-ed with `0xFF`, interleaved with filler bytes; scores are at the end. Default content: Pro 60, Expert 48, Amateur 36, Débutant 24, and a 5th entry with 12 points. Rewritten when you enter the best scores. |
| `Lisez-moi.txt` | 425 B | French readme: `LabRaph.exe` and `LabRaph.tut` must stay together. |
| `WAVEMIX.INI`, `WAVMIX16.DLL`, `WING.DLL` | | Shared support files (see below). |

## Rules (summarised from the in-game help)

- On each level, destroy all the yellow globules, then exit the maze. Time is limited and no yellow globule may exit before you.
- Kill globules by contact (2 points) or by shooting them (1 point).
- Red snakes kill you on contact and chase you **through** walls; you can shoot them if you have bullets. You gain at least one bullet per level, 5 maximum.
- Eggs open when you approach; snake eggs detect you from further away than globule eggs.
- The maze becomes invisible during the last 20 seconds of a level.
- Once per level you can place a 3-second temporary barrier to block the exit.
- **Controls**: arrow keys to move, Space to shoot, Enter for the barrier, `W` to stay in place (combine with arrows to turn on the spot).

## Shared support files

`WING.DLL`, `WAVMIX16.DLL` and `WAVEMIX.INI` are the Microsoft WinG graphics library, the Microsoft WaveMix sound mixing library and its configuration file. They are identical in every game; see the [root README](../README.md#files-common-to-every-game).
