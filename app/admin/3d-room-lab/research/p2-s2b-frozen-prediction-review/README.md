# P2-S2B frozen prediction review

Rooms B and D are no longer a blinded holdout after this intentional reveal.
They are frozen post-P2-S2A review / validation cases.

The committed receipts remain historical evidence of exactly what the untouched
P2-S2A reader predicted before manual review. The viewer strictly verifies and
renders those receipts; it does not edit, score, promote, merge, extend, smooth,
or replace their fragment geometry.

The region mask is reconstructed only when the current detector module blobs
match the receipt-bound certified blobs and the reconstructed raw mask SHA-256
matches the receipt. Any mismatch fails closed as
`frozen_mask_reconstruction_unavailable`.

Future true generalization claims require new unseen rooms.
