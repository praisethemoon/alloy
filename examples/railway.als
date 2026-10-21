// Trains on shared track. Opens a module of this workspace; go to definition follows it.
open lib/tracks as t

sig Train {
    var on: lone t/Segment
}

/** Two trains never stand on conflicting segments. */
pred safe {
    all disj a, b: Train | not t/conflict[a.on, b.on] and a.on != b.on
}

/** A train either stays or moves to a next segment. */
pred move[tr: Train] {
    tr.on' in tr.on + tr.on.next
    all other: Train - tr | other.on' = other.on
}

fact trace {
    safe
    always some tr: Train | move[tr]
}

run someMovement { eventually some tr: Train | tr.on' != tr.on } for 3 but 4 steps
// Fails: move never stops a train from entering a conflicting segment.
check alwaysSafe { always safe } for 3 but 4 steps
