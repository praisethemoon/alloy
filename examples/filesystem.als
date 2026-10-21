// A file system: directories contain objects, every object but the root has one parent.

abstract sig Object {}

sig File extends Object {}

sig Dir extends Object {
    contents: set Object
}

one sig Root extends Dir {}

fact tree {
    // every object but the root is in exactly one directory
    all o: Object - Root | one contents.o
    no Root.~contents
    // and reachable from the root
    Object in Root.*contents
}

/** Everything below a directory. */
fun Dir.descendants : set Object {
    this.^contents
}

pred someNesting {
    some d: Dir - Root | some d.contents & Dir
}

assert noDirInsideItself {
    no d: Dir | d in d.descendants
}

run someNesting for 5
check noDirInsideItself for 6
