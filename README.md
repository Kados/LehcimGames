# LehcimGames

A collection of seven freeware Windows games written by **Lehcim Noil** (some with music by **Nivek**), originally distributed around 2000-2006 from `http://lehcim.flashyland.com`.

Every game was shipped as a `.zip` archive. The archives are kept at the root of the repository, and their extracted contents live in one folder per game.

| Archive | Folder | Game | Genre | Details |
|---|---|---|---|---|
| `agora.zip` | `agora/` | Agora | Abstract stacking strategy board game (2 players or vs computer) | [agora/README.md](agora/README.md) |
| `awele.zip` | `awele/` | Awélé | African sowing game (mancala) vs computer | [awele/README.md](awele/README.md) |
| `coloursmix.zip` | `colorsmix/` | Colours-MIX | Real-time 2-player (or vs computer) colour puzzle race | [colorsmix/README.md](colorsmix/README.md) |
| `kevgame.zip` | `kevgame/` | KevGame | Real-time 2-player "fish vs worm" underwater chase | [kevgame/README.md](kevgame/README.md) |
| `labraph.zip` | `labraph/` | LabRaph | Single-player maze action/shooter with high scores | [labraph/README.md](labraph/README.md) |
| `morpion.zip` | `morpion/` | Morpion | Five-in-a-row (gomoku-style) vs computer | [morpion/README.md](morpion/README.md) |
| `stack.zip` | `stack/` | Stack | Single-player falling-marbles arcade game with high scores | [stack/README.md](stack/README.md) |

> Note: the archive `coloursmix.zip` extracts to a folder named `colorsmix/` (without the "u"). That is how the original archive was built.

## Technical context

- **Platform**: all executables are 16-bit **Windows 3.x "NE" (New Executable)** programs, built with **Borland Pascal / Delphi 1** (Borland runtime strings are embedded). They do **not** run natively on 64-bit Windows; use an emulator such as **DOSBox-X with Windows 3.1**, **Windows 98 in a VM**, or **otvdm/winevdm** (a 16-bit Windows compatibility layer for modern Windows).
- **Display**: the games require **256 colours at 640x480**.
- **Language**: all in-game text, rules and the `Lisez-moi.txt` files are in **French**, encoded in Windows-1252 (Latin-1).

## Files common to every game

Each archive contains the same three support files. They are byte-for-byte identical in all seven folders (same MD5 hash).

| File | Size | What it is |
|---|---|---|
| `WING.DLL` | 92 208 B | Microsoft **WinG** library (1994-1995). A fast graphics API for Windows 3.1 that lets games blit 8-bit bitmaps directly to the screen. Used for all game graphics. |
| `WAVMIX16.DLL` | 27 136 B | Microsoft **WaveMix** 16-bit library. Mixes several `.wav` sound effects at the same time on a single sound card channel. Used for game sound effects. |
| `WAVEMIX.INI` | 2 552 B | Configuration file for WaveMix (output device, 286/386 mixing code, buffer sizes per sound card model). |
| `Lisez-moi.txt` | ~300-560 B | "Read me" in French. Lists the files that must stay together and the install instructions (see below). Each game has its own version. |

### Original installation instructions (translated from `Lisez-moi.txt`)

> If not already done, put `wavemix.ini` in the `Windows` directory, and `wavmix16.dll` and `wing.dll` in the `Windows\System` directory.
> Do not leave these 3 files in the game directory, otherwise you may have problems (no music or no picture!).
> Have fun.

## Recurring file types

| Extension | Meaning |
|---|---|
| `.EXE` / `.exe` | The game itself (16-bit Windows NE executable). Contains the code, menus, dialogs, rules text ("Comment jouer ?" / "Règles du jeu") and usually the embedded `.wav` sounds. |
| `.LIO` | Custom compressed **graphics bank** (sprite sheet / backgrounds) loaded by the game. Format, verified on all five `.LIO` files: an 8-byte header made of two little-endian 32-bit integers (uncompressed size, compressed size), followed by **RLE data** as `(pixel value, repeat count)` byte pairs. Once decompressed it is a raw 8-bit (256-colour) pixel buffer. |
| `*PAL.bmp` | A tiny 2x2 pixel, 8-bit BMP whose only purpose is to carry the **256-colour palette** used to display the matching `.LIO` graphics. |
| `.mid` | Background **MIDI music**, played through the Windows MCI player. |
| `.tut` | Small data file written by the game: a **high-score table** (LabRaph, Stack) or the **saved settings** (Awélé). The high-score files are lightly obfuscated (names stored with bytes XOR-ed with `0xFF` and interleaved with filler bytes). |
| `.TXT` | Plain text (readme, or the Awélé game log). |
