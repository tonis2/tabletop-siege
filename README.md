# Tabletop Siege

A VR game for Meta Quest 3: a toy castle stands on a stone plinth 3 m away, and you knock it
down by throwing stones from a basket at your hip. Built on [three.c3](https://github.com/tonis2/three.c3),
in one JavaScript file.

Work in progress. Three castles (a wooden palisade, a stone keep, a bell tower), throwing with
the hand's own speed, haptics, and a round of eight stones with a score, soldiers and a
scoreboard. The catapult, post-processing and passthrough are still to come; `gameplan.md` is
the plan and what each milestone found.

## Running it

From a three.c3 checkout beside this one, built with `c3c build three`:

```sh
./build/three --script ../tabletop-siege/main.js                         # at a desk
packaging/android/build-apk.sh ../tabletop-siege/main.js --install       # on the headset
packaging/android/quest.sh push ../tabletop-siege/main.js                # reload it there, no rebuild
```

## Playing

- Reach into the basket, squeeze to take a stone, throw it and let go.
- Eight stones a round. The board left of the castle shows the score, your best for this castle,
  which castle it is and the stones left.
- **B** or **Y** starts the round again; **X** moves on to the next castle.
- At a desk the pointer is your right hand: point at the basket and hold the right button to take
  a stone, point at the castle and let go. **2** starts again, **3** moves on.

The score is how far the castle came down — 100 points per kilogram brought a metre down — plus
250 for each soldier knocked down. Best scores are kept in the game's save folder.

## Files

- `main.js` — the game.
- `probe.js` — the physics probe that set the castle's size: how many welded blocks the headset
  can knock down at frame rate.
- `gameplan.md` — the plan, and what each milestone found on the headset.

While it runs, `globalThis.siege` exposes the tuning (`tuning`, `ratings`, `impact`), the last
throws, the round and `throwAt(target, speed)`, for reading and changing over three.c3's MCP
server.
