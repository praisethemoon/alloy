// A queue of jobs ordered by util/ordering. The let shows its inferred type as an inlay hint.
open util/ordering[Job] as ord

sig Job {
    priority: one Int
}

fact priorities {
    all j: Job - ord/last | j.priority =< (ord/next[j]).priority
}

fun urgent : set Job {
    let top = ord/last | top + ord/prev[top]
}

pred busy {
    #urgent > 1
}

run busy for 4
