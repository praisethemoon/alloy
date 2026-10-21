// An Alloy 6 traffic light: mutable state over time.

abstract sig Colour {}
one sig Red, Amber, Green extends Colour {}

one sig Light {
    var shows: one Colour
}

fact behaviour {
    Light.shows = Red
    always (
        (Light.shows = Red implies Light.shows' in Red + Green) and
        (Light.shows = Green implies Light.shows' in Green + Amber) and
        (Light.shows = Amber implies Light.shows' in Amber + Red)
    )
}

/** Green is always eventually reached. Fails: the light may stay red forever. */
assert greenEventually {
    eventually Light.shows = Green
}

/** Amber only ever follows green. Holds. */
assert amberAfterGreen {
    always (Light.shows' = Amber implies Light.shows in Green + Amber)
}

run cycleOnce { eventually Light.shows = Amber } for 3 but 6 steps
check greenEventually for 3 but 6 steps
check amberAfterGreen for 3 but 6 steps
