# Agora

Extracted from `agora.zip`. Abstract 2-player strategy board game with stackable pieces, adapted from the physical board game *Agora* (the in-game "About" box credits the boxed edition with board and pieces to the publisher **Strate J**, Paris). You play against the computer, with an adjustable computer level.

## Files

| File | Size | Role |
|---|---|---|
| `Agora.exe` | 1.5 MB | The game (16-bit Windows 3.x executable, Borland). Unlike the other games there is no separate `.LIO` graphics bank: all graphics (including a rotatable 3D-ish view of the board) and sounds are embedded in the executable, which explains its size. |
| `Lisez-moi.txt` | 308 B | French readme: only the install instructions for the 3 shared files. |
| `WAVEMIX.INI`, `WAVMIX16.DLL`, `WING.DLL` | | Shared support files (see below). |

## Rules (summarised from the in-game help)

- **Goal**: a player wins when the opponent can no longer move, i.e. has no pieces left or all their pieces are prisoners.
- White starts. On each turn a player must move one of their pieces. In a stack, only the top piece can move. Three kinds of moves:
  - **Simple move**: move to an adjacent empty square (up to 8 neighbours).
  - **Capture**: if your piece's stack is higher or equal to the opponent's, you can put your piece on top; the captured pieces are flipped and change colour. Capturing is never mandatory.
  - **Prisoner**: if your stack is lower or equal, you can slide your piece underneath the opponent's stack.
- **Controls**: left mouse button drag for a move or a capture, right mouse button drag to become a prisoner. Arrow keys rotate / tilt the view of the board.
- **Nouvelle Position** menu: set up your own start position (left click = white piece, right click = black piece; the game starts once 16 pieces are placed). Choose who starts before clicking it.

## Shared support files

`WING.DLL`, `WAVMIX16.DLL` and `WAVEMIX.INI` are the Microsoft WinG graphics library, the Microsoft WaveMix sound mixing library and its configuration file. They are identical in every game; see the [root README](../README.md#files-common-to-every-game).
