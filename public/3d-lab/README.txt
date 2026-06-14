Place your local Phase 0A GLB test asset here:

/public/3d-lab/furniture-test-chair.glb

The default 3D Room Lab model path is:
/3d-lab/furniture-test-chair.glb

You can add additional GLBs anywhere under /public and load them from the
Model source controls using a local/public path (for example /3d-lab/other.glb).

Tip: after drawing the floor outline, use "Auto-fit from floor" in the Floor
mapping tuning section to estimate world size and perspective depth scaling
from the polygon. Manual mapping/depth controls still override it.

Tip: "Auto-normalize model bounds" (on by default, in the Model normalization
section) measures each loaded model's bounding box and auto-applies floor
contact, X/Z centering, and target-size scaling so arbitrary GLBs start in a
sensible state. Turn it off to inspect a model's raw bounds; the manual
normalization sliders still layer on top either way.
