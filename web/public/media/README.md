# CCTV media

Clips served at `/media/…` and played by the camera popups and the detection panel.
The camera estate that references them is `server/data/reference/cameras.js`.

## The four clips the opening sequence needs

These are **not in the repo yet** — generate them and drop them in with exactly these
names. Until they are here the console shows `NO SIGNAL` with the camera id, which is
deliberate: a missing feed must never render as a black rectangle, because on a video
wall that is indistinguishable from a working camera pointed at a dark room.

| File | Camera | What it shows |
|---|---|---|
| `rw_crash_cam_a.mp4` | `RTA-CAM-101A` | DSO Central Roundabout, north mast looking south — the collision |
| `rw_crash_cam_b.mp4` | `RTA-CAM-101B` | The same collision, south-east mast looking north-west |
| `nest_f3_cam_a.mp4` | `NEST-F3-CAM-07` | The NEST F3 server room, cold aisle — the collapse |
| `nest_f3_cam_b.mp4` | `NEST-F3-CAM-08` | The same collapse seen from the F3 corridor through the glass |

Each pair must agree with itself: same vehicles or same person, same clothing, same
lighting, same moment. The second angle is what takes the detection's confidence from
0.6 to 0.9 in the panel, so two clips that disagree undermine the thing they are there
to support.

**Format.** 16:9, 720p is plenty, ~8 s, no audio track needed (everything plays muted),
no burned-in timestamp or watermark — the console draws its own overlay. Keep the first
couple of seconds calm so the clip reads as an ordinary feed before the incident.

**Size.** Target ≤ 5 MB each. `traffic_cctv_1.mp4` in this folder is 208 MB and the folder
is 836 MB in total, which is already too heavy for a proxied origin; the whole folder
wants a `-crf 28`, 720p pass before the next deployment.

## The existing clips

`traffic_cctv_1…13.mp4`, `traffic_jam_cctv_1.mp4` and `traffic_accident_cctv.mp4` came
from the DSO build. They are used as the idle feeds for junction cameras — what a camera
shows when nothing is happening on it.
