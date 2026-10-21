module lib/tracks

/** A piece of track; trains move from a segment to one of its successors. */
sig Segment {
    next: set Segment,
    /** Segments that may not be occupied at the same time as this one. */
    overlaps: set Segment
}

fact overlapsSymmetric {
    overlaps = ~overlaps
}

/** Whether two distinct segments conflict. */
pred conflict[a, b: Segment] {
    a != b
    b in a.overlaps
}

// Not visible to modules that open this one.
private fun reach[s: Segment] : set Segment {
    s.^next
}

pred connected {
    all s: Segment | Segment - s in reach[s]
}
