# The indoor scenario, retired from the build

SC-RW-02 raised a person-down detection on floor 3 of The NEST: a camera in a server room
sees somebody collapse with nobody else present, and the response is an *access chain* —
building security, a badge-door release, a lift held at ground for the stretcher, and a
route pushed to the crew that ends in a room rather than at a kerb.

It was removed on **22 September 2026** because the proof of concept watches the **road**.
A collapse behind a badge-controlled door is a different product with a different sensor
estate, and demonstrating it alongside the crash module answered a question the client had
not asked.

Nothing about it was wrong, and nothing was deleted. What came out with it:

| Piece | Where it was |
|---|---|
| The scenario script | this folder, `SC-RW-02-nest-collapse.js` |
| `indoor_person_down` SOP | `server/data/reference/sop.js` |
| The three NEST cameras | `server/data/reference/cameras.js` |
| `NEST` building + room model | `server/data/reference/cameras.js` |

Still in the tree, unused and ready: `web/src/console/shell/FloorStack.tsx` draws the floor
stack, and `DetectionPanel` renders it whenever a detection carries a building and a floor.
Restoring the scenario is putting these four pieces back — no screen has to change.
