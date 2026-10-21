/*
 * Families: who is whose parent, and what follows.
 * Hover a field to see its type and comment; run the commands with the lenses.
 */
open util/relation

abstract sig Person {
    /** The person's parents: at most two. */
    parents: set Person,
    /** Whom the person is married to, if anyone. */
    spouse: lone Person
}

sig Man, Woman extends Person {}

/** Nobody is their own ancestor. */
fact noTimeTravel {
    no p: Person | p in p.^parents
}

fact atMostTwoParents {
    all p: Person | #p.parents =< 2
}

fact spousesAreMutual {
    spouse = ~spouse
    no p: Person | p.spouse = p
}

fun ancestors[p: Person] : set Person {
    p.^parents
}

pred siblings[a, b: Person] {
    a != b
    some a.parents & b.parents
}

/** Holds: the facts rule out cycles in parents. */
assert parentsAcyclic {
    acyclic[parents, Person]
}

/** Fails: nothing stops marrying a sibling. */
assert noSiblingMarriage {
    no a, b: Person | siblings[a, b] and a.spouse = b
}

run siblings for 4
check parentsAcyclic for 5
check noSiblingMarriage for 4
